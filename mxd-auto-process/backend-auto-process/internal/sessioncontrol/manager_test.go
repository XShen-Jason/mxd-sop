package sessioncontrol

import (
	"context"
	"testing"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
)

func TestManagerEnforcesCapacityAndReleasesStoppedSession(t *testing.T) {
	catalog := testCatalog(t)
	dialer := &fakeDialer{scripts: [][]gameprotocol.Message{{response(0, 0)}, {response(0, 0)}}}
	manager, err := New(catalog, dialer, 1)
	if err != nil {
		t.Fatal(err)
	}
	first, err := manager.Start(context.Background(), "local", Credentials{Account: "a", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(context.Background(), "local", Credentials{Account: "b", Token: "t"}); err != ErrCapacityFull {
		t.Fatalf("expected capacity error, got %v", err)
	}
	if err := manager.Stop(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(context.Background(), "local", Credentials{Account: "b", Token: "t"}); err != nil {
		t.Fatalf("capacity was not released: %v", err)
	}
	_ = manager.Close()
}

func TestManagerDelegatesTheCompleteFlow(t *testing.T) {
	catalog := testCatalog(t)
	dialer := &fakeDialer{scripts: [][]gameprotocol.Message{{
		response(0, 0), response(6, 0), response(7, 0), event(2), mapEvent("211000000:ch1"), response(8, 0),
		managerSystemEvent("server accepted chat"),
	}}}
	manager, err := New(catalog, dialer, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	snapshot, err := manager.Start(context.Background(), "local", Credentials{Account: "a", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.State != gamesession.StateLoggedIn {
		t.Fatalf("unexpected start state: %+v", snapshot)
	}
	if snapshot, err = manager.Select(context.Background(), snapshot.ID, "role-1", "runtime-opaque"); err != nil {
		t.Fatal(err)
	}
	if snapshot.State != gamesession.StateCharacterReady {
		t.Fatalf("unexpected select state: %+v", snapshot)
	}
	if snapshot, err = manager.Enter(context.Background(), snapshot.ID); err != nil {
		t.Fatal(err)
	}
	if snapshot.State != gamesession.StateReady {
		t.Fatalf("unexpected enter state: %+v", snapshot)
	}
	chat, snapshot, err := manager.Chat(context.Background(), snapshot.ID, "111")
	if err != nil || chat.Status != gamesession.ChatStatusServerResponse || chat.ServerResponse != "server accepted chat" || snapshot.SentMessages != 1 {
		t.Fatalf("unexpected chat result: %+v %+v %v", chat, snapshot, err)
	}
	if len(dialer.clients[0].sent) != 5 {
		t.Fatalf("unexpected request count: %d", len(dialer.clients[0].sent))
	}
}

func TestManagerSelectAndEnterCompletesAndCanBeRetriedAfterReady(t *testing.T) {
	catalog := testCatalog(t)
	dialer := &fakeDialer{scripts: [][]gameprotocol.Message{{
		response(0, 0), response(6, 0), response(7, 0), event(2), mapEvent("211000000:ch1"), response(8, 0),
	}}}
	manager, err := New(catalog, dialer, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()

	snapshot, err := manager.Start(context.Background(), "local", Credentials{Account: "a", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err = manager.SelectAndEnter(context.Background(), snapshot.ID, "role-1", "runtime-opaque")
	if err != nil || snapshot.State != gamesession.StateReady {
		t.Fatalf("combined setup did not enter the game: %+v %v", snapshot, err)
	}
	if _, err := manager.SelectAndEnter(context.Background(), snapshot.ID, "role-1", "runtime-opaque"); err != nil {
		t.Fatalf("ready setup was not retryable: %v", err)
	}
	if len(dialer.clients[0].sent) != 4 {
		t.Fatalf("retry sent duplicate setup frames: %d", len(dialer.clients[0].sent))
	}
}

func TestManagerWiresAutomaticRoleOpaqueResolver(t *testing.T) {
	catalog := testCatalog(t)
	dialer := &fakeDialer{scripts: [][]gameprotocol.Message{{response(0, 0), response(6, 0)}}}
	resolver := &managerOpaqueResolver{}
	manager, err := NewWithRoleOpaqueResolver(catalog, dialer, 1, resolver)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	snapshot, err := manager.Start(context.Background(), "local", Credentials{Account: "a", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Select(context.Background(), snapshot.ID, "role-1", ""); err != nil {
		t.Fatal(err)
	}
	if resolver.serverAddress != "127.0.0.1:12660" || resolver.characterID != "role-1" {
		t.Fatalf("resolver was not given session context: %+v", resolver)
	}
	if value, _ := dialer.clients[0].sent[1].StringParam(81); value != "resolved-by-manager" {
		t.Fatalf("unexpected resolved opaque: %q", value)
	}
}

func testCatalog(t *testing.T) *servercatalog.Catalog {
	t.Helper()
	requireEvents, postInit := true, true
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{
		{
			ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
			RequestTimeoutSeconds: 1, MapReadyTimeoutSeconds: 1, RequireMapEvents: &requireEvents, PostEntryInit: &postInit,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

type fakeDialer struct {
	scripts [][]gameprotocol.Message
	clients []*scriptedClient
}

func (d *fakeDialer) Dial(_ context.Context, _ string, _ uint32) (gameprotocol.Client, error) {
	index := len(d.clients)
	client := &scriptedClient{}
	if index < len(d.scripts) {
		client.responses = append(client.responses, d.scripts[index]...)
	}
	d.clients = append(d.clients, client)
	return client, nil
}

type scriptedClient struct {
	responses []gameprotocol.Message
	sent      []gameprotocol.Message
	closed    bool
}

type managerOpaqueResolver struct {
	serverAddress string
	characterID   string
}

func (r *managerOpaqueResolver) Resolve(_ context.Context, serverAddress, characterID string) (string, bool, error) {
	r.serverAddress = serverAddress
	r.characterID = characterID
	return "resolved-by-manager", true, nil
}

func (c *scriptedClient) Send(_ context.Context, message gameprotocol.Message) error {
	c.sent = append(c.sent, message)
	return nil
}

func (c *scriptedClient) Receive(ctx context.Context) (gameprotocol.Message, error) {
	if len(c.responses) == 0 {
		<-ctx.Done()
		return gameprotocol.Message{}, ctx.Err()
	}
	message := c.responses[0]
	c.responses = c.responses[1:]
	return message, nil
}

func (c *scriptedClient) Close() error {
	c.closed = true
	return nil
}

func response(operation, code int) gameprotocol.Message {
	operationValue, codeValue := operation, code
	return gameprotocol.Message{Type: "resp", Op: &operationValue, RC: &codeValue, Params: []gameprotocol.Param{}}
}

func event(eventID int) gameprotocol.Message {
	return messageEvent(eventID, nil)
}

func mapEvent(value string) gameprotocol.Message {
	return messageEvent(64, []gameprotocol.Param{{ID: 64, Value: value}})
}

func messageEvent(eventID int, params []gameprotocol.Param) gameprotocol.Message {
	return gameprotocol.Message{Type: "evt", Event: &eventID, Params: params}
}

func managerSystemEvent(text string) gameprotocol.Message {
	return messageEvent(20, []gameprotocol.Param{{ID: 36, Value: text}, {ID: 65, Value: "System"}})
}
