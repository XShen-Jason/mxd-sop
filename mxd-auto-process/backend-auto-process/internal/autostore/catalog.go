package autostore

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/local/mxd-auto-process/internal/servercatalog"
)

func (s *Store) LoadServerCatalog() ([]servercatalog.ServerConfig, bool, error) {
	var document string
	err := s.db.QueryRow("SELECT document_json FROM server_catalog WHERE id = 1").Scan(&document)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var envelope struct {
		Servers []servercatalog.ServerConfig `json:"servers"`
	}
	if err := json.Unmarshal([]byte(document), &envelope); err != nil {
		return nil, false, fmt.Errorf("decode persisted server catalog: %w", err)
	}
	return envelope.Servers, true, nil
}

func (s *Store) SaveServerCatalog(entries []servercatalog.ServerConfig) error {
	document, err := marshalServerCatalog(entries)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO server_catalog (id, document_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at", string(document), timestamp())
	return err
}

func (s *Store) RemoveServer(serverID string, entries []servercatalog.ServerConfig) error {
	document, err := marshalServerCatalog(entries)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM game_accounts WHERE server_id = ?", serverID); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO server_catalog (id, document_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at", string(document), timestamp()); err != nil {
		return err
	}
	return tx.Commit()
}

func marshalServerCatalog(entries []servercatalog.ServerConfig) ([]byte, error) {
	envelope := struct {
		Servers []servercatalog.ServerConfig `json:"servers"`
	}{Servers: entries}
	return json.Marshal(envelope)
}
