package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
)

func (a *app) previewJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in struct{ InviteCode string }
	if !decode(r, &in) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.InviteCode = strings.ToUpper(strings.TrimSpace(in.InviteCode))
	if len(in.InviteCode) != 6 {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	day := today()
	var teamID, server, boss string
	err = a.db.QueryRowContext(r.Context(), `SELECT id,server,boss_type FROM player_teams WHERE invite_code=? AND day_key=? AND status='active'`, in.InviteCode, day).Scan(&teamID, &server, &boss)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("team-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if server != ac.Server {
		writeErr(w, errors.New("server-mismatch"))
		return
	}
	if leader, queryErr := leaderExists(r.Context(), a.db, ac.ID, boss, day); queryErr != nil {
		writeErr(w, errors.New("internal-error"))
		return
	} else if leader {
		writeErr(w, errors.New("leader-locked"))
		return
	}
	if exists, queryErr := membershipExists(r.Context(), a.db, ac.ID, boss, day); queryErr != nil {
		writeErr(w, errors.New("internal-error"))
		return
	} else if exists {
		writeErr(w, errors.New("already-in-team"))
		return
	}
	var status string
	if err = a.db.QueryRowContext(r.Context(), `SELECT status FROM player_team_applications WHERE team_id=? AND account_id=?`, teamID, ac.ID).Scan(&status); err == nil {
		writeErr(w, errors.New("already-applied"))
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("internal-error"))
		return
	}
	var members int
	if err = a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM player_team_members WHERE team_id=?", teamID).Scan(&members); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if members >= 10 {
		writeErr(w, errors.New("team-full"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string]any{"bossType": boss, "inviteCode": in.InviteCode, "day": day, "memberCount": members})
}
