package gamesession

import (
	"context"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestProtocolStateExposesStoredKeysOnlyThroughExplicitDiagnostic(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponse(), response(6, 0), response(7, 0), event(2), mapEvent("211000000:ch1"), response(8, 0),
	}}
	session, err := New(client, Config{
		Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second,
		MapReadyTimeout: time.Second, RequireMapEvents: true, PostEntryInit: true,
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
	state := session.ProtocolState()
	if state.ServerKey != "fixture-login-key" || state.SelectedRoleOpaque != "fixture-opaque" {
		t.Fatalf("diagnostic state did not expose stored values: %+v", state)
	}
	if state.ServerKeyIncludedInChat || state.ServerKeyIncludedInSelect || !state.RoleOpaqueIncludedInSelect {
		t.Fatalf("unexpected protocol key usage: %+v", state)
	}
}

func TestKeylessChatClearsStoredServerKeyAndUsesOnlyChatFields(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		loginResponse(), response(6, 0), response(7, 0), event(2), mapEvent("211000000:ch1"), response(8, 0),
	}}
	session, err := New(client, Config{
		Version: "1.0.2", MapID: "211000000", RequestTimeout: time.Second,
		MapReadyTimeout: time.Second, RequireMapEvents: true, PostEntryInit: true,
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
	result, err := session.SendPrivateChatWithoutKey(ctx, "111")
	if err != nil {
		t.Fatal(err)
	}
	if result.ServerKeyIncluded || result.ConnectionMode != "authenticated_connection_without_stored_key" {
		t.Fatalf("unexpected keyless result: %+v", result)
	}
	if state := session.ProtocolState(); state.ServerKeyStored || state.ServerKey != "" {
		t.Fatalf("stored server key was not discarded: %+v", state)
	}
	chat := client.sent[len(client.sent)-1]
	if chat.Op == nil || *chat.Op != 10 || len(chat.Params) != 2 {
		t.Fatalf("keyless chat included unexpected fields: %+v", chat)
	}
	if _, ok := chat.Param(1); ok {
		t.Fatal("keyless chat unexpectedly included login token field")
	}
}

func TestProbePrivateChatWithoutLoginSendsOneUnattributedOperation(t *testing.T) {
	client := &scriptedClient{}
	result, err := ProbePrivateChatWithoutLogin(context.Background(), client, Config{RequestTimeout: time.Second}, "111")
	if err != nil {
		t.Fatal(err)
	}
	if result.ConnectionMode != "fresh_connection_without_login" || result.ServerKeyIncluded {
		t.Fatalf("unexpected probe result: %+v", result)
	}
	if len(client.sent) != 1 || client.sent[0].Op == nil || *client.sent[0].Op != 10 {
		t.Fatalf("probe sent unexpected operations: %+v", client.sent)
	}
	if _, ok := client.sent[0].Param(0); ok {
		t.Fatal("probe unexpectedly included account field")
	}
}
