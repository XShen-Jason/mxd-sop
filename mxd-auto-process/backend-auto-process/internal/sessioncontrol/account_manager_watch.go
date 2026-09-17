package sessioncontrol

import (
	"context"
	"time"

	"github.com/local/mxd-auto-process/internal/gamesession"
)

func (a *AccountManager) stopLocked(id string) {
	if sessionID := a.sessionID(id); sessionID != "" {
		_ = a.manager.Stop(sessionID)
		a.mu.Lock()
		delete(a.sessions, id)
		a.mu.Unlock()
	}
}

// StopServer disconnects all account sessions while preserving enabled
// accounts so the watcher can apply a new server address or configuration.
func (a *AccountManager) StopServer(serverID string) error {
	accounts, err := a.store.Accounts(serverID)
	if err != nil {
		return err
	}
	for _, account := range accounts {
		lock := a.accountLock(account.ID)
		lock.Lock()
		a.stopLocked(account.ID)
		if account.Enabled {
			a.setRuntime(account.ID, AccountConnecting, "")
		} else {
			a.setRuntime(account.ID, AccountDisabled, "")
		}
		lock.Unlock()
	}
	return nil
}

func (a *AccountManager) startWatcher() {
	a.watcherOnce.Do(func() { go a.watchEnabledAccounts() })
}

func (a *AccountManager) watchEnabledAccounts() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-ticker.C:
			accounts, err := a.store.Accounts("")
			if err != nil {
				continue
			}
			for _, account := range accounts {
				if account.Enabled {
					a.reconcileAccount(account.ID)
				}
			}
		}
	}
}

func (a *AccountManager) reconcileAccount(id string) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	account, ok, err := a.store.Account(id)
	if err != nil || !ok || !account.Enabled {
		return
	}
	server, serverExists := a.manager.Server(account.ServerID)
	if !serverExists || !server.Enabled {
		if a.sessionID(id) != "" {
			a.stopLocked(id)
		}
		a.setRuntime(id, AccountOffline, "server_disabled")
		return
	}
	if sessionID := a.sessionID(id); sessionID != "" {
		if session, getErr := a.manager.Get(sessionID); getErr == nil {
			if session.State == gamesession.StateReady || session.State == gamesession.StateReconnecting || isStartingState(session.State) {
				return
			}
		}
		a.stopLocked(id)
	}
	ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
	defer cancel()
	_, _ = a.startLocked(ctx, account)
}
