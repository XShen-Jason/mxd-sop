package gamesession

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestAutomaticReconnectRestoresTheLogicalSession(t *testing.T) {
	dialer := &reconnectDialer{scripts: [][]gameprotocol.Message{
		{loginResponse(), response(6, 0), response(7, 0)},
		{loginResponse(), response(6, 0), response(7, 0)},
	}}
	first, err := dialer.Dial(context.Background(), "127.0.0.1:12660", 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	session, err := New(first, Config{
		Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second,
		ChatResponseTimeout: 100 * time.Millisecond, RequireMapEvents: false,
		PostEntryInit: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	session.EnableReconnect(dialer, "127.0.0.1:12660", 1024*1024, ReconnectConfig{
		Enabled: true, MaxAttempts: 1, RetryDelay: time.Millisecond,
	})
	if _, err := session.Login(context.Background(), Credentials{Account: "account", Token: "token"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(context.Background(), "", ""); err != nil {
		t.Fatal(err)
	}
	if err := session.EnterGame(context.Background()); err != nil {
		t.Fatal(err)
	}

	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for {
		if dialer.clientCount() == 2 && session.Snapshot().State == StateReady {
			break
		}
		select {
		case <-deadline.C:
			t.Fatalf("session did not recover: state=%s clients=%d", session.Snapshot().State, dialer.clientCount())
		default:
			time.Sleep(time.Millisecond)
		}
	}

	result, err := session.SendPrivateChat(context.Background(), "hello after reconnect")
	if err != nil || result.DeliveryStatus != ChatDeliverySuccess {
		t.Fatalf("chat did not use the recovered connection: %+v %v", result, err)
	}
	if snapshot := session.Snapshot(); snapshot.SentMessages != 1 || snapshot.State != StateReady {
		t.Fatalf("logical session state was not preserved: %+v", snapshot)
	}
	firstSent, secondSent := dialer.sentCounts()
	if firstSent != 3 || secondSent != 4 {
		t.Fatalf("unexpected reconnect request sequence: %d, %d", firstSent, secondSent)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRequestReconnectCancelsAConcurrentMonitorRead(t *testing.T) {
	dialer := &reconnectDialer{scripts: [][]gameprotocol.Message{
		{loginResponse(), response(6, 0), response(7, 0)},
		{loginResponse(), response(6, 0), response(7, 0)},
	}}
	first, err := dialer.Dial(context.Background(), "127.0.0.1:12660", 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	session, err := New(first, Config{Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second, RequireMapEvents: false, PostEntryInit: false})
	if err != nil {
		t.Fatal(err)
	}
	session.EnableReconnect(dialer, "127.0.0.1:12660", 1024*1024, ReconnectConfig{Enabled: true, MaxAttempts: 1, RetryDelay: time.Millisecond})
	if _, err := session.Login(context.Background(), Credentials{Account: "account", Token: "token"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(context.Background(), "", ""); err != nil {
		t.Fatal(err)
	}
	if err := session.EnterGame(context.Background()); err != nil {
		t.Fatal(err)
	}
	session.StartMessageMonitor(context.Background())
	waitFor(t, time.Second, func() bool { return firstMonitorReadActive(first) })

	if err := session.RequestReconnect(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, func() bool { return dialer.clientCount() == 2 && session.Snapshot().State == StateReady })
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
}

func firstMonitorReadActive(client gameprotocol.Client) bool {
	value, ok := client.(*reconnectClient)
	if !ok {
		return false
	}
	value.mu.Lock()
	defer value.mu.Unlock()
	return value.readStarted
}

func waitFor(t *testing.T, timeout time.Duration, predicate func() bool) {
	t.Helper()
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for !predicate() {
		select {
		case <-deadline.C:
			t.Fatal("condition was not reached before timeout")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func (d *reconnectDialer) clientCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.clients)
}

func (d *reconnectDialer) sentCounts() (int, int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.clients[0].sent), len(d.clients[1].sent)
}

type reconnectDialer struct {
	mu      sync.Mutex
	scripts [][]gameprotocol.Message
	clients []*reconnectClient
}

func (d *reconnectDialer) Dial(_ context.Context, _ string, _ uint32) (gameprotocol.Client, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	index := len(d.clients)
	if index >= len(d.scripts) {
		return nil, errors.New("no reconnect fixture available")
	}
	client := newReconnectClient(d.scripts[index], index == 0)
	d.clients = append(d.clients, client)
	return client, nil
}

type reconnectClient struct {
	mu          sync.Mutex
	responses   []gameprotocol.Message
	sent        []gameprotocol.Message
	eofOnEmpty  bool
	readStarted bool
	response    chan struct{}
	closed      chan struct{}
	closeOnce   sync.Once
}

func newReconnectClient(responses []gameprotocol.Message, eofOnEmpty bool) *reconnectClient {
	return &reconnectClient{
		responses:  append([]gameprotocol.Message(nil), responses...),
		eofOnEmpty: eofOnEmpty,
		response:   make(chan struct{}, 1), closed: make(chan struct{}),
	}
}

func (c *reconnectClient) Send(_ context.Context, message gameprotocol.Message) error {
	c.mu.Lock()
	c.sent = append(c.sent, message)
	if message.Op != nil && *message.Op == 10 {
		chatText, _ := message.StringParam(23)
		c.responses = append(c.responses, chatEcho(gameprotocol.PrivateChatChannel, chatText))
		select {
		case c.response <- struct{}{}:
		default:
		}
	}
	c.mu.Unlock()
	return nil
}

func (c *reconnectClient) Receive(ctx context.Context) (gameprotocol.Message, error) {
	c.mu.Lock()
	c.readStarted = true
	c.mu.Unlock()
	for {
		c.mu.Lock()
		if len(c.responses) > 0 {
			message := c.responses[0]
			c.responses = c.responses[1:]
			c.mu.Unlock()
			return message, nil
		}
		eofOnEmpty := c.eofOnEmpty
		c.mu.Unlock()
		if eofOnEmpty {
			return gameprotocol.Message{}, io.EOF
		}
		select {
		case <-ctx.Done():
			return gameprotocol.Message{}, ctx.Err()
		case <-c.response:
		case <-c.closed:
			return gameprotocol.Message{}, io.EOF
		}
	}
}

func (c *reconnectClient) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return nil
}
