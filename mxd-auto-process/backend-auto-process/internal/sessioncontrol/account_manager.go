package sessioncontrol

import (
	"context"
	"errors"
	"sync"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

type AccountManager struct {
	manager     *Manager
	store       *autostore.Store
	mu          sync.Mutex
	sessions    map[string]string
	locks       map[string]*sync.Mutex
	runtime     map[string]accountRuntime
	ctx         context.Context
	cancel      context.CancelFunc
	watcherOnce sync.Once
}

func NewAccountManager(manager *Manager, store *autostore.Store) (*AccountManager, error) {
	if manager == nil || store == nil {
		return nil, errors.New("manager and account store are required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := &AccountManager{
		manager:  manager,
		store:    store,
		sessions: make(map[string]string),
		locks:    make(map[string]*sync.Mutex),
		runtime:  make(map[string]accountRuntime),
		ctx:      ctx,
		cancel:   cancel,
	}
	result.startWatcher()
	return result, nil
}

func (a *AccountManager) Close() { a.cancel() }

func (a *AccountManager) StartEnabled(ctx context.Context) {
	if ctx == nil {
		ctx = a.ctx
	}
	accounts, err := a.store.Accounts("")
	if err != nil {
		return
	}
	for _, account := range accounts {
		if !account.Enabled {
			continue
		}
		accountID := account.ID
		a.setRuntime(accountID, AccountConnecting, "")
		a.startAsyncWithParent(accountID, ctx)
	}
}

func (a *AccountManager) List(serverID string) ([]AccountSnapshot, error) {
	accounts, err := a.store.Accounts(serverID)
	if err != nil {
		return nil, err
	}
	result := make([]AccountSnapshot, 0, len(accounts))
	for _, account := range accounts {
		result = append(result, a.snapshot(account))
	}
	return result, nil
}

func (a *AccountManager) Create(account autostore.Account, password string) (AccountSnapshot, error) {
	return a.create(account, password, "")
}

// CreateWithSession persists an account and adopts an already authenticated
// and game-ready session. The setup flow uses this to avoid logging in twice.
func (a *AccountManager) CreateWithSession(account autostore.Account, password, sessionID string) (AccountSnapshot, error) {
	return a.create(account, password, sessionID)
}

func (a *AccountManager) create(account autostore.Account, password, sessionID string) (AccountSnapshot, error) {
	var session Snapshot
	if sessionID != "" {
		var err error
		session, err = a.manager.Get(sessionID)
		if err != nil {
			return AccountSnapshot{}, err
		}
		if session.ServerID != account.ServerID {
			return AccountSnapshot{}, ErrSessionServerMismatch
		}
		if session.State != gamesession.StateReady || session.CharacterID != account.CharacterID {
			return AccountSnapshot{}, gamesession.ErrInvalidState
		}
	}
	created, err := a.store.CreateAccount(account, password)
	if err != nil {
		return AccountSnapshot{}, err
	}
	if created.Enabled {
		if sessionID != "" {
			a.setSessionID(created.ID, sessionID)
			a.setRuntime(created.ID, AccountOnline, "")
			return a.snapshotWithSession(created, sessionID, session), nil
		}
		a.setRuntime(created.ID, AccountConnecting, "")
		snapshot := a.snapshot(created)
		a.startAsync(created.ID)
		return snapshot, nil
	}
	return a.snapshot(created), nil
}

func (a *AccountManager) Update(account autostore.Account, password string) (AccountSnapshot, error) {
	lock := a.accountLock(account.ID)
	lock.Lock()
	defer lock.Unlock()
	updated, err := a.store.UpdateAccount(account, password)
	if err != nil {
		return AccountSnapshot{}, err
	}
	a.stopLocked(account.ID)
	if updated.Enabled {
		a.setRuntime(updated.ID, AccountConnecting, "")
		a.startAsync(updated.ID)
		return a.snapshot(updated), nil
	}
	a.setRuntime(account.ID, AccountDisabled, "")
	return a.snapshot(updated), nil
}

func (a *AccountManager) Delete(id string) error {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	a.stopLocked(id)
	if err := a.store.DeleteAccount(id); err != nil {
		return err
	}
	a.mu.Lock()
	delete(a.runtime, id)
	delete(a.sessions, id)
	a.mu.Unlock()
	return nil
}

func (a *AccountManager) Start(ctx context.Context, id string) (AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	account, ok, err := a.store.Account(id)
	if err != nil {
		return AccountSnapshot{}, err
	}
	if !ok {
		return AccountSnapshot{}, autostore.ErrAccountNotFound
	}
	if !account.Enabled {
		if err := a.store.SetEnabled(id, true); err != nil {
			return AccountSnapshot{}, err
		}
		account.Enabled = true
	}
	a.setRuntime(id, AccountConnecting, "")
	return a.startLocked(ctx, account)
}

// StartAsync enables an account and schedules the complete login, character
// selection, and game-entry flow without holding the HTTP request open.
func (a *AccountManager) StartAsync(id string) (AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	account, ok, err := a.store.Account(id)
	if err != nil {
		return AccountSnapshot{}, err
	}
	if !ok {
		return AccountSnapshot{}, autostore.ErrAccountNotFound
	}
	if !account.Enabled {
		if err := a.store.SetEnabled(id, true); err != nil {
			return AccountSnapshot{}, err
		}
		account.Enabled = true
	}
	if sessionID := a.sessionID(id); sessionID != "" {
		if session, getErr := a.manager.Get(sessionID); getErr == nil {
			if session.State == gamesession.StateReady || session.State == gamesession.StateReconnecting || isStartingState(session.State) {
				return a.snapshotWithSession(account, sessionID, session), nil
			}
		}
		a.stopLocked(id)
	}
	a.setRuntime(id, AccountConnecting, "")
	snapshot := a.snapshot(account)
	a.startAsync(id)
	return snapshot, nil
}

func (a *AccountManager) Stop(id string) (AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	if err := a.store.SetEnabled(id, false); err != nil {
		return AccountSnapshot{}, err
	}
	a.stopLocked(id)
	a.setRuntime(id, AccountDisabled, "")
	account, ok, err := a.store.Account(id)
	if err != nil {
		return AccountSnapshot{}, err
	}
	if !ok {
		return AccountSnapshot{}, autostore.ErrAccountNotFound
	}
	return a.snapshot(account), nil
}

func (a *AccountManager) Reconnect(ctx context.Context, id string) (AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	account, ok, err := a.store.Account(id)
	if err != nil {
		return AccountSnapshot{}, err
	}
	if !ok {
		return AccountSnapshot{}, autostore.ErrAccountNotFound
	}
	if !account.Enabled {
		return a.snapshot(account), ErrAccountDisabled
	}
	a.setRuntime(id, AccountReconnecting, "")
	if sessionID := a.sessionID(id); sessionID != "" {
		managed, getErr := a.manager.Get(sessionID)
		if getErr == nil && managed.State != gamesession.StateClosed {
			if _, reconnectErr := a.manager.RequestReconnect(sessionID); reconnectErr != nil {
				a.setRuntime(id, AccountFailed, gamesession.ErrorCode(reconnectErr))
				return a.snapshot(account), reconnectErr
			}
			return a.snapshot(account), nil
		}
		a.stopLocked(id)
	}
	_ = ctx
	a.setRuntime(id, AccountConnecting, "")
	snapshot := a.snapshot(account)
	a.startAsync(id)
	return snapshot, nil
}

func (a *AccountManager) Chat(ctx context.Context, id, mode, message string) (gamesession.ChatResult, AccountSnapshot, error) {
	lock := a.accountLock(id)
	lock.Lock()
	defer lock.Unlock()
	return a.chatLocked(ctx, id, mode, message, false)
}

// ChatIfOnline delivers a chat only when the account is enabled and its
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
	if !account.Enabled {
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
