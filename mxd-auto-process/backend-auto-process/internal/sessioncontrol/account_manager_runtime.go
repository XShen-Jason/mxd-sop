package sessioncontrol

import (
	"sync"
	"time"
)

func (a *AccountManager) accountLock(id string) *sync.Mutex {
	a.mu.Lock()
	defer a.mu.Unlock()
	if lock := a.locks[id]; lock != nil {
		return lock
	}
	lock := &sync.Mutex{}
	a.locks[id] = lock
	return lock
}

func (a *AccountManager) sessionID(id string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessions[id]
}

func (a *AccountManager) setSessionID(accountID, sessionID string) {
	a.mu.Lock()
	a.sessions[accountID] = sessionID
	a.mu.Unlock()
}

func (a *AccountManager) setRuntime(id string, status AccountStatus, lastError string) {
	a.mu.Lock()
	a.runtime[id] = accountRuntime{status: status, lastError: lastError, updatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	a.mu.Unlock()
}

func (a *AccountManager) runtimeValue(id string) (AccountStatus, string, string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	value := a.runtime[id]
	return value.status, value.lastError, value.updatedAt
}
