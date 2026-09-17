package gamesession

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestSelectionCanRetryWithExplicitOpaqueWhenLoginOmittedIt(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponseWithoutOpaque(), response(6, 0),
	}}
	session, err := New(client, Config{Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	login, err := session.Login(ctx, Credentials{Account: "a", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if len(login.Roles) != 1 || login.Roles[0].OpaqueAvailable {
		t.Fatalf("login unexpectedly supplied role opaque: %+v", login.Roles)
	}
	if err := session.SelectCharacter(ctx, "role-1", ""); !errors.Is(err, ErrMissingRoleOpaque) {
		t.Fatalf("expected missing opaque error, got %v", err)
	}
	if session.Snapshot().State != StateLoggedIn {
		t.Fatal("missing opaque validation did not preserve logged-in state")
	}
	if err := session.SelectCharacter(ctx, "role-1", "runtime-opaque"); err != nil {
		t.Fatal(err)
	}
	if session.Snapshot().State != StateCharacterReady {
		t.Fatal("explicit opaque did not complete character selection")
	}
	if got, _ := client.sent[1].StringParam(81); got != "runtime-opaque" {
		t.Fatalf("unexpected field 81 value: %q", got)
	}
}

func TestSelectionAutomaticallyUsesTheOnlyReturnedRole(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponseWithOpaque("only-role-opaque"), response(6, 0),
	}}
	session, err := New(client, Config{Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.Login(context.Background(), Credentials{Account: "a", Token: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(context.Background(), "", ""); err != nil {
		t.Fatal(err)
	}
	if value, _ := client.sent[1].StringParam(10); value != "role-1" {
		t.Fatalf("unexpected automatically selected role: %q", value)
	}
}

func TestSelectionUsesAutomaticOpaqueResolverBeforeReturningMissingValue(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponseWithoutOpaque(), response(6, 0),
	}}
	resolver := &testRoleOpaqueResolver{opaque: "resolved-opaque"}
	session, err := New(client, Config{
		Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second,
		ServerAddress: "45.117.11.230:12660", RoleOpaqueResolver: resolver,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.Login(context.Background(), Credentials{Account: "a", Token: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SelectCharacter(context.Background(), "role-1", ""); err != nil {
		t.Fatal(err)
	}
	if resolver.serverAddress != "45.117.11.230:12660" || resolver.characterID != "role-1" {
		t.Fatalf("resolver received wrong context: %+v", resolver)
	}
	if got, _ := client.sent[1].StringParam(81); got != "resolved-opaque" {
		t.Fatalf("unexpected automatically resolved opaque: %q", got)
	}
}

func TestSelectionUsesOpaqueReturnedByEachLogin(t *testing.T) {
	for _, want := range []string{"server-opaque-a", "server-opaque-b"} {
		client := &scriptedClient{responses: []gameprotocol.Message{
			loginResponseWithOpaque(want), response(6, 0),
		}}
		session, err := New(client, Config{Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second})
		if err != nil {
			t.Fatal(err)
		}
		login, err := session.Login(context.Background(), Credentials{Account: "a", Token: "t"})
		if err != nil {
			t.Fatal(err)
		}
		if len(login.Roles) != 1 || !login.Roles[0].OpaqueAvailable {
			t.Fatalf("login opaque was not exposed as available: %+v", login.Roles)
		}
		if err := session.SelectCharacter(context.Background(), "role-1", ""); err != nil {
			t.Fatal(err)
		}
		if got, _ := client.sent[1].StringParam(81); got != want {
			t.Fatalf("selection did not use current login opaque: got %q want %q", got, want)
		}
	}
}

func loginResponseWithoutOpaque() gameprotocol.Message {
	return messageWithParams(0, 0,
		gameprotocol.Param{ID: 0, Value: `{"charid":"\"role-1\"","nickname":"Fixture"}`},
		gameprotocol.Param{ID: 1, Value: `{"key":"fixture-login-key"}`},
	)
}

func loginResponseWithOpaque(opaque string) gameprotocol.Message {
	return messageWithParams(0, 0,
		gameprotocol.Param{ID: 0, Value: `{"charid":"\"role-1\"","nickname":"Fixture"}`},
		gameprotocol.Param{ID: 1, Value: map[string]any{
			"key": "fixture-login-key",
			"roles": []any{map[string]any{
				"roleId": "role-1", "roleName": "Fixture", "opaque": opaque,
			}},
		}},
	)
}

type testRoleOpaqueResolver struct {
	serverAddress string
	characterID   string
	opaque        string
}

func (r *testRoleOpaqueResolver) Resolve(_ context.Context, serverAddress, characterID string) (string, bool, error) {
	r.serverAddress = serverAddress
	r.characterID = characterID
	return r.opaque, true, nil
}
