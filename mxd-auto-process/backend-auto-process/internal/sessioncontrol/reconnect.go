package sessioncontrol

import (
	"context"

	"github.com/local/mxd-auto-process/internal/gamesession"
)

func (m *Manager) Reconnect(ctx context.Context, id string) (Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return Snapshot{}, err
	}
	if err := managed.session.Reconnect(ctx); err != nil {
		return m.snapshot(managed), err
	}
	return m.snapshot(managed), nil
}

func (m *Manager) RequestReconnect(id string) (Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return Snapshot{}, err
	}
	if err := managed.session.RequestReconnect(); err != nil {
		return m.snapshot(managed), err
	}
	return m.snapshot(managed), nil
}

func IsReconnectableState(state gamesession.State) bool {
	return state == gamesession.StateFailed || state == gamesession.StateReconnecting
}
