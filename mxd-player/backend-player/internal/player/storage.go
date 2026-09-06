package player

import (
	"database/sql"
	"strings"
)

func migrate(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS player_accounts (
 id INTEGER PRIMARY KEY, server TEXT NOT NULL, qq TEXT NOT NULL,
 game_account TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
 UNIQUE(server,qq,game_account));
CREATE TABLE IF NOT EXISTS player_characters (
 id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
 character_id TEXT NOT NULL, UNIQUE(account_id,character_id));
CREATE TABLE IF NOT EXISTS player_sessions (
 token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS player_sessions_expiry ON player_sessions(expires_at);
CREATE TABLE IF NOT EXISTS player_teams (
 id TEXT PRIMARY KEY, server TEXT NOT NULL, boss_type TEXT NOT NULL CHECK(boss_type IN ('black-dragon','zakum')),
 invite_code TEXT NOT NULL UNIQUE, leader_account_id INTEGER NOT NULL REFERENCES player_accounts(id),
 leader_character_id TEXT NOT NULL, day_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
 merged_into_team_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS player_team_members (
 team_id TEXT NOT NULL REFERENCES player_teams(id) ON DELETE CASCADE,
 account_id INTEGER NOT NULL REFERENCES player_accounts(id), boss_type TEXT NOT NULL CHECK(boss_type IN ('black-dragon','zakum')),
 character_id TEXT NOT NULL, day_key TEXT NOT NULL DEFAULT '', joined_at TEXT NOT NULL,
 PRIMARY KEY(team_id,account_id), UNIQUE(team_id,character_id));
CREATE TABLE IF NOT EXISTS player_team_applications (
 id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES player_teams(id) ON DELETE CASCADE,
 account_id INTEGER NOT NULL REFERENCES player_accounts(id), boss_type TEXT NOT NULL CHECK(boss_type IN ('black-dragon','zakum')),
 character_id TEXT NOT NULL, day_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 requested_at TEXT NOT NULL, decided_at TEXT, decision_reason TEXT, UNIQUE(team_id,account_id));`)
	if err != nil {
		return err
	}
	if err = addColumn(db, "player_accounts", "user_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err = addColumn(db, "player_teams", "day_key", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err = addColumn(db, "player_team_members", "day_key", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err = addColumn(db, "player_teams", "status", "TEXT NOT NULL DEFAULT 'active'"); err != nil {
		return err
	}
	if err = addColumn(db, "player_teams", "merged_into_team_id", "TEXT"); err != nil {
		return err
	}
	if err = addColumn(db, "player_team_applications", "decision_reason", "TEXT"); err != nil {
		return err
	}
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS player_team_merge_applications (
 id TEXT PRIMARY KEY, source_team_id TEXT NOT NULL, target_team_id TEXT NOT NULL,
 source_leader_account_id INTEGER NOT NULL REFERENCES player_accounts(id),
 target_leader_account_id INTEGER NOT NULL REFERENCES player_accounts(id),
 boss_type TEXT NOT NULL CHECK(boss_type IN ('black-dragon','zakum')),
 day_key TEXT NOT NULL, source_member_count INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 requested_at TEXT NOT NULL, decided_at TEXT,
 UNIQUE(source_team_id,target_team_id));`); err != nil {
		return err
	}
	if err = rebuildGlobalCharacterIndex(db); err != nil {
		return err
	}
	// Rows from the pre-daily schema have no trustworthy business date. Treat
	// them as expired so the first 00:00 reset cannot accidentally revive them.
	_, _ = db.Exec("UPDATE player_teams SET day_key='1970-01-01' WHERE day_key=''")
	_, _ = db.Exec("UPDATE player_team_members SET day_key='1970-01-01' WHERE day_key='' ")
	_, _ = db.Exec("DROP INDEX IF EXISTS one_boss_team_per_account")
	_, err = db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_active_boss_team_per_account ON player_team_members(account_id,boss_type,day_key);
CREATE INDEX IF NOT EXISTS team_members_team ON player_team_members(team_id,joined_at);
CREATE INDEX IF NOT EXISTS team_members_account_day ON player_team_members(account_id,day_key);
CREATE INDEX IF NOT EXISTS team_invites_day ON player_teams(invite_code,day_key);
CREATE INDEX IF NOT EXISTS team_applications_account_day ON player_team_applications(account_id,day_key,requested_at);
CREATE INDEX IF NOT EXISTS team_applications_team_status ON player_team_applications(team_id,status,requested_at);
CREATE INDEX IF NOT EXISTS team_merge_target_status ON player_team_merge_applications(target_team_id,status,requested_at);
CREATE INDEX IF NOT EXISTS team_merge_source_day ON player_team_merge_applications(source_leader_account_id,day_key,status);`)
	return err
}

// Older player databases enforced character_id globally. Character IDs are
// scoped to their server/account export, so remove only that obsolete index.
func rebuildGlobalCharacterIndex(db *sql.DB) error {
	rows, err := db.Query("PRAGMA index_list(player_characters)")
	if err != nil {
		return err
	}
	defer rows.Close()
	needsRebuild := false
	for rows.Next() {
		var seq, unique, origin, partial int
		var name string
		if err = rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil || unique != 1 {
			continue
		}
		info, infoErr := db.Query("PRAGMA index_info('" + strings.ReplaceAll(name, "'", "''") + "')")
		if infoErr != nil {
			return infoErr
		}
		var columns []string
		for info.Next() {
			var indexSeq, columnSeq int
			var column string
			if info.Scan(&indexSeq, &columnSeq, &column) == nil {
				columns = append(columns, column)
			}
		}
		info.Close()
		if len(columns) != 1 || columns[0] != "character_id" {
			continue
		}
		needsRebuild = true
		break
	}
	if err = rows.Err(); err != nil {
		return err
	}
	rows.Close()
	if needsRebuild {
		if _, err = db.Exec(`DROP TABLE IF EXISTS player_characters_new;
CREATE TABLE player_characters_new (
 id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
 character_id TEXT NOT NULL, UNIQUE(account_id,character_id));
INSERT OR IGNORE INTO player_characters_new(id,account_id,character_id) SELECT id,account_id,character_id FROM player_characters;
DROP TABLE player_characters;
ALTER TABLE player_characters_new RENAME TO player_characters;`); err != nil {
			return err
		}
	}
	return nil
}

func addColumn(db *sql.DB, table, column, definition string) error {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rows.Close()
	var found bool
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err = rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			found = true
		}
	}
	if err = rows.Err(); err != nil || found {
		return err
	}
	_, err = db.Exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition)
	return err
}

func seed(db *sql.DB) {
	seedCSV(db)
}
