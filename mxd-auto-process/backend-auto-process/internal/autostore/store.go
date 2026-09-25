package autostore

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	OperatorUsername        = "admin"
	minOperatorPasswordSize = 6
	minAccountPasswordSize  = 1
	maxAuditEntries         = 5000
)

var (
	ErrAccountNotFound  = errors.New("account not found")
	ErrDuplicateAccount = errors.New("account already exists")
	ErrInvalidAccount   = errors.New("account is invalid")
	ErrInvalidPassword  = errors.New("password does not meet requirements")
)

type Account struct {
	ID                string `json:"id"`
	ServerID          string `json:"server_id"`
	Username          string `json:"username"`
	CharacterID       string `json:"character_id"`
	CharacterName     string `json:"character_name,omitempty"`
	CredentialType    string `json:"credential_type"`
	PasswordCipher    string `json:"-"`
	Enabled           bool   `json:"enabled"`
	AutomationEnabled bool   `json:"automation_enabled"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

type AuditEntry struct {
	ID         string         `json:"id"`
	CreatedAt  string         `json:"created_at"`
	RequestID  string         `json:"request_id,omitempty"`
	Method     string         `json:"method"`
	Path       string         `json:"path"`
	Actor      string         `json:"actor,omitempty"`
	Action     string         `json:"action,omitempty"`
	Status     int            `json:"status"`
	DurationMS int64          `json:"duration_ms"`
	Detail     map[string]any `json:"detail,omitempty"`
}

type OperatorState struct {
	Username   string `json:"username"`
	MustChange bool   `json:"must_change"`
}

type Store struct {
	db  *sql.DB
	key []byte
}

func Open(path, keyPath, initialPassword string) (*Store, error) {
	if strings.TrimSpace(initialPassword) == "" {
		initialPassword = "ChangeMe-26909!"
	}
	if len(initialPassword) < minOperatorPasswordSize {
		return nil, ErrInvalidPassword
	}
	key, err := loadKey(keyPath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create auto database directory: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open auto database: %w", err)
	}
	store := &Store{db: db, key: key}
	if err := store.initialize(initialPassword); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) initialize(initialPassword string) error {
	const schema = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS operator (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL CHECK (must_change IN (0, 1))
);
CREATE TABLE IF NOT EXISTS game_accounts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  username TEXT NOT NULL,
  character_id TEXT NOT NULL,
  character_name TEXT NOT NULL DEFAULT '',
  credential_type TEXT NOT NULL DEFAULT 'password' CHECK (credential_type IN ('password', 'md5')),
  password_cipher TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  automation_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automation_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (server_id, username COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS game_accounts_server ON game_accounts(server_id, created_at);
CREATE TABLE IF NOT EXISTS server_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  request_id TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_logs_created ON audit_logs(created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS automation_executions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  commands_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failure')),
  attempts INTEGER NOT NULL DEFAULT 0,
  selected_account_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS automation_executions_server ON automation_executions(server_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS automation_round_robin (
  server_id TEXT PRIMARY KEY,
  last_account_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("initialize auto database: %w", err)
	}
	if err := ensureCredentialTypeColumn(s.db); err != nil {
		return fmt.Errorf("migrate account credential type: %w", err)
	}
	if err := ensureAccountAutomationColumn(s.db); err != nil {
		return fmt.Errorf("migrate account automation: %w", err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM operator").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := hashPassword(initialPassword)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO operator (id, username, password_hash, must_change) VALUES (1, ?, ?, 1)", OperatorUsername, hash)
	return err
}

func ensureCredentialTypeColumn(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(game_accounts)")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == "credential_type" {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.Exec("ALTER TABLE game_accounts ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'password' CHECK (credential_type IN ('password', 'md5'))")
	return err
}
