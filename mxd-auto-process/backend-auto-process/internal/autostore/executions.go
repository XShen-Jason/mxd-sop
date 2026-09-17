package autostore

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

type ExecutionCommand struct {
	ID             string `json:"id"`
	Text           string `json:"text"`
	Status         string `json:"status"`
	AccountID      string `json:"account_id,omitempty"`
	DeliveryStatus string `json:"delivery_status,omitempty"`
	Message        string `json:"message,omitempty"`
}

type Execution struct {
	ID                string
	ServerID          string
	RequestHash       string
	Commands          []ExecutionCommand
	Status            string
	Attempts          int
	SelectedAccountID string
	CreatedAt         string
	UpdatedAt         string
}

var ErrExecutionConflict = errors.New("execution request conflicts with existing record")

func ExecutionHash(serverID string, commands []ExecutionCommand) string {
	payload, _ := json.Marshal(struct {
		ServerID string             `json:"server_id"`
		Commands []ExecutionCommand `json:"commands"`
	}{serverID, commands})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func (s *Store) Execution(id string) (Execution, bool, error) {
	var result Execution
	var commands, created, updated string
	err := s.db.QueryRow("SELECT id, server_id, request_hash, commands_json, status, attempts, selected_account_id, created_at, updated_at FROM automation_executions WHERE id = ?", id).Scan(&result.ID, &result.ServerID, &result.RequestHash, &commands, &result.Status, &result.Attempts, &result.SelectedAccountID, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Execution{}, false, nil
	}
	if err != nil {
		return Execution{}, false, err
	}
	if err := json.Unmarshal([]byte(commands), &result.Commands); err != nil {
		return Execution{}, false, err
	}
	result.CreatedAt, result.UpdatedAt = created, updated
	return result, true, nil
}

func (s *Store) SaveExecution(execution Execution) error {
	commands, err := json.Marshal(execution.Commands)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO automation_executions (id, server_id, request_hash, commands_json, status, attempts, selected_account_id, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET commands_json=excluded.commands_json, status=excluded.status, attempts=excluded.attempts, selected_account_id=excluded.selected_account_id, updated_at=excluded.updated_at`, execution.ID, execution.ServerID, execution.RequestHash, string(commands), execution.Status, execution.Attempts, execution.SelectedAccountID, execution.CreatedAt, execution.UpdatedAt)
	return err
}

func (s *Store) NextRoundRobin(serverID string, accountIDs []string) (string, bool, error) {
	if len(accountIDs) == 0 {
		return "", false, nil
	}
	var last string
	_ = s.db.QueryRow("SELECT last_account_id FROM automation_round_robin WHERE server_id = ?", serverID).Scan(&last)
	selected := accountIDs[0]
	for index, id := range accountIDs {
		if id == last {
			selected = accountIDs[(index+1)%len(accountIDs)]
			break
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.Exec(`INSERT INTO automation_round_robin(server_id, last_account_id, updated_at) VALUES(?, ?, ?)
ON CONFLICT(server_id) DO UPDATE SET last_account_id=excluded.last_account_id, updated_at=excluded.updated_at`, serverID, selected, now)
	return selected, err == nil, err
}
