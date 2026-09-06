package player

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string]string{"status": "ok", "service": "mxd-player"})
}

func (a *app) servers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string][]string{"servers": servers})
}

func (a *app) verify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	var in struct{ Server, QQ, GameAccount string }
	if !decode(r, &in) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.Server, in.QQ, in.GameAccount = strings.TrimSpace(in.Server), strings.TrimSpace(in.QQ), strings.TrimSpace(in.GameAccount)
	if !validServer(in.Server) || !validQQ(in.QQ) || !validGameAccount(in.GameAccount) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	var ac account
	err := a.db.QueryRowContext(r.Context(), "SELECT id,server,qq,game_account FROM player_accounts WHERE server=? AND qq=? AND game_account=?", in.Server, in.QQ, in.GameAccount).Scan(&ac.ID, &ac.Server, &ac.QQ, &ac.GameAccount)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("account-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	ac.Characters, err = a.characters(r.Context(), ac.ID)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	_, _ = a.db.ExecContext(r.Context(), "DELETE FROM player_sessions WHERE expires_at<=?", time.Now().UnixMilli())
	token := randomToken()
	if _, err = a.db.ExecContext(r.Context(), "INSERT INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)", digest(token), ac.ID, time.Now().Add(12*time.Hour).UnixMilli()); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string]any{"token": token, "account": publicAccount(ac)})
}

func (a *app) me(w http.ResponseWriter, r *http.Request) {
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonWrite(w, http.StatusOK, map[string]any{"account": publicAccount(ac)})
}
