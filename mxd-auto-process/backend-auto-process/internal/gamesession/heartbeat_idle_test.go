package gamesession

import (
	"context"
	"testing"
	"time"
)

// An idle server may not emit another event until it receives a heartbeat.
// The monitor must release its pending read so the heartbeat can be written.
func TestHeartbeatContinuesWhileIdleMonitorWaits(t *testing.T) {
	client := newReconnectClient(nil, false)
	session, err := New(client, Config{})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady
	session.config.HeartbeatInterval = 20 * time.Millisecond
	session.StartMessageMonitor(context.Background())
	waitFor(t, time.Second, func() bool { return firstMonitorReadActive(client) })
	session.mu.Lock()
	session.startHeartbeatLocked()
	session.mu.Unlock()

	received := func() bool {
		client.mu.Lock()
		defer client.mu.Unlock()
		for _, message := range client.sent {
			if message.Op != nil && *message.Op == FixedHeartbeatOperation {
				return true
			}
		}
		return false
	}
	deadline := time.Now().Add(500 * time.Millisecond)
	for !received() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	ok := received()
	// Release a stuck implementation too, so the regression fails without hanging.
	session.cancelMonitorRead()
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("idle monitor blocked the scheduled heartbeat")
	}
	client.mu.Lock()
	count := len(client.sent)
	client.mu.Unlock()
	time.Sleep(60 * time.Millisecond)
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.sent) != count {
		t.Fatal("heartbeat continued after explicit Close")
	}
	select {
	case <-client.closed:
	default:
		t.Fatal("explicit Close did not close the transport")
	}
}
