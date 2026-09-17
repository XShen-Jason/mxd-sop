package sessioncontrol

import (
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

func (a *AccountManager) snapshot(account autostore.Account) AccountSnapshot {
	if sessionID := a.sessionID(account.ID); sessionID != "" {
		if session, err := a.manager.Get(sessionID); err == nil {
			return a.snapshotWithSession(account, sessionID, session)
		}
	}
	status, lastError, updatedAt := a.runtimeValue(account.ID)
	if !account.Enabled {
		status, lastError = AccountDisabled, ""
	}
	if status == "" {
		status = AccountOffline
	}
	if updatedAt == "" {
		updatedAt = account.UpdatedAt
	}
	return AccountSnapshot{ID: account.ID, ServerID: account.ServerID, Username: account.Username, CharacterID: account.CharacterID, CharacterName: account.CharacterName, Enabled: account.Enabled, Status: status, LastError: lastError, UpdatedAt: updatedAt}
}

func (a *AccountManager) snapshotWithSession(account autostore.Account, sessionID string, session Snapshot) AccountSnapshot {
	status := statusFromSession(session.State)
	if !account.Enabled {
		status = AccountDisabled
	}
	return AccountSnapshot{ID: account.ID, ServerID: account.ServerID, Username: account.Username, CharacterID: account.CharacterID, CharacterName: account.CharacterName, Enabled: account.Enabled, Status: status, SessionID: sessionID, Session: &session, LastError: session.LastError, UpdatedAt: session.UpdatedAt.Format(time.RFC3339Nano)}
}

func statusFromSession(state gamesession.State) AccountStatus {
	switch state {
	case gamesession.StateReady:
		return AccountOnline
	case gamesession.StateReconnecting:
		return AccountReconnecting
	case gamesession.StateAuthenticating, gamesession.StateLoggedIn, gamesession.StateSelecting, gamesession.StateCharacterReady, gamesession.StateEntering:
		return AccountConnecting
	case gamesession.StateFailed:
		return AccountFailed
	default:
		return AccountOffline
	}
}
