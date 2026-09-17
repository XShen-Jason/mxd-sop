package gamesession

import (
	"context"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func (s *Session) SelectCharacter(ctx context.Context, characterID, opaque string) (operationErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state != StateLoggedIn {
		return s.invalidState("select character")
	}
	if characterID == "" {
		switch len(s.roles) {
		case 1:
			characterID = s.roles[0].option.ID
		case 0:
			return ErrMissingCharacter
		default:
			return ErrRoleSelectionRequired
		}
	}
	storedOpaque := false
	if opaque == "" {
		for _, role := range s.roles {
			if role.option.ID == characterID && role.opaque != "" {
				opaque = role.opaque
				storedOpaque = true
				break
			}
		}
	}
	if opaque == "" && s.config.RoleOpaqueResolver != nil {
		resolved, found, err := s.config.RoleOpaqueResolver.Resolve(ctx, s.config.ServerAddress, characterID)
		if err != nil {
			return err
		}
		if found {
			opaque = resolved
		}
	}
	if opaque == "" {
		return ErrMissingRoleOpaque
	}
	s.setStateLocked(StateSelecting)
	s.touchLocked()
	releaseTransport := s.beginTransportOperationLocked()
	defer releaseTransport()
	operationCtx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
	defer cancel()
	request := gameprotocol.SelectCharacter(characterID, opaque)
	s.beginExchangeLocked(request)
	defer func() { s.finishExchangeLocked("", operationErr) }()
	if err := s.transport.Send(operationCtx, request); err != nil {
		return s.failLocked(err)
	}
	response, err := s.waitResponse(operationCtx, 6)
	if err != nil {
		return s.failLocked(err)
	}
	if err := ensureSuccess(response, 6); err != nil {
		return s.failLocked(err)
	}
	s.characterID = characterID
	if s.config.RetentionMode == RetainSessionData {
		s.selectedOpaque = opaque
	}
	s.mapID = extractMapID(response)
	if s.mapID == "" {
		s.mapID = s.config.MapID
	}
	s.selectedOpaqueStored = storedOpaque
	s.setStateLocked(StateCharacterReady)
	s.lastError = ""
	s.touchLocked()
	s.saveReconnectInfoLocked(Credentials{}, characterID, opaque, "")
	return nil
}
