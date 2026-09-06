package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBusinessDayUsesBeijingMidnight(t *testing.T) {
	lateUTC := time.Date(2026, 9, 6, 15, 59, 0, 0, time.UTC)
	if got := businessDay(lateUTC); got != "2026-09-06" {
		t.Fatalf("business day before midnight = %s", got)
	}
	afterUTC := time.Date(2026, 9, 6, 16, 0, 0, 0, time.UTC)
	if got := businessDay(afterUTC); got != "2026-09-07" {
		t.Fatalf("business day after midnight = %s", got)
	}
}

func TestJoinRequiresLeaderApprovalAndLocksBoss(t *testing.T) {
	db, err := sql.Open("sqlite", "file:workflow-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		id             int
		qq, name, char string
	}{{1, "100001", "leader1", "101"}, {2, "100002", "player2", "201"}, {3, "100003", "leader3", "301"}, {4, "100004", "snow-player", "401"}} {
		if _, err = db.Exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(?,?,?,?)", row.id, "蘑菇", row.qq, row.name); err == nil {
			_, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(?,?)", row.id, row.char)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec("UPDATE player_accounts SET server='雪人' WHERE id=4"); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db}
	leaderToken := testSession(t, db, 1)
	playerToken := testSession(t, db, 2)
	otherLeaderToken := testSession(t, db, 3)
	snowToken := testSession(t, db, 4)
	created := callPlayer(t, a, "/api/v1/player/teams", leaderToken, map[string]any{"bossType": "black-dragon", "characterId": "101"})
	invite := created["inviteCode"].(string)
	secondCreated := callPlayer(t, a, "/api/v1/player/teams", otherLeaderToken, map[string]any{"bossType": "black-dragon", "characterId": "301"})
	secondInvite := secondCreated["inviteCode"].(string)
	preview := callPlayer(t, a, "/api/v1/player/teams/preview", playerToken, map[string]any{"inviteCode": invite})
	if preview["bossType"] != "black-dragon" {
		t.Fatalf("preview boss = %v", preview["bossType"])
	}
	callPlayerStatus(t, a, "/api/v1/player/teams/preview", leaderToken, map[string]any{"inviteCode": secondInvite}, http.StatusConflict)
	callPlayerStatus(t, a, "/api/v1/player/teams/preview", snowToken, map[string]any{"inviteCode": invite}, http.StatusBadRequest)
	firstApplication := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": invite, "characterId": "201"}, http.StatusAccepted)
	secondApplication := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": secondInvite, "characterId": "201"}, http.StatusAccepted)
	callPlayerStatus(t, a, "/api/v1/player/teams/approve", leaderToken, map[string]any{"requestId": firstApplication["requestId"]}, http.StatusOK)
	merge := callPlayerStatus(t, a, "/api/v1/player/teams/merge", leaderToken, map[string]any{"sourceInviteCode": invite, "targetInviteCode": secondInvite}, http.StatusAccepted)
	callPlayerStatus(t, a, "/api/v1/player/teams/merge/approve", otherLeaderToken, map[string]any{"requestId": merge["requestId"]}, http.StatusOK)
	callPlayerStatus(t, a, "/api/v1/player/teams/approve", otherLeaderToken, map[string]any{"requestId": secondApplication["requestId"]}, http.StatusConflict)
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM player_team_members WHERE account_id=2 AND boss_type='black-dragon' AND day_key=?", today()).Scan(&count); err != nil || count != 1 {
		t.Fatalf("approved membership count = %d, err=%v", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM player_team_members WHERE team_id=(SELECT id FROM player_teams WHERE invite_code=?)", secondInvite).Scan(&count); err != nil || count != 3 {
		t.Fatalf("merged target member count = %d, err=%v", count, err)
	}
	var sourceStatus string
	if err = db.QueryRow("SELECT status FROM player_teams WHERE invite_code=?", invite).Scan(&sourceStatus); err != nil || sourceStatus != "merged" {
		t.Fatalf("source team status = %s, err=%v", sourceStatus, err)
	}
}

func testSession(t *testing.T, db *sql.DB, accountID int) string {
	t.Helper()
	token := "token-" + string(rune('a'+accountID))
	if _, err := db.Exec("INSERT INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)", digest(token), accountID, time.Now().Add(time.Hour).UnixMilli()); err != nil {
		t.Fatal(err)
	}
	return token
}

func callPlayer(t *testing.T, a *app, path, token string, body map[string]any) map[string]any {
	t.Helper()
	return callPlayerStatus(t, a, path, token, body, http.StatusOK)
}

func callPlayerStatus(t *testing.T, a *app, path, token string, body map[string]any, wantStatus int) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	if path == "/api/v1/player/teams" {
		a.teams(recorder, req)
	} else if path == "/api/v1/player/teams/preview" {
		a.previewJoin(recorder, req)
	} else if path == "/api/v1/player/teams/join" {
		a.join(recorder, req)
	} else if path == "/api/v1/player/teams/merge" {
		a.mergeTeam(recorder, req)
	} else if path == "/api/v1/player/teams/merge/approve" {
		a.approveMerge(recorder, req)
	} else {
		a.approveJoin(recorder, req)
	}
	if recorder.Code != wantStatus {
		t.Fatalf("%s status = %d, want %d: %s", path, recorder.Code, wantStatus, recorder.Body.String())
	}
	var result map[string]any
	if json.Unmarshal(recorder.Body.Bytes(), &result) != nil {
		t.Fatal("response was not JSON")
	}
	return result
}
