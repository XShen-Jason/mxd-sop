package gamesession

import (
	"context"
	"errors"
	"fmt"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func (s *Session) EnableReconnect(dialer gameprotocol.Dialer, serverAddr string, maxBodySize int, config ReconnectConfig) {
	reconnector := NewReconnector(s, config, dialer, serverAddr, maxBodySize)
	s.mu.Lock()
	if s.state == StateClosed {
		s.mu.Unlock()
		reconnector.Stop()
		return
	}
	s.reconnector = reconnector
	ready := s.state == StateReady
	if ready {
		s.startHeartbeatLocked()
	}
	s.mu.Unlock()
	if ready {
		go s.StartMessageMonitor(context.Background())
	}
}

func (s *Session) SaveReconnectInfo(credentials Credentials, characterID, roleOpaque, mapID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saveReconnectInfoLocked(credentials, characterID, roleOpaque, mapID)
}

func (s *Session) saveReconnectInfoLocked(credentials Credentials, characterID, roleOpaque, mapID string) {
	if s.reconnector == nil {
		return
	}
	if characterID == "" {
		characterID = s.characterID
	}
	if roleOpaque == "" {
		roleOpaque = s.selectedOpaque
	}
	if roleOpaque == "" && characterID != "" {
		for _, role := range s.roles {
			if role.option.ID == characterID {
				roleOpaque = role.opaque
				break
			}
		}
	}
	if mapID == "" {
		mapID = s.mapID
	}
	s.reconnector.SaveSessionInfo(credentials, characterID, roleOpaque, mapID, s.config)
}

func (s *Session) Reconnect(ctx context.Context) error {
	s.mu.Lock()
	reconnector := s.reconnector
	if reconnector == nil {
		s.mu.Unlock()
		return errors.New("reconnect not enabled")
	}
	if s.state == StateClosed {
		s.mu.Unlock()
		return ErrClosed
	}
	if s.state != StateReconnecting {
		s.setStateLocked(StateReconnecting)
		s.lastError = ErrorCode(ErrConnectionLost)
		s.touchLocked()
	}
	s.mu.Unlock()

	err := reconnector.TryReconnect(ctx)
	if err != nil && !errors.Is(err, ErrReconnecting) {
		s.markReconnectFailed(err)
	}
	return err
}

// RequestReconnect marks the logical session as reconnecting and starts the
// bounded-attempt retry loop without making the caller wait for the network.
func (s *Session) RequestReconnect() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == StateClosed {
		return ErrClosed
	}
	if s.reconnector == nil || !s.reconnector.config.Enabled {
		return errors.New("reconnect not enabled")
	}
	if s.state != StateReconnecting {
		s.setStateLocked(StateReconnecting)
		s.lastError = ErrorCode(ErrConnectionLost)
		s.touchLocked()
	}
	s.reconnector.StartAutomatic()
	return nil
}

func (s *Session) IsReconnecting() bool {
	s.mu.Lock()
	reconnector := s.reconnector
	s.mu.Unlock()
	return reconnector != nil && reconnector.IsReconnecting()
}

func (s *Session) waitUntilReady(ctx context.Context) error {
	for {
		s.mu.Lock()
		state := s.state
		changed := s.stateChanged
		s.mu.Unlock()
		switch state {
		case StateReady:
			return nil
		case StateReconnecting:
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-changed:
			}
		case StateClosed:
			return ErrClosed
		default:
			return fmt.Errorf("%w: cannot send chat while state is %s", ErrInvalidState, state)
		}
	}
}

func (s *Session) requestRecovery(err error) bool {
	if !shouldReconnect(err) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requestReconnectLocked(err)
}

func (s *Session) requestReconnectLocked(cause error) bool {
	if s.state == StateClosed || !shouldReconnect(cause) {
		return false
	}
	reconnector := s.reconnector
	if reconnector == nil || !reconnector.config.Enabled {
		s.failLocked(cause)
		return false
	}
	if s.state != StateReconnecting {
		s.setStateLocked(StateReconnecting)
		s.lastError = ErrorCode(cause)
		s.touchLocked()
	}
	// A manual reconnect can race with the message monitor's blocking read.
	// Cancel it before the replacement transport tries to take the lock.
	s.cancelMonitorRead()
	reconnector.StartAutomatic()
	return true
}

func (s *Session) markReconnectFailed(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == StateClosed {
		return
	}
	s.setStateLocked(StateFailed)
	s.lastError = ErrorCode(err)
	s.touchLocked()
}

func (s *Session) autoReconnectOnError(ctx context.Context, err error) error {
	if !shouldReconnect(err) {
		return err
	}
	return s.Reconnect(ctx)
}

func connectionLostError(err error) error {
	if err == nil || errors.Is(err, ErrConnectionLost) || errors.Is(err, context.Canceled) {
		return err
	}
	return fmt.Errorf("%w: %v", ErrConnectionLost, err)
}

func shouldReconnect(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, ErrClosed) {
		return false
	}
	return errors.Is(err, ErrKickedOut) ||
		errors.Is(err, ErrConnectionLost) ||
		errors.Is(err, ErrProtocol) ||
		errors.Is(err, ErrTimeout)
}
