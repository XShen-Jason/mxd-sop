package player

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (a *app) mergeTeam(w http.ResponseWriter, r *http.Request) {
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
		SourceInviteCode string `json:"sourceInviteCode"`
		TargetInviteCode string `json:"targetInviteCode"`
	}
	if !decode(r, &in) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.SourceInviteCode = strings.ToUpper(strings.TrimSpace(in.SourceInviteCode))
	in.TargetInviteCode = strings.ToUpper(strings.TrimSpace(in.TargetInviteCode))
	if len(in.SourceInviteCode) != 6 || len(in.TargetInviteCode) != 6 || in.SourceInviteCode == in.TargetInviteCode {
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
	var targetID, targetServer, targetBoss string
	var targetLeader int64
	err = tx.QueryRowContext(r.Context(), `SELECT id,server,boss_type,leader_account_id FROM player_teams
WHERE invite_code=? AND day_key=? AND status='active'`, in.TargetInviteCode, day).Scan(&targetID, &targetServer, &targetBoss, &targetLeader)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("merge-target-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if targetServer != ac.Server {
		writeErr(w, errors.New("server-mismatch"))
		return
	}
	if targetLeader == ac.ID {
		writeErr(w, errors.New("leader-locked"))
		return
	}
	var sourceID, sourceServer, sourceBoss string
	err = tx.QueryRowContext(r.Context(), `SELECT id,server,boss_type FROM player_teams
WHERE invite_code=? AND day_key=? AND status='active' AND leader_account_id=?`, in.SourceInviteCode, day, ac.ID).Scan(&sourceID, &sourceServer, &sourceBoss)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("not-team-leader"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if sourceServer != targetServer || sourceBoss != targetBoss {
		writeErr(w, errors.New("merge-boss-mismatch"))
		return
	}
	var sourceCount, targetCount int
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM player_team_members WHERE team_id=? AND day_key=?", sourceID, day).Scan(&sourceCount); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM player_team_members WHERE team_id=? AND day_key=?", targetID, day).Scan(&targetCount); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if sourceCount+targetCount > 10 {
		writeErr(w, errors.New("team-full"))
		return
	}
	var existing string
	err = tx.QueryRowContext(r.Context(), `SELECT status FROM player_team_merge_applications
WHERE source_team_id=? AND target_team_id=? AND status='pending'`, sourceID, targetID).Scan(&existing)
	if err == nil {
		writeErr(w, errors.New("merge-already-applied"))
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("internal-error"))
		return
	}
	requestID := randomToken()
	requestedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO player_team_merge_applications
(id,source_team_id,target_team_id,source_leader_account_id,target_leader_account_id,boss_type,day_key,source_member_count,status,requested_at)
VALUES(?,?,?,?,?,?,?,?,?,?)`, requestID, sourceID, targetID, ac.ID, targetLeader, sourceBoss, day, sourceCount, "pending", requestedAt); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusAccepted, map[string]any{"status": "pending", "requestId": requestID, "sourceInviteCode": in.SourceInviteCode, "targetInviteCode": in.TargetInviteCode, "bossType": sourceBoss, "memberCount": sourceCount})
}

func (a *app) approveMerge(w http.ResponseWriter, r *http.Request) {
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
		RequestID string `json:"requestId"`
	}
	if !decode(r, &in) || len(strings.TrimSpace(in.RequestID)) < 16 {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.RequestID = strings.TrimSpace(in.RequestID)
	day := tomorrow()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer tx.Rollback()
	var sourceID, targetID, boss string
	err = tx.QueryRowContext(r.Context(), `SELECT m.source_team_id,m.target_team_id,m.boss_type
FROM player_team_merge_applications m JOIN player_teams s ON s.id=m.source_team_id
JOIN player_teams t ON t.id=m.target_team_id
WHERE m.id=? AND m.target_leader_account_id=? AND m.day_key=? AND m.status='pending'
AND s.status='active' AND t.status='active'`, in.RequestID, ac.ID, day).Scan(&sourceID, &targetID, &boss)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("merge-request-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	var sourceCount, targetCount int
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM player_team_members WHERE team_id=? AND day_key=?", sourceID, day).Scan(&sourceCount); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM player_team_members WHERE team_id=? AND day_key=?", targetID, day).Scan(&targetCount); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if sourceCount+targetCount > 10 {
		writeErr(w, errors.New("team-full"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), `CREATE TEMP TABLE merge_members AS
SELECT account_id,boss_type,character_id,day_key,joined_at FROM player_team_members WHERE team_id=? AND day_key=?`, sourceID, day); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), `DELETE FROM player_team_members WHERE team_id=? AND day_key=?`, sourceID, day); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO player_team_members(team_id,account_id,boss_type,character_id,day_key,joined_at)
	SELECT ?,account_id,boss_type,character_id,day_key,joined_at FROM merge_members`, targetID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	decidedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err = tx.ExecContext(r.Context(), `UPDATE player_team_applications
SET status='rejected',decided_at=?,decision_reason=?
WHERE account_id IN (SELECT account_id FROM merge_members) AND boss_type=? AND day_key=? AND status='pending'`, decidedAt, applicationReasonJoinedOtherTeam, boss, day); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	_, _ = tx.ExecContext(r.Context(), "DROP TABLE merge_members")
	if _, err = tx.ExecContext(r.Context(), `UPDATE player_teams SET status='merged',merged_into_team_id=? WHERE id=?`, targetID, sourceID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE player_team_applications SET status='rejected',decided_at=?,decision_reason=? WHERE team_id=? AND status='pending'`, decidedAt, applicationReasonTeamMerged, sourceID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE player_team_merge_applications SET status='approved',decided_at=? WHERE id=?`, time.Now().UTC().Format(time.RFC3339), in.RequestID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	result, err := a.loadTeam(r.Context(), targetID, ac.ID, day)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	_ = boss
	jsonWrite(w, http.StatusOK, result)
}
