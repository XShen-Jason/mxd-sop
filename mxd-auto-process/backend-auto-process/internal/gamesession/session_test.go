package gamesession

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestSessionRunsOrderedFlowAgainstLocalTCPFixture(t *testing.T) {
	serverConnection, clientConnection := net.Pipe()
	client := gameprotocol.NewTCPClient(clientConnection, 1024*1024)
	session, err := New(client, Config{
		Version:          "1.0.2",
		MapID:            "211000000",
		RequestTimeout:   time.Second,
		MapReadyTimeout:  time.Second,
		RequireMapEvents: true,
		PostEntryInit:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan error, 1)
	go serveSessionFixture(serverConnection, serverDone)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	login, err := session.Login(ctx, Credentials{Account: "test-account", Password: "test-password"})
	if err != nil {
		t.Fatal(err)
	}
	if len(login.Roles) != 1 || !login.Roles[0].OpaqueAvailable {
		t.Fatalf("role list was not parsed: %+v", login.Roles)
	}
	if err := session.SelectCharacter(ctx, "role-1", ""); err != nil {
		t.Fatal(err)
	}
	if err := session.EnterGame(ctx); err != nil {
		t.Fatal(err)
	}
	result, err := session.SendPrivateChat(ctx, "111")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != ChatStatusServerResponse || result.ServerResponse != "fixture chat response" {
		t.Fatalf("unexpected chat status: %+v", result)
	}
	if snapshot := session.Snapshot(); snapshot.State != StateReady || snapshot.SentMessages != 1 || !snapshot.ServerKeyStored {
		t.Fatalf("unexpected final snapshot: %+v", snapshot)
	}
	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestSessionMinimalRetentionCanUseExplicitRuntimeOpaque(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponse(), response(6, 0), response(7, 0), event(2), mapEvent("211000000:ch1"), response(8, 0),
	}}
	session, err := New(client, Config{
		Version:                "1.0.2",
		MapID:                  "211000000",
		RequestTimeout:         time.Second,
		MapReadyTimeout:        time.Second,
		RequireMapEvents:       true,
		PostEntryInit:          true,
		RetentionMode:          RetainMinimal,
		AllowResponseOnlyReady: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	login, err := session.Login(ctx, Credentials{Account: "runtime-account", Token: "runtime-token"})
	if err != nil {
		t.Fatal(err)
	}
	if len(login.Roles) != 0 || login.ServerKeyStored {
		t.Fatalf("minimal retention exposed stored login data: %+v", login)
	}
	if err := session.SelectCharacter(ctx, "role-1", "runtime-opaque"); err != nil {
		t.Fatal(err)
	}
	if err := session.EnterGame(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := session.SendPrivateChat(ctx, "111"); err != nil {
		t.Fatal(err)
	}
	if session.Snapshot().ServerKeyStored {
		t.Fatal("minimal retention stored a login key")
	}
	opaque, _ := client.sent[1].StringParam(81)
	if len(client.sent) != 5 || opaque != "runtime-opaque" {
		t.Fatalf("unexpected requests: %+v", client.sent)
	}
}

func TestEnterUsesMapReturnedByCharacterSelection(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponse(),
		messageWithParams(6, 0, gameprotocol.Param{ID: 0, Value: `{"charid":"role-1","mapId":"role-map"}`}),
		response(7, 0),
	}}
	session, err := New(client, Config{
		Version: "1.0.2", MapID: "configured-map", RequestTimeout: time.Second,
		RequireMapEvents: false, PostEntryInit: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := session.Login(ctx, Credentials{Account: "a", Token: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(ctx, "role-1", ""); err != nil {
		t.Fatal(err)
	}
	if err := session.EnterGame(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := client.sent[2].StringParam(16); got != "role-map" {
		t.Fatalf("enter map ignored selected character map: got %q", got)
	}
}

func TestEntryResponseAloneDoesNotBecomeReady(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{response(0, 0), response(6, 0), response(7, 0)}}
	session, err := New(client, Config{
		Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second,
		MapReadyTimeout: 20 * time.Millisecond, RequireMapEvents: true, PostEntryInit: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := session.Login(ctx, Credentials{Account: "a", Token: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(ctx, "role-1", "opaque"); err != nil {
		t.Fatal(err)
	}
	if err := session.EnterGame(ctx); !errors.Is(err, ErrMapInitializationTimeout) {
		t.Fatalf("expected map initialization timeout, got %v", err)
	}
	if session.Snapshot().State != StateFailed {
		t.Fatal("map initialization timeout did not fail the session")
	}
}

func TestSessionRejectsOperationsOutOfOrder(t *testing.T) {
	session, err := New(&scriptedClient{}, Config{MapID: "211000000"})
	if err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(context.Background(), "role-1", "opaque"); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected invalid state, got %v", err)
	}
}

func TestMissingOpaqueDoesNotDestroyLoggedInSession(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{response(0, 0)}}
	session, err := New(client, Config{Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.Login(context.Background(), Credentials{Account: "a", Token: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(context.Background(), "role-1", ""); !errors.Is(err, ErrMissingRoleOpaque) {
		t.Fatalf("expected missing opaque error, got %v", err)
	}
	if session.Snapshot().State != StateLoggedIn {
		t.Fatal("input validation changed the session state")
	}
}
