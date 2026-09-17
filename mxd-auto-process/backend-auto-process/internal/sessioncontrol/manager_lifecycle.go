package sessioncontrol

import "github.com/local/mxd-auto-process/internal/servercatalog"

// Server returns a copy of the current server definition for lifecycle
// watchers that need to avoid starting accounts on a disabled server.
func (m *Manager) Server(id string) (servercatalog.ServerConfig, bool) {
	return m.catalog.Get(id)
}

func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	managed, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return ErrSessionNotFound
	}
	return managed.session.Close()
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	entries := make([]*managedSession, 0, len(m.sessions))
	for _, managed := range m.sessions {
		entries = append(entries, managed)
	}
	m.sessions = make(map[string]*managedSession)
	m.reserved = 0
	m.mu.Unlock()
	for _, managed := range entries {
		_ = managed.session.Close()
	}
	return nil
}

func (m *Manager) reserve() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return ErrManagerClosed
	}
	if len(m.sessions)+m.reserved >= m.max {
		return ErrCapacityFull
	}
	m.reserved++
	return nil
}

func (m *Manager) releaseReservation() {
	m.mu.Lock()
	if m.reserved > 0 {
		m.reserved--
	}
	m.mu.Unlock()
}

func (m *Manager) lookup(id string) (*managedSession, error) {
	m.mu.RLock()
	managed, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return nil, ErrSessionNotFound
	}
	return managed, nil
}
