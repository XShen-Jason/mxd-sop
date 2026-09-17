package sessioncontrol

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
)

func TestCreateStartsEnabledAccountWithoutHoldingTheRequestOpen(t *testing.T) {
	directory := t.TempDir()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
		RequireMapEvents: boolPointer(false), PostEntryInit: boolPointer(false), RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	dialer := &fakeDialer{scripts: [][]gameprotocol.Message{{accountLoginResponse(), response(6, 0), response(7, 0)}}}
	manager, err := New(catalog, dialer, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	accounts, err := NewAccountManager(manager, store)
	if err != nil {
		t.Fatal(err)
	}
	defer accounts.Close()

	created, err := accounts.Create(autostore.Account{ID: "account-1", ServerID: "local", Username: "player", CharacterID: "role-1", Enabled: true}, "GameAccountPass!")
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != AccountConnecting {
		t.Fatalf("create returned a non-progress status: %+v", created)
	}

	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for {
		current, listErr := accounts.List("local")
		if listErr != nil {
			t.Fatal(listErr)
		}
		if len(current) == 1 && current[0].Status == AccountOnline {
			break
		}
		select {
		case <-deadline.C:
			t.Fatalf("account did not finish the async login: %+v", current)
		case <-time.After(10 * time.Millisecond):
		}
	}

	stopped, err := accounts.Stop("account-1")
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Status != AccountDisabled || stopped.Enabled {
		t.Fatalf("stopped account was not disabled: %+v", stopped)
	}
	sentBefore := len(dialer.clients[0].sent)
	if _, _, err := accounts.ChatIfOnline(context.Background(), "account-1", gameprotocol.PrivateChatChannel, "drop@role-1@item@1"); !errors.Is(err, ErrAccountDisabled) {
		t.Fatalf("strict automation chat should reject a stopped account, got %v", err)
	}
	if len(dialer.clients[0].sent) != sentBefore {
		t.Fatal("strict automation chat wrote a frame for a stopped account")
	}
}

func TestCreateWithSessionBindsTheAlreadyReadySetupSession(t *testing.T) {
	directory := t.TempDir()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
		RequireMapEvents: boolPointer(false), PostEntryInit: boolPointer(false), RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	dialer := &fakeDialer{scripts: [][]gameprotocol.Message{{accountLoginResponse(), response(6, 0), response(7, 0)}}}
	manager, err := New(catalog, dialer, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	accounts, err := NewAccountManager(manager, store)
	if err != nil {
		t.Fatal(err)
	}
	defer accounts.Close()

	session, err := manager.Start(context.Background(), "local", Credentials{Account: "player", Password: "GameAccountPass!"})
	if err != nil {
		t.Fatal(err)
	}
	session, err = manager.SelectAndEnter(context.Background(), session.ID, "role-1", "")
	if err != nil {
		t.Fatal(err)
	}
	created, err := accounts.CreateWithSession(autostore.Account{ID: "account-1", ServerID: "local", Username: "player", CharacterID: "role-1", Enabled: true}, "GameAccountPass!", session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != AccountOnline || created.SessionID != session.ID || created.Session == nil || created.Session.State != gamesession.StateReady {
		t.Fatalf("setup session was not adopted: %+v", created)
	}
	if len(dialer.clients[0].sent) != 3 {
		t.Fatalf("adopting a session caused a duplicate login: %d frames", len(dialer.clients[0].sent))
	}
}

func boolPointer(value bool) *bool { return &value }

func accountLoginResponse() gameprotocol.Message {
	operation, code := 0, 0
	return gameprotocol.Message{Type: "resp", Op: &operation, RC: &code, Params: []gameprotocol.Param{{
		ID: 1, Value: map[string]any{"characters": []any{map[string]any{"charid": "role-1", "name": "Player", "opaque": "role-opaque"}}},
	}}}
}
