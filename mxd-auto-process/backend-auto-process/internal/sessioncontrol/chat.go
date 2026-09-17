package sessioncontrol

import (
	"context"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

func (m *Manager) Chat(ctx context.Context, id, message string) (gamesession.ChatResult, Snapshot, error) {
	return m.ChatMode(ctx, id, gameprotocol.PrivateChatChannel, message)
}

func (m *Manager) ChatMode(ctx context.Context, id, channel, message string) (gamesession.ChatResult, Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return gamesession.ChatResult{}, Snapshot{}, err
	}
	result, err := managed.session.SendChat(ctx, channel, message)
	return result, m.snapshot(managed), err
}

func (m *Manager) ChatWithoutKey(ctx context.Context, id, message string) (gamesession.ChatResult, Snapshot, error) {
	managed, err := m.lookup(id)
	if err != nil {
		return gamesession.ChatResult{}, Snapshot{}, err
	}
	result, err := managed.session.SendPrivateChatWithoutKey(ctx, message)
	return result, m.snapshot(managed), err
}
