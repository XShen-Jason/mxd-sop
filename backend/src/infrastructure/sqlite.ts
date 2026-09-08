import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'manager', 'super_admin')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      created_by_json TEXT
    );
    CREATE INDEX IF NOT EXISTS users_role_active ON users(role, active);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS operation_groups (
      id TEXT PRIMARY KEY,
      submitted_by_id TEXT NOT NULL,
      status TEXT NOT NULL,
      server_id TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      idempotency_key TEXT,
      request_fingerprint TEXT,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      last_reminded_at TEXT,
      last_reminded_by_json TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS groups_status_submitted ON operation_groups(status, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS groups_submitter_submitted ON operation_groups(submitted_by_id, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS groups_server_status ON operation_groups(server_id, status, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS groups_submitter_idempotency ON operation_groups(submitted_by_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS groups_submitted_id ON operation_groups(submitted_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      rewards_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activities_updated ON activities(updated_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS player_directory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      char_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      bind_qq TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      UNIQUE(server_id, char_id, user_id, username, bind_qq)
    );
    CREATE INDEX IF NOT EXISTS player_directory_search ON player_directory(server_id, username COLLATE NOCASE, char_id);
    CREATE INDEX IF NOT EXISTS player_directory_user_id ON player_directory(server_id, user_id COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS player_directory_char_id ON player_directory(char_id, server_id);
    CREATE INDEX IF NOT EXISTS player_directory_qq ON player_directory(bind_qq, server_id);
    CREATE TABLE IF NOT EXISTS team_view_clears (
      date TEXT NOT NULL,
      server_id TEXT NOT NULL,
      boss_type TEXT NOT NULL CHECK (boss_type IN ('black-dragon', 'zakum')),
      char_id TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (date, server_id, boss_type, char_id)
    );
    CREATE TABLE IF NOT EXISTS team_view_snapshots (
      date TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS team_view_snapshots_fetched ON team_view_snapshots(fetched_at DESC);
    CREATE TABLE IF NOT EXISTS player_integration_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL CHECK (mode IN ('local', 'remote')),
      updated_at TEXT NOT NULL,
      updated_by_id TEXT,
      updated_by_name TEXT
    );
  `);
  const columns = db.prepare('PRAGMA table_info(operation_groups)').all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has('reminder_count')) db.exec('ALTER TABLE operation_groups ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0');
  if (!existing.has('last_reminded_at')) db.exec('ALTER TABLE operation_groups ADD COLUMN last_reminded_at TEXT');
  if (!existing.has('last_reminded_by_json')) db.exec('ALTER TABLE operation_groups ADD COLUMN last_reminded_by_json TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS groups_reminders ON operation_groups(submitted_by_id, status, reminder_count, submitted_at DESC, id DESC)');
  return db;
}

export type SqliteDatabase = ReturnType<typeof openDatabase>;
