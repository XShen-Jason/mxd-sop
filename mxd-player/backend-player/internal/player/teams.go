package player

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (a *app) teams(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		a.teamsPost(w, r)
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	day := tomorrow()
	rows, err := a.db.QueryContext(r.Context(), `SELECT DISTINCT t.id FROM player_teams t
JOIN player_team_members m ON m.team_id=t.id
WHERE t.status='active' AND m.account_id=? AND m.day_key=? ORDER BY t.created_at DESC`, ac.ID, day)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer rows.Close()
	result := struct {
		Teams        []team            `json:"teams"`
		Applications []teamApplication `json:"applications"`
		History      []teamApplication `json:"history"`
		Day          string            `json:"day"`
	}{Teams: []team{}, Applications: []teamApplication{}, History: []teamApplication{}, Day: day}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			if t, loadErr := a.loadTeam(r.Context(), id, ac.ID, day); loadErr == nil {
				result.Teams = append(result.Teams, t)
			}
		}
	}
	if rows.Err() != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	result.Applications, err = a.applications(r.Context(), ac.ID, day, false)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	result.History, err = a.applications(r.Context(), ac.ID, "", true)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, result)
}

func (a *app) teamsPost(w http.ResponseWriter, r *http.Request) {
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in struct{ BossType, CharacterID string }
	if !decode(r, &in) || !validBoss(in.BossType) || !validCharacterID(strings.TrimSpace(in.CharacterID)) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.CharacterID = strings.TrimSpace(in.CharacterID)
	if !contains(ac.Characters, in.CharacterID) {
		writeErr(w, errors.New("character-not-owned"))
		return
	}
	day := tomorrow()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer tx.Rollback()
	var id, code string
	for attempt := 0; attempt < 5; attempt++ {
		id, code = randomToken(), newCode()
		_, err = tx.ExecContext(r.Context(), `INSERT INTO player_teams
(id,server,boss_type,invite_code,leader_account_id,leader_character_id,day_key,created_at)
VALUES(?,?,?,?,?,?,?,?)`, id, ac.Server, in.BossType, code, ac.ID, in.CharacterID, day, time.Now().UTC().Format(time.RFC3339))
		if err == nil {
			break
		}
		if !strings.Contains(strings.ToLower(err.Error()), "invite_code") {
			writeErr(w, errors.New("internal-error"))
			return
		}
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO player_team_members
(team_id,account_id,boss_type,character_id,day_key,joined_at) VALUES(?,?,?,?,?,?)`, id, ac.ID, in.BossType, in.CharacterID, day, time.Now().UTC().Format(time.RFC3339)); err != nil {
		if isUniqueAccountBoss(err) {
			writeErr(w, errors.New("already-in-team"))
		} else {
			writeErr(w, errors.New("internal-error"))
		}
		return
	}
	if err = closePendingApplications(r.Context(), tx, ac.ID, in.BossType, day, "", applicationReasonJoinedOtherTeam, time.Now().UTC().Format(time.RFC3339)); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	t, err := a.loadTeam(r.Context(), id, ac.ID, day)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, t)
}

func (a *app) join(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in struct{ InviteCode, CharacterID string }
	if !decode(r, &in) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.InviteCode, in.CharacterID = strings.ToUpper(strings.TrimSpace(in.InviteCode)), strings.TrimSpace(in.CharacterID)
	if len(in.InviteCode) != 6 || !validCharacterID(in.CharacterID) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	if !contains(ac.Characters, in.CharacterID) {
		writeErr(w, errors.New("character-not-owned"))
		return
	}
	day := tomorrow()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer tx.Rollback()
	var teamID, server, boss string
	err = tx.QueryRowContext(r.Context(), `SELECT id,server,boss_type FROM player_teams WHERE invite_code=? AND day_key=? AND status='active'`, in.InviteCode, day).Scan(&teamID, &server, &boss)
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
	if leader, queryErr := leaderExists(r.Context(), tx, ac.ID, boss, day); queryErr != nil {
		writeErr(w, errors.New("internal-error"))
		return
	} else if leader {
		writeErr(w, errors.New("leader-locked"))
		return
	}
	if exists, queryErr := membershipExists(r.Context(), tx, ac.ID, boss, day); queryErr != nil {
		writeErr(w, errors.New("internal-error"))
		return
	} else if exists {
		writeErr(w, errors.New("already-in-team"))
		return
	}
	var existingID, existingStatus, existingCharacter string
	err = tx.QueryRowContext(r.Context(), `SELECT id,status,character_id FROM player_team_applications WHERE team_id=? AND account_id=?`, teamID, ac.ID).Scan(&existingID, &existingStatus, &existingCharacter)
	if err == nil && existingStatus == "pending" && existingCharacter == in.CharacterID {
		writeErr(w, errors.New("already-applied"))
		return
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("internal-error"))
		return
	}
	var members int
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM player_team_members WHERE team_id=?", teamID).Scan(&members); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if members >= 10 {
		writeErr(w, errors.New("team-full"))
		return
	}
	requestedAt := time.Now().UTC().Format(time.RFC3339)
	requestID := existingID
	if existingID == "" {
		requestID = randomToken()
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO player_team_applications
(id,team_id,account_id,boss_type,character_id,day_key,status,requested_at) VALUES(?,?,?,?,?,?,?,?)`, requestID, teamID, ac.ID, boss, in.CharacterID, day, "pending", requestedAt); err != nil {
			writeErr(w, errors.New("internal-error"))
			return
		}
	} else if _, err = tx.ExecContext(r.Context(), `UPDATE player_team_applications
SET character_id=?,status='pending',requested_at=?,decided_at=NULL,decision_reason=NULL WHERE id=?`, in.CharacterID, requestedAt, existingID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusAccepted, map[string]any{"status": "pending", "requestId": requestID, "bossType": boss, "inviteCode": in.InviteCode, "characterId": in.CharacterID})
}

func closePendingApplications(ctx context.Context, tx *sql.Tx, accountID int64, boss, day, exceptID, reason, decidedAt string) error {
	query := `UPDATE player_team_applications
SET status='rejected',decided_at=?,decision_reason=?
WHERE account_id=? AND boss_type=? AND day_key=? AND status='pending'`
	args := []any{decidedAt, reason, accountID, boss, day}
	if exceptID != "" {
		query += " AND id<>?"
		args = append(args, exceptID)
	}
	_, err := tx.ExecContext(ctx, query, args...)
	return err
}

func membershipExists(ctx context.Context, tx interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, accountID int64, boss, day string) (bool, error) {
	var found int
	err := tx.QueryRowContext(ctx, "SELECT 1 FROM player_team_members WHERE account_id=? AND boss_type=? AND day_key=?", accountID, boss, day).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func leaderExists(ctx context.Context, tx interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, accountID int64, boss, day string) (bool, error) {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM player_teams
WHERE leader_account_id=? AND boss_type=? AND day_key=? AND status='active'`, accountID, boss, day).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func validBoss(s string) bool { return s == "black-dragon" || s == "zakum" }
