package sessioncontrol

import (
	"context"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

const accountStartTimeout = 45 * time.Second

func (a *AccountManager) startLocked(ctx context.Context, account autostore.Account) (AccountSnapshot, error) {
	if existingID := a.sessionID(account.ID); existingID != "" {
		if session, err := a.manager.Get(existingID); err == nil {
			if session.State == gamesession.StateReady || session.State == gamesession.StateReconnecting || isStartingState(session.State) {
				return a.snapshotWithSession(account, existingID, session), nil
			}
		}
		a.stopLocked(account.ID)
	}
	a.setRuntime(account.ID, AccountConnecting, "")
	username, credential, credentialType, err := a.store.Credentials(account.ID)
	if err != nil {
		return a.failed(account, err)
	}
	credentials := Credentials{Account: username, Password: credential}
	if credentialType == autostore.CredentialMD5 {
		credentials.Password = ""
		credentials.Token = credential
	}
	session, err := a.manager.Start(ctx, account.ServerID, credentials)
	if err != nil {
		return a.failed(account, err)
	}
	a.setSessionID(account.ID, session.ID)
	session, err = a.manager.Select(ctx, session.ID, account.CharacterID, "")
	if err != nil {
		a.stopLocked(account.ID)
		return a.failed(account, err)
	}
	session, err = a.manager.Enter(ctx, session.ID)
	if err != nil {
		a.stopLocked(account.ID)
		return a.failed(account, err)
	}
	a.setRuntime(account.ID, AccountOnline, "")
	return a.snapshotWithSession(account, session.ID, session), nil
}

func isStartingState(state gamesession.State) bool {
	return state == gamesession.StateAuthenticating || state == gamesession.StateLoggedIn || state == gamesession.StateSelecting || state == gamesession.StateCharacterReady || state == gamesession.StateEntering
}

func (a *AccountManager) failed(account autostore.Account, err error) (AccountSnapshot, error) {
	a.setRuntime(account.ID, AccountFailed, gamesession.ErrorCode(err))
	return a.snapshot(account), err
}

func (a *AccountManager) startAsync(id string) {
	a.startAsyncWithParent(id, a.ctx)
}

func (a *AccountManager) startAsyncWithParent(id string, parent context.Context) {
	go func() {
		ctx, cancel := context.WithTimeout(parent, accountStartTimeout)
		defer cancel()
		lock := a.accountLock(id)
		lock.Lock()
		defer lock.Unlock()
		account, ok, err := a.store.Account(id)
		// A logout may have happened after this job was queued.
		if err != nil || !ok || !account.Enabled {
			return
		}
		_, _ = a.startLocked(ctx, account)
	}()
}
