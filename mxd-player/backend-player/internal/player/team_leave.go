package player

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (a *app) leaveTeam(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in struct {
		InviteCode string `json:"inviteCode"`
	}
	if !decode(r, &in) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.InviteCode = strings.ToUpper(strings.TrimSpace(in.InviteCode))
	if len(in.InviteCode) != 6 {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	day := tomorrow()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer tx.Rollback()
	var teamID string
	var leaderID int64
	err = tx.QueryRowContext(r.Context(), `SELECT id,leader_account_id FROM player_teams
WHERE invite_code=? AND day_key=? AND status='active'`, in.InviteCode, day).Scan(&teamID, &leaderID)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("team-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if leaderID == ac.ID {
		writeErr(w, errors.New("leader-cannot-leave"))
		return
	}
	result, err := tx.ExecContext(r.Context(), `DELETE FROM player_team_members
WHERE team_id=? AND account_id=? AND day_key=?`, teamID, ac.ID, day)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if affected != 1 {
		writeErr(w, errors.New("not-in-team"))
		return
	}
	leftAt := time.Now().UTC().Format(time.RFC3339)
	if _, err = tx.ExecContext(r.Context(), `UPDATE player_team_applications
SET status='rejected',decided_at=?,decision_reason=? WHERE team_id=? AND account_id=? AND status='approved'`, leftAt, applicationReasonLeftTeam, teamID, ac.ID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string]any{"status": "left", "inviteCode": in.InviteCode})
}
