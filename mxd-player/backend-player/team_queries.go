package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

func (a *app) loadTeam(ctx context.Context, id string, accountID int64) (team, error) {
	var t team
	var leader int64
	if err := a.db.QueryRowContext(ctx, `SELECT id,boss_type,invite_code,server,leader_account_id
FROM player_teams WHERE id=? AND day_key=? AND status='active'`, id, today()).Scan(&t.ID, &t.BossType, &t.InviteCode, &t.Server, &leader); err != nil {
		return t, err
	}
	t.Leader = leader == accountID
	rows, err := a.db.QueryContext(ctx, `SELECT a.game_account,m.character_id,a.id
FROM player_team_members m JOIN player_accounts a ON a.id=m.account_id
WHERE m.team_id=? ORDER BY m.joined_at`, id)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	for rows.Next() {
		var gameAccount, characterID string
		var memberID int64
		if rows.Scan(&gameAccount, &characterID, &memberID) == nil {
			t.Members = append(t.Members, teamMember{GameAccount: gameAccount, CharacterID: characterID, IsLeader: memberID == leader})
		}
	}
	if err = rows.Err(); err != nil {
		return t, err
	}
	if !t.Leader {
		return t, nil
	}
	pending, err := a.db.QueryContext(ctx, `SELECT p.id,a.game_account,p.character_id,p.requested_at
FROM player_team_applications p JOIN player_accounts a ON a.id=p.account_id
WHERE p.team_id=? AND p.day_key=? AND p.status='pending' ORDER BY p.requested_at`, id, today())
	if err != nil {
		return t, err
	}
	defer pending.Close()
	for pending.Next() {
		var request teamRequest
		if pending.Scan(&request.ID, &request.GameAccount, &request.CharacterID, &request.RequestedAt) == nil {
			t.Pending = append(t.Pending, request)
		}
	}
	if err = pending.Err(); err != nil {
		return t, err
	}
	merges, err := a.db.QueryContext(ctx, `SELECT m.id,s.invite_code,m.boss_type,m.source_member_count,m.requested_at
FROM player_team_merge_applications m JOIN player_teams s ON s.id=m.source_team_id
WHERE m.target_team_id=? AND m.day_key=? AND m.status='pending' ORDER BY m.requested_at`, id, today())
	if err != nil {
		return t, err
	}
	defer merges.Close()
	for merges.Next() {
		var request teamMergeRequest
		if merges.Scan(&request.ID, &request.SourceInviteCode, &request.BossType, &request.MemberCount, &request.RequestedAt) == nil {
			t.PendingMerges = append(t.PendingMerges, request)
		}
	}
	return t, merges.Err()
}

func (a *app) applications(ctx context.Context, accountID int64, day string, history bool) ([]teamApplication, error) {
	query := `SELECT p.id,p.boss_type,t.invite_code,p.character_id,p.status,p.day_key,p.requested_at
FROM player_team_applications p JOIN player_teams t ON t.id=p.team_id WHERE p.account_id=?`
	args := []any{accountID}
	if !history {
		query += " AND p.day_key=?"
		args = append(args, day)
	}
	query += " ORDER BY p.requested_at DESC"
	if history {
		query += " LIMIT 50"
	}
	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []teamApplication{}
	for rows.Next() {
		var item teamApplication
		if rows.Scan(&item.ID, &item.BossType, &item.InviteCode, &item.CharacterID, &item.Status, &item.DayKey, &item.RequestedAt) == nil {
			result = append(result, item)
		}
	}
	if history {
		members, memberErr := a.db.QueryContext(ctx, `SELECT t.boss_type,t.invite_code,m.character_id,t.day_key,m.joined_at
FROM player_team_members m JOIN player_teams t ON t.id=m.team_id
WHERE m.account_id=? AND NOT EXISTS (SELECT 1 FROM player_team_applications p WHERE p.team_id=m.team_id AND p.account_id=m.account_id)`, accountID)
		if memberErr != nil {
			return nil, memberErr
		}
		defer members.Close()
		for members.Next() {
			var item teamApplication
			if members.Scan(&item.BossType, &item.InviteCode, &item.CharacterID, &item.DayKey, &item.RequestedAt) == nil {
				item.ID = digest(item.InviteCode + item.DayKey + item.CharacterID)
				item.Status = "approved"
				result = append(result, item)
			}
		}
		if err = members.Err(); err != nil {
			return nil, err
		}
		sort.SliceStable(result, func(i, j int) bool { return result[i].RequestedAt > result[j].RequestedAt })
		if len(result) > 50 {
			result = result[:50]
		}
	}
	return result, rows.Err()
}

func (a *app) approveJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	leader, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in struct{ RequestID string }
	if !decode(r, &in) || len(strings.TrimSpace(in.RequestID)) < 16 {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.RequestID = strings.TrimSpace(in.RequestID)
	day := today()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer tx.Rollback()
	var teamID string
	var accountID int64
	var boss, characterID string
	err = tx.QueryRowContext(r.Context(), `SELECT p.team_id,p.account_id,p.boss_type,p.character_id
FROM player_team_applications p JOIN player_teams t ON t.id=p.team_id
WHERE p.id=? AND p.status='pending' AND p.day_key=? AND t.leader_account_id=?`, in.RequestID, day, leader.ID).Scan(&teamID, &accountID, &boss, &characterID)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("request-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if exists, queryErr := membershipExists(r.Context(), tx, accountID, boss, day); queryErr != nil {
		writeErr(w, errors.New("internal-error"))
		return
	} else if exists {
		writeErr(w, errors.New("already-in-team"))
		return
	}
	joinedAt := time.Now().UTC().Format(time.RFC3339)
	result, err := tx.ExecContext(r.Context(), `INSERT INTO player_team_members
(team_id,account_id,boss_type,character_id,day_key,joined_at)
SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM player_team_members WHERE team_id=?) < 10`, teamID, accountID, boss, characterID, day, joinedAt, teamID)
	if err != nil {
		if isUniqueAccountBoss(err) {
			writeErr(w, errors.New("already-in-team"))
		} else {
			writeErr(w, errors.New("internal-error"))
		}
		return
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil {
		writeErr(w, errors.New("internal-error"))
		return
	} else if affected != 1 {
		writeErr(w, errors.New("team-full"))
		return
	}
	if _, err = tx.ExecContext(r.Context(), "UPDATE player_team_applications SET status='approved',decided_at=? WHERE id=?", joinedAt, in.RequestID); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	if err = tx.Commit(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	t, err := a.loadTeam(r.Context(), teamID, leader.ID)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, t)
}
