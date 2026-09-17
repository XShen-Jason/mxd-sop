package gamesession

import (
	"context"
	"fmt"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func (s *Session) ProtocolState() ProtocolState {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := ProtocolState{
		ServerKey:                  s.serverKey,
		ServerKeyStored:            s.serverKey != "",
		SelectedRoleOpaqueStored:   s.selectedOpaqueStored,
		ServerKeyIncludedInSelect:  false,
		ServerKeyIncludedInChat:    false,
		RoleOpaqueIncludedInSelect: s.characterID != "",
	}
	result.SelectedRoleOpaque = s.selectedOpaque
	return result
}

func ProbePrivateChatWithoutLogin(ctx context.Context, transport gameprotocol.Client, config Config, message string) (ChatResult, error) {
	if transport == nil {
		return ChatResult{}, fmt.Errorf("transport is required")
	}
	config = normalizeConfig(config)
	if err := validateChatMessage(config, message); err != nil {
		return ChatResult{}, err
	}
	startedAt := time.Now()
	operationCtx, cancel := context.WithTimeout(ctx, config.RequestTimeout)
	defer cancel()
	request := gameprotocol.PrivateChat(message)
	if err := transport.Send(operationCtx, request); err != nil {
		recordStandaloneExchange(config, request, startedAt, ExchangeFailure, err)
		return ChatResult{}, err
	}
	recordStandaloneExchange(config, request, startedAt, ExchangeUnconfirmed, nil)
	return ChatResult{
		Status:                      ChatStatusWrittenUnconfirmed,
		Message:                     "private chat frame written on a fresh connection without login or session key; server acceptance is unconfirmed",
		DeliveryStatus:              ChatDeliveryUnknown,
		ServerKeyIncluded:           false,
		ConnectionMode:              "fresh_connection_without_login",
		GameServerResponseLatencyMS: time.Since(startedAt).Milliseconds(),
		GameServerStatus:            ChatDeliveryUnknown,
	}, nil
}
