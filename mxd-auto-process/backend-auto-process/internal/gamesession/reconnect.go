package gamesession

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

var (
	ErrReconnecting     = errors.New("reconnection in progress")
	ErrReconnectFailed  = errors.New("reconnect failed after all attempts")
	ErrReconnectAborted = errors.New("reconnect was aborted")
)

type ReconnectConfig struct {
	Enabled     bool
	MaxAttempts int
	RetryDelay  time.Duration
}

type Reconnector struct {
	session     *Session
	config      ReconnectConfig
	dialer      gameprotocol.Dialer
	serverAddr  string
	maxBodySize int

	credentials   Credentials
	characterID   string
	roleOpaque    string
	mapID         string
	sessionConfig Config

	mu               sync.Mutex
	reconnecting     bool
	automaticRunning bool
	stopChan         chan struct{}
	stopOnce         sync.Once
}

func NewReconnector(session *Session, config ReconnectConfig, dialer gameprotocol.Dialer, serverAddr string, maxBodySize int) *Reconnector {
	if config.MaxAttempts <= 0 {
		config.MaxAttempts = 3
	}
	if config.RetryDelay <= 0 {
		config.RetryDelay = 2 * time.Second
	}
	return &Reconnector{
		session: session, config: config, dialer: dialer, serverAddr: serverAddr,
		maxBodySize: maxBodySize, stopChan: make(chan struct{}),
	}
}

func (r *Reconnector) SaveSessionInfo(credentials Credentials, characterID, roleOpaque, mapID string, config Config) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if credentials.Account != "" || credentials.Password != "" || credentials.Token != "" {
		r.credentials = credentials
	}
	if characterID != "" {
		r.characterID = characterID
	}
	if roleOpaque != "" {
		r.roleOpaque = roleOpaque
	}
	if mapID != "" {
		r.mapID = mapID
	}
	r.sessionConfig = config
}

func (r *Reconnector) IsReconnecting() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reconnecting || r.automaticRunning
}

func (r *Reconnector) StartAutomatic() {
	r.mu.Lock()
	if !r.config.Enabled || r.automaticRunning {
		r.mu.Unlock()
		return
	}
	r.automaticRunning = true
	r.mu.Unlock()
	go r.runAutomatic()
}

func (r *Reconnector) runAutomatic() {
	defer func() {
		r.mu.Lock()
		r.automaticRunning = false
		r.mu.Unlock()
	}()
	for {
		if r.session.Snapshot().State != StateReconnecting {
			return
		}
		err := r.TryReconnect(context.Background())
		if err == nil || errors.Is(err, ErrReconnectAborted) {
			return
		}
		if r.session.Snapshot().State != StateReconnecting {
			return
		}
		if !r.waitRetry(r.config.RetryDelay) {
			return
		}
	}
}

func (r *Reconnector) TryReconnect(ctx context.Context) error {
	r.mu.Lock()
	if !r.config.Enabled {
		r.mu.Unlock()
		return fmt.Errorf("reconnect is disabled")
	}
	if r.reconnecting {
		r.mu.Unlock()
		return ErrReconnecting
	}
	r.reconnecting = true
	maxAttempts, retryDelay := r.config.MaxAttempts, r.config.RetryDelay
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.reconnecting = false
		r.mu.Unlock()
	}()

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := r.waitBeforeAttempt(ctx, attempt, retryDelay); err != nil {
			return err
		}
		if err := r.reconnectOnce(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return fmt.Errorf("%w: %v", ErrReconnectFailed, lastErr)
}

func (r *Reconnector) waitBeforeAttempt(ctx context.Context, attempt int, delay time.Duration) error {
	if attempt == 1 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-r.stopChan:
			return ErrReconnectAborted
		default:
			return nil
		}
	}
	return r.waitContext(ctx, delay)
}

func (r *Reconnector) waitRetry(delay time.Duration) bool {
	return r.waitContext(context.Background(), delay) == nil
}

func (r *Reconnector) waitContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-r.stopChan:
		return ErrReconnectAborted
	case <-timer.C:
		return nil
	}
}

func (r *Reconnector) reconnectOnce(ctx context.Context) error {
	creds, characterID, roleOpaque, mapID, config := r.sessionInfo()
	if creds.Account == "" || (creds.Password == "" && creds.Token == "") {
		return fmt.Errorf("missing credentials for reconnect")
	}
	if characterID == "" {
		return ErrMissingCharacter
	}
	attemptCtx, cancel := r.contextWithStop(ctx)
	defer cancel()

	connectCtx, connectCancel := context.WithTimeout(attemptCtx, 10*time.Second)
	client, err := r.dialer.Dial(connectCtx, r.serverAddr, uint32(r.maxBodySize))
	connectCancel()
	if err != nil {
		return fmt.Errorf("dial failed: %w", err)
	}

	bootstrapConfig := config
	bootstrapConfig.MapID = mapIDOr(config.MapID, mapID)
	bootstrapConfig.HeartbeatInterval = 0
	bootstrapConfig.ReconnectConfig = ReconnectConfig{}
	newSession, err := New(client, bootstrapConfig)
	if err != nil {
		_ = client.Close()
		return fmt.Errorf("create session failed: %w", err)
	}
	if _, err = newSession.Login(attemptCtx, creds); err != nil {
		_ = newSession.Close()
		return fmt.Errorf("login failed: %w", err)
	}
	if err = newSession.SelectCharacter(attemptCtx, characterID, roleOpaque); err != nil {
		_ = newSession.Close()
		return fmt.Errorf("select character failed: %w", err)
	}
	if err = newSession.EnterGame(attemptCtx); err != nil {
		_ = newSession.Close()
		return fmt.Errorf("enter game failed: %w", err)
	}
	if err = r.session.replaceTransport(newSession); err != nil {
		_ = newSession.Close()
		return err
	}
	return nil
}

func (r *Reconnector) sessionInfo() (Credentials, string, string, string, Config) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.credentials, r.characterID, r.roleOpaque, r.mapID, r.sessionConfig
}

func (r *Reconnector) contextWithStop(ctx context.Context) (context.Context, context.CancelFunc) {
	attemptCtx, cancel := context.WithCancel(ctx)
	go func() {
		select {
		case <-r.stopChan:
			cancel()
		case <-attemptCtx.Done():
		}
	}()
	return attemptCtx, cancel
}

func (r *Reconnector) Stop() {
	r.stopOnce.Do(func() { close(r.stopChan) })
}

func mapIDOr(fallback, preferred string) string {
	if preferred != "" {
		return preferred
	}
	return fallback
}
