package gamesession

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func (s *Session) SendPrivateChat(ctx context.Context, message string) (ChatResult, error) {
	return s.SendChat(ctx, gameprotocol.PrivateChatChannel, message)
}

func (s *Session) SendChat(ctx context.Context, channel, message string) (ChatResult, error) {
	if err := s.waitUntilReady(ctx); err != nil {
		return ChatResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sendChatLocked(ctx, channel, message, false, "authenticated_connection")
}

func (s *Session) SendPrivateChatWithoutKey(ctx context.Context, message string) (ChatResult, error) {
	if err := s.waitUntilReady(ctx); err != nil {
		return ChatResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sendChatLocked(ctx, gameprotocol.PrivateChatChannel, message, true, "authenticated_connection_without_stored_key")
}

func (s *Session) sendPrivateChatLocked(ctx context.Context, message string, discardStoredKey bool, connectionMode string) (ChatResult, error) {
	return s.sendChatLocked(ctx, gameprotocol.PrivateChatChannel, message, discardStoredKey, connectionMode)
}

func (s *Session) sendChatLocked(ctx context.Context, channel, message string, discardStoredKey bool, connectionMode string) (result ChatResult, operationErr error) {
	if s.state != StateReady {
		return ChatResult{}, s.invalidState("send chat")
	}
	if err := validateChatMessage(s.config, message); err != nil {
		return ChatResult{}, err
	}
	if !gameprotocol.IsChatChannel(channel) {
		return ChatResult{}, fmt.Errorf("%w: unsupported chat channel", ErrProtocol)
	}
	if discardStoredKey {
		s.serverKey = ""
	}
	releaseTransport := s.beginTransportOperationLocked()
	defer releaseTransport()
	startedAt := time.Now()
	operationCtx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
	defer cancel()
	request := gameprotocol.Chat(channel, message)
	s.beginExchangeLocked(request)
	defer func() {
		outcome := result.DeliveryStatus
		if outcome == "" && operationErr == nil {
			outcome = ExchangeUnconfirmed
		}
		s.finishExchangeLocked(outcome, operationErr)
	}()
	if err := s.transport.Send(operationCtx, request); err != nil {
		if ctx.Err() == nil {
			err = connectionLostError(err)
			s.requestReconnectLocked(err)
		}
		return ChatResult{}, err
	}
	s.sentMessages++
	s.touchLocked()
	result = ChatResult{
		Status:            ChatStatusWrittenUnconfirmed,
		Message:           "chat frame written; no matching server response before timeout",
		DeliveryStatus:    ChatDeliveryUnknown,
		ServerKeyIncluded: false,
		ConnectionMode:    connectionMode,
	}
	observation, err := s.waitForChatResponse(ctx, channel, message)
	if err != nil {
		if errors.Is(err, ErrTimeout) {
			s.recordChatDeliveryLocked(result.DeliveryStatus)
			return finishChatResult(result, startedAt), nil
		}
		s.recordChatDeliveryLocked(result.DeliveryStatus)
		if shouldReconnect(err) {
			s.requestReconnectLocked(err)
		}
		return ChatResult{}, err
	}

	if kickErr := s.handleChatResponse(observation); kickErr != nil {
		s.applyChatObservation(&result, observation, "detected account login elsewhere")
		s.requestReconnectLocked(kickErr)
		return finishChatResult(result, startedAt), nil
	}

	s.applyChatObservation(&result, observation, "server response observed for chat")
	return finishChatResult(result, startedAt), nil
}

func finishChatResult(result ChatResult, startedAt time.Time) ChatResult {
	result.GameServerResponseLatencyMS = time.Since(startedAt).Milliseconds()
	result.GameServerStatus = result.DeliveryStatus
	return result
}

func (s *Session) applyChatObservation(result *ChatResult, observation chatResponseObservation, message string) {
	result.Status = ChatStatusServerResponse
	result.Message = message
	result.ServerResponse = observation.text
	result.ServerResponseType = observation.kind
	result.ServerResponseObserved = true
	result.ServerResponseCode = observation.code
	result.ServerEvent = observation.event
	if observation.deliveryStatus == "" {
		observation.deliveryStatus = ChatDeliveryUnknown
	}
	result.DeliveryStatus = observation.deliveryStatus
	s.recordChatDeliveryLocked(result.DeliveryStatus)
}

func validateChatMessage(config Config, message string) error {
	if message == "" || !utf8.ValidString(message) {
		return fmt.Errorf("%w: chat message", ErrMissingCredential)
	}
	if utf8.RuneCountInString(message) > config.MaxChatRunes {
		return fmt.Errorf("%w: chat message exceeds limit", ErrProtocol)
	}
	return nil
}

func (s *Session) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Snapshot{
		State:                s.state,
		CharacterID:          s.characterID,
		MapID:                s.mapID,
		Roles:                roleOptions(s.roles),
		ServerKeyStored:      s.serverKey != "",
		SelectedOpaqueStored: s.selectedOpaqueStored,
		SentMessages:         s.sentMessages,
		ChatSuccessCount:     s.chatSuccessCount,
		ChatFailureCount:     s.chatFailureCount,
		ChatUnknownCount:     s.chatUnknownCount,
		LastError:            s.lastError,
		CreatedAt:            s.createdAt,
		UpdatedAt:            s.updatedAt,
	}
}

func (s *Session) Close() error {
	s.mu.Lock()
	if s.state == StateClosed {
		s.mu.Unlock()
		return nil
	}
	s.setStateLocked(StateClosed)
	s.lastError = ""
	s.touchLocked()
	s.heartbeatStopOnce.Do(func() { close(s.heartbeatStop) })
	s.monitorStopOnce.Do(func() { close(s.monitorStop) })
	reconnector := s.reconnector
	s.mu.Unlock()
	if reconnector != nil {
		reconnector.Stop()
	}
	s.cancelMonitorRead()
	s.transportMu.Lock()
	transport := s.transport
	s.transportMu.Unlock()
	if transport == nil {
		return nil
	}
	return transport.Close()
}

func (s *Session) startHeartbeatLocked() {
	if s.heartbeatStarted || s.config.HeartbeatInterval <= 0 {
		return
	}
	s.heartbeatStarted = true
	interval := s.config.HeartbeatInterval
	operation := s.config.HeartbeatOperation
	stop := s.heartbeatStop
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				s.mu.Lock()
				state := s.state
				s.mu.Unlock()
				if state == StateClosed {
					return
				}
				if state != StateReady {
					continue
				}
				transport, stateReady, locked := s.lockHeartbeatTransport()
				if !stateReady {
					continue
				}
				if !locked {
					continue
				}
				heartbeatCtx, cancel := context.WithTimeout(context.Background(), minDuration(interval/2, 5*time.Second))
				err := transport.Send(heartbeatCtx, gameprotocol.NewOperation(operation))
				cancel()
				s.transportMu.Unlock()
				if err != nil {
					if !s.requestRecovery(connectionLostError(err)) {
						return
					}
				}
			}
		}
	}()
}

func (s *Session) lockHeartbeatTransport() (gameprotocol.Client, bool, bool) {
	s.mu.Lock()
	if s.state != StateReady {
		s.mu.Unlock()
		return nil, false, false
	}
	if s.operationInFlight {
		s.mu.Unlock()
		return nil, true, false
	}
	// The monitor holds transportMu during a blocking Receive. Cancel that idle
	// read while holding mu so it cannot start another read ahead of this send.
	s.cancelMonitorRead()
	s.transportMu.Lock()
	transport := s.transport
	s.mu.Unlock()
	return transport, true, true
}

func (s *Session) markHeartbeatFailed(err error) {
	s.requestRecovery(connectionLostError(err))
}

func minDuration(left, right time.Duration) time.Duration {
	if left < right {
		return left
	}
	return right
}
