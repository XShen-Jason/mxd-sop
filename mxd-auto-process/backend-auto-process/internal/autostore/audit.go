package autostore

import (
	"encoding/json"
	"time"
)

func (s *Store) Logs(limit int) ([]AuditEntry, error) {
	return s.logs(limit, "", "")
}

func (s *Store) LogsForServer(limit int, serverID string) ([]AuditEntry, error) {
	return s.logs(limit, serverID, "")
}

func (s *Store) LogsForAccount(limit int, serverID, accountID, accountName string) ([]AuditEntry, error) {
	return s.logs(limit, serverID, accountID, accountName)
}

func (s *Store) logs(limit int, serverID, accountID string, accountNames ...string) ([]AuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := "SELECT id, created_at, request_id, method, path, actor, action, status, duration_ms, detail_json FROM audit_logs"
	arguments := []any{}
	if serverID != "" {
		query += " WHERE json_extract(detail_json, '$.server_id') = ?"
		arguments = append(arguments, serverID)
	}
	if accountID != "" {
		if serverID == "" {
			query += " WHERE "
		} else {
			query += " AND "
		}
		accountName := accountID
		if len(accountNames) > 0 && accountNames[0] != "" {
			accountName = accountNames[0]
		}
		query += "(json_extract(detail_json, '$.account_id') = ? OR json_extract(detail_json, '$.account') = ?)"
		arguments = append(arguments, accountID, accountName)
	}
	query += " ORDER BY created_at DESC, id DESC LIMIT ?"
	arguments = append(arguments, limit)
	rows, err := s.db.Query(query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]AuditEntry, 0, limit)
	for rows.Next() {
		var entry AuditEntry
		var detail string
		if err := rows.Scan(&entry.ID, &entry.CreatedAt, &entry.RequestID, &entry.Method, &entry.Path, &entry.Actor, &entry.Action, &entry.Status, &entry.DurationMS, &detail); err != nil {
			return nil, err
		}
		if detail != "" {
			_ = json.Unmarshal([]byte(detail), &entry.Detail)
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) Record(entry AuditEntry) error {
	if entry.ID == "" {
		entry.ID = timestamp() + "-" + entry.RequestID
	}
	if entry.CreatedAt == "" {
		entry.CreatedAt = timestamp()
	}
	detail, err := json.Marshal(entry.Detail)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec("INSERT INTO audit_logs (id, created_at, request_id, method, path, actor, action, status, duration_ms, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", entry.ID, entry.CreatedAt, entry.RequestID, entry.Method, entry.Path, entry.Actor, entry.Action, entry.Status, entry.DurationMS, string(detail)); err != nil {
		return err
	}
	_, err = s.db.Exec("DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?)", maxAuditEntries)
	return err
}

func timestamp() string { return time.Now().UTC().Format(time.RFC3339Nano) }
