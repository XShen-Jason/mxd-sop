package autostore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/local/mxd-auto-process/internal/servercatalog"
)

func TestRemoveServerDeletesAccountsAndCatalogInOneStoreTransaction(t *testing.T) {
	directory := t.TempDir()
	serverPath := filepath.Join(directory, "servers.json")
	document, err := json.Marshal(map[string]any{"servers": []map[string]any{{
		"id": "local", "name": "Local", "address": "127.0.0.1:12660", "version": "1.0.2", "map_id": "211000000", "enabled": true,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(serverPath, document, 0600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	catalog, err := servercatalog.LoadWithPersistence(serverPath, store)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAccount(Account{ID: "account-1", ServerID: "local", Username: "player", CharacterID: "role-1", Enabled: true}, "GameAccountPass!"); err != nil {
		t.Fatal(err)
	}
	if err := catalog.Remove("local"); err != nil {
		t.Fatal(err)
	}
	accounts, err := store.Accounts("local")
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) != 0 {
		t.Fatalf("accounts were not deleted: %+v", accounts)
	}
	if entries, found, err := store.LoadServerCatalog(); err != nil || !found || len(entries) != 0 {
		t.Fatalf("catalog was not atomically updated: found=%v entries=%+v err=%v", found, entries, err)
	}
}
