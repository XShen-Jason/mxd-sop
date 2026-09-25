package autostore

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenMigratesLegacyAccountsToPasswordCredentials(t *testing.T) {
	directory := t.TempDir()
	databasePath := filepath.Join(directory, "auto.sqlite")
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE game_accounts (
		id TEXT PRIMARY KEY, server_id TEXT NOT NULL, username TEXT NOT NULL,
		character_id TEXT NOT NULL, character_name TEXT NOT NULL DEFAULT '',
		password_cipher TEXT NOT NULL, enabled INTEGER NOT NULL,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		UNIQUE (server_id, username COLLATE NOCASE)
	)`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO game_accounts VALUES
		('old-on', 'local', 'on', '1', '', 'cipher', 1, 'before', 'before'),
		('old-off', 'local', 'off', '2', '', 'cipher', 0, 'before', 'before')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(databasePath, filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, id := range []string{"old-on", "old-off"} {
		account, ok, err := store.Account(id)
		if err != nil || !ok || account.AutomationEnabled != account.Enabled {
			t.Fatalf("legacy migration: %+v %v", account, err)
		}
	}
	legacy, _, _ := store.Account("old-on")
	legacy.AutomationEnabled = false
	if _, err := store.UpdateAccount(legacy, ""); err != nil {
		t.Fatal(err)
	}
	if err := ensureAccountAutomationColumn(store.db); err != nil {
		t.Fatal(err)
	}
	legacy, _, _ = store.Account("old-on")
	if legacy.AutomationEnabled || !legacy.Enabled {
		t.Fatal("repeated migration must not re-enable automation or log out")
	}
	created, err := store.CreateAccount(Account{ID: "legacy-compatible", ServerID: "local", Username: "player", CharacterID: "role-1", Enabled: false}, "plain-password")
	if err != nil {
		t.Fatal(err)
	}
	if created.CredentialType != CredentialPassword {
		t.Fatalf("legacy credential type = %q, want %q", created.CredentialType, CredentialPassword)
	}
	if created.AutomationEnabled {
		t.Fatal("new accounts must default to manual-only")
	}
}

func TestMD5CredentialIsPreservedExactly(t *testing.T) {
	directory := t.TempDir()
	store, err := Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const token = "5AA765D61D8327DE"
	created, err := store.CreateAccount(Account{ID: "md5", ServerID: "local", Username: "player", CharacterID: "role-1", CredentialType: CredentialMD5}, token)
	if err != nil {
		t.Fatal(err)
	}
	username, credential, credentialType, err := store.Credentials(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if username != "player" || credential != token || credentialType != CredentialMD5 {
		t.Fatalf("stored credentials changed: username=%q credential=%q type=%q", username, credential, credentialType)
	}
}
