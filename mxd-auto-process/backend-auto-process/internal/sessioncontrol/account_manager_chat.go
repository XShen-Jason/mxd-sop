package sessioncontrol

import (
	"context"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

func (a *AccountManager) Chat(ctx context.Context, id, mode, message string) (gamesession.ChatResult, AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	return a.chatLocked(ctx, id, mode, message, false)
}

// ChatIfOnline delivers a chat only when automation is enabled and its
// session is currently ready. Unlike Chat, it never waits for reconnect. This
// strict variant is used by batched automation so a stopped/reconnecting
// account cannot hold a record before another online account is tried.
func (a *AccountManager) ChatIfOnline(ctx context.Context, id, mode, message string) (gamesession.ChatResult, AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	return a.chatLocked(ctx, id, mode, message, true)
}

func (a *AccountManager) chatLocked(ctx context.Context, id, mode, message string, requireReady bool) (gamesession.ChatResult, AccountSnapshot, error) {
	account, ok, err := a.store.Account(id)
	if err != nil {
		return gamesession.ChatResult{}, AccountSnapshot{}, err
	}
	if !ok {
		return gamesession.ChatResult{}, AccountSnapshot{}, autostore.ErrAccountNotFound
	}
	if !account.Enabled || (requireReady && !account.AutomationEnabled) {
		return gamesession.ChatResult{}, a.snapshot(account), ErrAccountDisabled
	}
	sessionID := a.sessionID(id)
	if sessionID == "" {
		return gamesession.ChatResult{}, a.snapshot(account), ErrAccountOffline
	}
	if requireReady {
		session, getErr := a.manager.Get(sessionID)
		if getErr != nil || session.State != gamesession.StateReady {
			return gamesession.ChatResult{}, a.snapshot(account), ErrAccountOffline
		}
	}
	result, session, err := a.manager.ChatMode(ctx, sessionID, mode, message)
	if err != nil && gamesession.ErrorCode(err) == "connection_lost" {
		a.setRuntime(id, AccountReconnecting, gamesession.ErrorCode(err))
	}
	return result, a.snapshotWithSession(account, sessionID, session), err
}
