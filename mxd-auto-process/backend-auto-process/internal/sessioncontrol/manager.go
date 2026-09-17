package sessioncontrol

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
)

var (
	ErrSessionNotFound    = errors.New("session not found")
	ErrServerNotFound     = errors.New("server not found")
	ErrServerDisabled     = errors.New("server is disabled")
	ErrCapacityFull       = errors.New("session capacity is full")
	ErrManagerClosed      = errors.New("session manager is closed")
	ErrKeylessProbeDenied = errors.New("keyless probe is disabled for this server")
)

type Credentials = gamesession.Credentials
type StartOptions struct {
	// Deprecated: heartbeat behavior is fixed by the session protocol.
	HeartbeatEnabled         *bool
	HeartbeatOperation       int
	HeartbeatIntervalSeconds int
}

type Snapshot struct {
	ID        string    `json:"id"`
	ServerID  string    `json:"server_id"`
	CreatedAt time.Time `json:"created_at"`
	gamesession.Snapshot
}

type managedSession struct {
	id        string
	serverID  string
	createdAt time.Time
	session   *gamesession.Session
}

type Manager struct {
	catalog          *servercatalog.Catalog
	dialer           gameprotocol.Dialer
	max              int
	mu               sync.RWMutex
	sessions         map[string]*managedSession
	reserved         int
	nextID           atomic.Uint64
	closed           bool
	opaqueResolver   gamesession.RoleOpaqueResolver
	exchangeRecorder gamesession.ExchangeRecorder
}

func New(catalog *servercatalog.Catalog, dialer gameprotocol.Dialer, maxSessions int) (*Manager, error) {
	return NewWithRoleOpaqueResolver(catalog, dialer, maxSessions, nil)
}

func NewWithRoleOpaqueResolver(catalog *servercatalog.Catalog, dialer gameprotocol.Dialer, maxSessions int, resolver gamesession.RoleOpaqueResolver) (*Manager, error) {
	if catalog == nil || dialer == nil {
		return nil, fmt.Errorf("catalog and dialer are required")
	}
	if maxSessions <= 0 {
		maxSessions = 128
	}
	return &Manager{catalog: catalog, dialer: dialer, max: maxSessions, sessions: make(map[string]*managedSession), opaqueResolver: resolver}, nil
}

func (m *Manager) SetExchangeRecorder(recorder gamesession.ExchangeRecorder) {
	m.mu.Lock()
	m.exchangeRecorder = recorder
	m.mu.Unlock()
}

func (m *Manager) Start(ctx context.Context, serverID string, credentials Credentials) (Snapshot, error) {
	return m.StartWithOptions(ctx, serverID, credentials, StartOptions{})
}

func (m *Manager) StartWithOptions(ctx context.Context, serverID string, credentials Credentials, options StartOptions) (Snapshot, error) {
	_ = options
	if credentials.Account == "" || (credentials.Password == "" && credentials.Token == "") {
		return Snapshot{}, gamesession.ErrMissingCredential
	}
	server, ok := m.catalog.Get(serverID)
	if !ok {
		return Snapshot{}, fmt.Errorf("%w: %s", ErrServerNotFound, serverID)
	}
	if !server.Enabled {
		return Snapshot{}, fmt.Errorf("%w: %s", ErrServerDisabled, serverID)
	}
	if err := m.reserve(); err != nil {
		return Snapshot{}, err
	}
	connectCtx, cancel := context.WithTimeout(ctx, time.Duration(server.ConnectTimeoutSeconds)*time.Second)
	client, err := m.dialer.Dial(connectCtx, server.Address, server.MaxBodyBytes)
	cancel()
	if err != nil {
		m.releaseReservation()
		return Snapshot{}, err
	}
	config := server.SessionConfig()
	config.ServerAddress = server.Address
	config.RoleOpaqueResolver = m.opaqueResolver
	config.ServerID = serverID
	config.Account = credentials.Account
	m.mu.RLock()
	config.ExchangeRecorder = m.exchangeRecorder
	m.mu.RUnlock()

	// 启用自动重连
	config.ReconnectConfig = gamesession.ReconnectConfig{
		Enabled:     true,
		MaxAttempts: 5,
		RetryDelay:  2 * time.Second,
	}

	session, err := gamesession.New(client, config)
	if err != nil {
		_ = client.Close()
		m.releaseReservation()
		return Snapshot{}, err
	}

	// 启用重连支持
	session.EnableReconnect(m.dialer, server.Address, int(server.MaxBodyBytes), config.ReconnectConfig)

	if _, err := session.Login(ctx, credentials); err != nil {
		_ = session.Close()
		m.releaseReservation()
		return Snapshot{}, err
	}

	managed := &managedSession{
		id:        fmt.Sprintf("s-%d", m.nextID.Add(1)),
		serverID:  serverID,
		createdAt: time.Now().UTC(),
		session:   session,
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = session.Close()
		m.releaseReservation()
		return Snapshot{}, ErrManagerClosed
	}
	m.sessions[managed.id] = managed
	m.reserved--
	m.mu.Unlock()
	return m.snapshot(managed), nil
}

func (m *Manager) Select(ctx context.Context, id, characterID, opaque string) (Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return Snapshot{}, err
	}
	if err := managed.session.SelectCharacter(ctx, characterID, opaque); err != nil {
		return m.snapshot(managed), err
	}

	return m.snapshot(managed), nil
}

// SelectAndEnter completes the interactive account setup flow. It is
// idempotent after a successful selection so a caller can retry map entry
// without sending operation 6 twice.
func (m *Manager) SelectAndEnter(ctx context.Context, id, characterID, opaque string) (Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := m.snapshot(managed)
	if snapshot.State == gamesession.StateLoggedIn {
		if snapshot, err = m.Select(ctx, id, characterID, opaque); err != nil {
			return snapshot, err
		}
	} else if snapshot.State != gamesession.StateCharacterReady && snapshot.State != gamesession.StateReady {
		return snapshot, gamesession.ErrInvalidState
	} else if snapshot.CharacterID != characterID {
		return snapshot, gamesession.ErrInvalidState
	}
	if snapshot.State == gamesession.StateReady {
		return snapshot, nil
	}
	return m.Enter(ctx, id)
}

func (m *Manager) Enter(ctx context.Context, id string) (Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return Snapshot{}, err
	}

	if err := managed.session.EnterGame(ctx); err != nil {
		return m.snapshot(managed), err
	}
	return m.snapshot(managed), nil
}

func (m *Manager) ProtocolState(id string) (gamesession.ProtocolState, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return gamesession.ProtocolState{}, err
	}
	return managed.session.ProtocolState(), nil
}

func (m *Manager) ProbeChatWithoutLogin(ctx context.Context, serverID, message string) (gamesession.ChatResult, error) {
	server, ok := m.catalog.Get(serverID)
	if !ok {
		return gamesession.ChatResult{}, fmt.Errorf("%w: %s", ErrServerNotFound, serverID)
	}
	if !server.Enabled {
		return gamesession.ChatResult{}, fmt.Errorf("%w: %s", ErrServerDisabled, serverID)
	}
	if !server.AllowKeylessProbe {
		return gamesession.ChatResult{}, ErrKeylessProbeDenied
	}
	if err := m.reserve(); err != nil {
		return gamesession.ChatResult{}, err
	}
	defer m.releaseReservation()
	connectCtx, cancel := context.WithTimeout(ctx, time.Duration(server.ConnectTimeoutSeconds)*time.Second)
	client, err := m.dialer.Dial(connectCtx, server.Address, server.MaxBodyBytes)
	cancel()
	if err != nil {
		return gamesession.ChatResult{}, err
	}
	defer client.Close()
	config := server.SessionConfig()
	config.ServerID = serverID
	m.mu.RLock()
	config.ExchangeRecorder = m.exchangeRecorder
	m.mu.RUnlock()
	return gamesession.ProbePrivateChatWithoutLogin(ctx, client, config, message)
}

func (m *Manager) List() []Snapshot {
	m.mu.RLock()
	entries := make([]*managedSession, 0, len(m.sessions))
	for _, managed := range m.sessions {
		entries = append(entries, managed)
	}
	m.mu.RUnlock()
	sort.Slice(entries, func(i, j int) bool { return entries[i].createdAt.Before(entries[j].createdAt) })
	result := make([]Snapshot, 0, len(entries))
	for _, managed := range entries {
		result = append(result, m.snapshot(managed))
	}
	return result
}
