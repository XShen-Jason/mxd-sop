package gamesession

import (
	"context"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestLoginParsesObservedJSONEncodedRoleAndServerKey(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		messageWithParams(0, 0,
			gameprotocol.Param{ID: 0, Value: `{"charid":"\"315\"","nickname":"Test"}`},
			gameprotocol.Param{ID: 1, Value: `{"key":"fixture-login-key"}`},
		),
	}}
	session, err := New(client, Config{Version: "1.0.2", RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}

	result, err := session.Login(context.Background(), Credentials{Account: "a", Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Roles) != 1 || result.Roles[0].ID != "315" || result.Roles[0].Name != "Test" {
		t.Fatalf("unexpected roles: %+v", result.Roles)
	}
	if result.Roles[0].OpaqueAvailable || !result.ServerKeyStored {
		t.Fatalf("unexpected login credentials: %+v", result)
	}
}

func TestObservedJSONEncodedMapIDIsExtracted(t *testing.T) {
	message := messageWithParams(6, 0, gameprotocol.Param{
		ID:    0,
		Value: `{"charid":"\"315\"","mapId":"\"211000000\""}`,
	})
	if got := extractMapID(message); got != "211000000" {
		t.Fatalf("unexpected map id: %q", got)
	}
}

func TestConfiguredServerKeyFieldUnwrapsJSONString(t *testing.T) {
	message := messageWithParams(0, 0, gameprotocol.Param{
		ID:    1,
		Value: `{"key":"fixture-login-key"}`,
	})
	if got := extractServerKey(message, 1); got != "fixture-login-key" {
		t.Fatalf("unexpected server key: %q", got)
	}
}

func TestLoginParsesOpaqueFromField81ResponseParameter(t *testing.T) {
	message := messageWithParams(0, 0,
		gameprotocol.Param{ID: 0, Value: `{"nickname":"Test"}`},
		gameprotocol.Param{ID: 10, Value: "315"},
		gameprotocol.Param{ID: 81, Value: map[string]any{"opaque": "server-opaque"}},
	)
	roles := extractRoleCredentials(message)
	if len(roles) != 1 || roles[0].option.ID != "315" || roles[0].opaque != "server-opaque" {
		t.Fatalf("field 81 opaque was not parsed: %+v", roles)
	}
}
