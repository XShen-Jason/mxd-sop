package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (a *app) auth(r *http.Request) (account, error) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		return account{}, errors.New("unauthorized")
	}
	var ac account
	err := a.db.QueryRowContext(r.Context(), `SELECT a.id,a.server,a.qq,a.game_account
FROM player_accounts a JOIN player_sessions s ON a.id=s.account_id
WHERE s.token_hash=? AND s.expires_at>?`, digest(token), time.Now().UnixMilli()).Scan(&ac.ID, &ac.Server, &ac.QQ, &ac.GameAccount)
	if err != nil {
		return account{}, errors.New("unauthorized")
	}
	ac.Characters, _ = a.characters(r.Context(), ac.ID)
	return ac, nil
}

func (a *app) characters(ctx context.Context, id int64) ([]string, error) {
	rows, err := a.db.QueryContext(ctx, "SELECT character_id FROM player_characters WHERE account_id=? ORDER BY character_id", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var characterID string
		if rows.Scan(&characterID) == nil {
			result = append(result, characterID)
		}
	}
	return result, rows.Err()
}

func validCharacterID(s string) bool {
	if len(s) == 0 || len(s) > 32 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
