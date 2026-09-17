package sessioncontrol

import "context"

// StartWithReconnect is kept as a compatibility wrapper. Sessions started by
// the manager always use the persistent automatic-reconnect policy.
func (m *Manager) StartWithReconnect(ctx context.Context, serverID string, credentials Credentials, _ bool) (Snapshot, error) {
	return m.Start(ctx, serverID, credentials)
}

// EnterWithReconnectInfo is kept for callers of the earlier helper API. The
// session already owns and updates its reconnect state during the flow.
func (m *Manager) EnterWithReconnectInfo(ctx context.Context, id string, _ Credentials) (Snapshot, error) {
	return m.Enter(ctx, id)
}
