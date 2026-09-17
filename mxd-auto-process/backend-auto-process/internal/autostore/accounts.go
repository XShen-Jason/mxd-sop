package autostore

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func (s *Store) Accounts(serverID string) ([]Account, error) {
	query := "SELECT id, server_id, username, character_id, character_name, password_cipher, enabled, created_at, updated_at FROM game_accounts"
	args := []any{}
	if serverID != "" {
		query += " WHERE server_id = ?"
		args = append(args, serverID)
	}
	query += " ORDER BY created_at ASC, id ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := make([]Account, 0)
	for rows.Next() {
		var account Account
		var enabled int
		if err := rows.Scan(&account.ID, &account.ServerID, &account.Username, &account.CharacterID, &account.CharacterName, &account.PasswordCipher, &enabled, &account.CreatedAt, &account.UpdatedAt); err != nil {
			return nil, err
		}
		account.Enabled = enabled != 0
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *Store) Account(id string) (Account, bool, error) {
	var account Account
	var enabled int
	err := s.db.QueryRow("SELECT id, server_id, username, character_id, character_name, password_cipher, enabled, created_at, updated_at FROM game_accounts WHERE id = ?", id).Scan(&account.ID, &account.ServerID, &account.Username, &account.CharacterID, &account.CharacterName, &account.PasswordCipher, &enabled, &account.CreatedAt, &account.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, false, nil
	}
	if err != nil {
		return Account{}, false, err
	}
	account.Enabled = enabled != 0
	return account, true, nil
}

func (s *Store) Credentials(id string) (string, string, error) {
	account, ok, err := s.Account(id)
	if err != nil {
		return "", "", err
	}
	if !ok {
		return "", "", ErrAccountNotFound
	}
	password, err := s.decrypt(account.PasswordCipher)
	if err != nil {
		return "", "", fmt.Errorf("decrypt account credential: %w", err)
	}
	return account.Username, password, nil
}

func (s *Store) CreateAccount(account Account, password string) (Account, error) {
	if err := validateAccount(account, password, true); err != nil {
		return Account{}, err
	}
	ciphertext, err := s.encrypt(password)
	if err != nil {
		return Account{}, err
	}
	now := timestamp()
	account.PasswordCipher = ciphertext
	account.CreatedAt = now
	account.UpdatedAt = now
	if err := s.insertAccount(account); err != nil {
		return Account{}, err
	}
	return account, nil
}

func (s *Store) UpdateAccount(account Account, password string) (Account, error) {
	old, ok, err := s.Account(account.ID)
	if err != nil {
		return Account{}, err
	}
	if !ok {
		return Account{}, ErrAccountNotFound
	}
	if err := validateAccount(account, password, false); err != nil {
		return Account{}, err
	}
	if password != "" {
		ciphertext, err := s.encrypt(password)
		if err != nil {
			return Account{}, err
		}
		account.PasswordCipher = ciphertext
	} else {
		account.PasswordCipher = old.PasswordCipher
	}
	account.CreatedAt = old.CreatedAt
	account.UpdatedAt = timestamp()
	result, err := s.db.Exec("UPDATE game_accounts SET server_id = ?, username = ?, character_id = ?, character_name = ?, password_cipher = ?, enabled = ?, updated_at = ? WHERE id = ?", account.ServerID, account.Username, account.CharacterID, account.CharacterName, account.PasswordCipher, boolInt(account.Enabled), account.UpdatedAt, account.ID)
	if err != nil {
		return Account{}, normalizeAccountError(err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return Account{}, err
	} else if count == 0 {
		return Account{}, ErrAccountNotFound
	}
	return account, nil
}

func (s *Store) DeleteAccount(id string) error {
	result, err := s.db.Exec("DELETE FROM game_accounts WHERE id = ?", id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrAccountNotFound
	}
	return nil
}

func (s *Store) SetEnabled(id string, enabled bool) error {
	result, err := s.db.Exec("UPDATE game_accounts SET enabled = ?, updated_at = ? WHERE id = ?", boolInt(enabled), timestamp(), id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrAccountNotFound
	}
	return nil
}

func (s *Store) insertAccount(account Account) error {
	_, err := s.db.Exec("INSERT INTO game_accounts (id, server_id, username, character_id, character_name, password_cipher, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", account.ID, account.ServerID, account.Username, account.CharacterID, account.CharacterName, account.PasswordCipher, boolInt(account.Enabled), account.CreatedAt, account.UpdatedAt)
	return normalizeAccountError(err)
}

func validateAccount(account Account, password string, requirePassword bool) error {
	if account.ID == "" || account.ServerID == "" || strings.TrimSpace(account.Username) == "" || strings.TrimSpace(account.CharacterID) == "" {
		return ErrInvalidAccount
	}
	if hasControl(account.ID) || hasControl(account.ServerID) || hasControl(account.Username) || hasControl(account.CharacterID) || hasControl(account.CharacterName) {
		return ErrInvalidAccount
	}
	if requirePassword && (len(password) < minAccountPasswordSize || len(password) > 512) {
		return ErrInvalidPassword
	}
	if !requirePassword && password != "" && (len(password) < minAccountPasswordSize || len(password) > 512) {
		return ErrInvalidPassword
	}
	return nil
}

func normalizeAccountError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "unique") {
		return ErrDuplicateAccount
	}
	return err
}

func hasControl(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
