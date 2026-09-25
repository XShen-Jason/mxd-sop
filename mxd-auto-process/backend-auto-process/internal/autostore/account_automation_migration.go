package autostore

import "database/sql"

// Separate automation participation from login intent once, preserving legacy
// behavior. Run the column addition and backfill in one transaction.
func ensureAccountAutomationColumn(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query("PRAGMA table_info(game_accounts)")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, dataType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return err
		}
		found = found || name == "automation_enabled"
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if !found {
		if _, err := tx.Exec("ALTER TABLE game_accounts ADD COLUMN automation_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automation_enabled IN (0, 1))"); err != nil {
			return err
		}
		if _, err := tx.Exec("UPDATE game_accounts SET automation_enabled = enabled"); err != nil {
			return err
		}
	}
	return tx.Commit()
}
