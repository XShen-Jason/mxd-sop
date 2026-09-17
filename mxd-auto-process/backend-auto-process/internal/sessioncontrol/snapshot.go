package sessioncontrol

func (m *Manager) Get(id string) (Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return Snapshot{}, err
	}
	return m.snapshot(managed), nil
}

func (m *Manager) snapshot(managed *managedSession) Snapshot {
	return Snapshot{
		ID:        managed.id,
		ServerID:  managed.serverID,
		CreatedAt: managed.createdAt,
		Snapshot:  managed.session.Snapshot(),
	}
}
