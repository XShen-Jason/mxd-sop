package gamesession

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestChatOwnsFramedReadsWhileMessageMonitorIsActive(t *testing.T) {
	client := newMonitorClient()
	session, err := New(client, Config{RequestTimeout: time.Second, ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.mu.Lock()
	session.state = StateReady
	session.mu.Unlock()

	monitorContext, cancelMonitor := context.WithCancel(context.Background())
	defer cancelMonitor()
	session.StartMessageMonitor(monitorContext)
	select {
	case <-client.firstReceiveStarted:
	case <-time.After(time.Second):
		t.Fatal("message monitor did not start reading")
	}

	chatDone := make(chan struct {
		result ChatResult
		err    error
	}, 1)
	go func() {
		result, chatErr := session.SendPrivateChat(context.Background(), "hello")
		chatDone <- struct {
			result ChatResult
			err    error
		}{result: result, err: chatErr}
	}()
	select {
	case <-client.chatSent:
	case <-time.After(time.Second):
		t.Fatal("chat did not acquire the transport while monitor was reading")
	}

	select {
	case outcome := <-chatDone:
		if outcome.err != nil {
			t.Fatalf("chat failed while monitor was active: %v", outcome.err)
		}
		if outcome.result.Status != ChatStatusServerResponse || outcome.result.ServerResponse != "accepted" {
			t.Fatalf("chat did not receive its response: %+v", outcome.result)
		}
	case <-time.After(time.Second):
		t.Fatal("chat did not complete")
	}
	cancelMonitor()
	if got := client.maxConcurrentReceives(); got != 1 {
		t.Fatalf("framed reads ran concurrently: max=%d", got)
	}
	client.mu.Lock()
	responseClaimed := client.responseClaimed
	client.mu.Unlock()
	if !responseClaimed {
		t.Fatal("chat did not claim its matching server response")
	}
}

type monitorClient struct {
	firstReceiveStarted chan struct{}
	chatSent            chan struct{}
	firstOnce           sync.Once
	chatOnce            sync.Once
	mu                  sync.Mutex
	receives            int
	activeReceives      int
	maxReceives         int
	responseClaimed     bool
}

func newMonitorClient() *monitorClient {
	return &monitorClient{
		firstReceiveStarted: make(chan struct{}),
		chatSent:            make(chan struct{}),
	}
}

func (c *monitorClient) Send(_ context.Context, message gameprotocol.Message) error {
	if message.IsResponse(10) || message.Op == nil || *message.Op != 10 {
		return nil
	}
	c.chatOnce.Do(func() { close(c.chatSent) })
	return nil
}

func (c *monitorClient) Receive(ctx context.Context) (gameprotocol.Message, error) {
	c.mu.Lock()
	c.receives++
	call := c.receives
	c.activeReceives++
	if c.activeReceives > c.maxReceives {
		c.maxReceives = c.activeReceives
	}
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.activeReceives--
		c.mu.Unlock()
	}()

	if call == 1 {
		c.firstOnce.Do(func() { close(c.firstReceiveStarted) })
		select {
		case <-ctx.Done():
			return gameprotocol.Message{}, ctx.Err()
		}
	}
	if call == 2 {
		select {
		case <-c.chatSent:
			c.mu.Lock()
			c.responseClaimed = true
			c.mu.Unlock()
			return monitorSystemEvent("accepted"), nil
		case <-ctx.Done():
			return gameprotocol.Message{}, ctx.Err()
		}
	}
	<-ctx.Done()
	return gameprotocol.Message{}, ctx.Err()
}

func (c *monitorClient) Close() error { return nil }

func (c *monitorClient) maxConcurrentReceives() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.maxReceives
}

func monitorSystemEvent(text string) gameprotocol.Message {
	eventID := 20
	return gameprotocol.Message{Type: "evt", Event: &eventID, Params: []gameprotocol.Param{
		{ID: 36, Value: text}, {ID: 65, Value: "System"},
	}}
}
