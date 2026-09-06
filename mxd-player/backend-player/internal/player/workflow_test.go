package player

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
	if got := nextBusinessDay(lateUTC); got != "2026-09-07" {
		t.Fatalf("next business day = %s", got)
	}
}

func TestNextDayTeamRoleSwitchAndLeave(t *testing.T) {
	db, err := sql.Open("sqlite", "file:workflow-role-switch-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
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
	}{{1, "110001", "leader", "101"}, {2, "110002", "player", "201"}} {
		if _, err = db.Exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(?,?,?,?)", row.id, "铇戣弴", row.qq, row.name); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(?,?)", row.id, row.char); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(?,?)", 2, "202"); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db}
	leaderToken := testSession(t, db, 1)
	playerToken := testSession(t, db, 2)
	created := callPlayer(t, a, "/api/v1/player/teams", leaderToken, map[string]any{"bossType": "black-dragon", "characterId": "101"})
	invite := created["inviteCode"].(string)
	var dayKey string
	if err = db.QueryRow("SELECT day_key FROM player_teams WHERE invite_code=?", invite).Scan(&dayKey); err != nil {
		t.Fatal(err)
	}
	if dayKey != tomorrow() {
		t.Fatalf("team day = %s, want next business day %s", dayKey, tomorrow())
	}
	first := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": invite, "characterId": "201"}, http.StatusAccepted)
	duplicate := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": invite, "characterId": "201"}, http.StatusConflict)
	if duplicate["code"] != "already-applied" {
		t.Fatalf("duplicate application code = %v, want already-applied", duplicate["code"])
	}
	second := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": invite, "characterId": "202"}, http.StatusAccepted)
	if first["requestId"] != second["requestId"] {
		t.Fatalf("role switch created request %v instead of reusing %v", second["requestId"], first["requestId"])
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/player/teams", nil)
	request.Header.Set("Authorization", "Bearer "+leaderToken)
	response := httptest.NewRecorder()
	a.teams(response, request)
	var view struct {
		Teams []team `json:"teams"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &view) != nil || len(view.Teams) != 1 || len(view.Teams[0].Pending) != 1 || view.Teams[0].Pending[0].CharacterID != "202" {
		t.Fatalf("leader pending view = status %d, body %s", response.Code, response.Body.String())
	}
	var requestCount int
	var requestCharacter string
	if err = db.QueryRow("SELECT COUNT(*),MAX(character_id) FROM player_team_applications WHERE team_id=(SELECT id FROM player_teams WHERE invite_code=?) AND account_id=2", invite).Scan(&requestCount, &requestCharacter); err != nil {
		t.Fatal(err)
	}
	if requestCount != 1 || requestCharacter != "202" {
		t.Fatalf("pending application = count %d, character %s", requestCount, requestCharacter)
	}
	callPlayerStatus(t, a, "/api/v1/player/teams/approve", leaderToken, map[string]any{"requestId": first["requestId"]}, http.StatusOK)
	callPlayerStatus(t, a, "/api/v1/player/teams/leave", playerToken, map[string]any{"inviteCode": invite}, http.StatusOK)
	var members int
	if err = db.QueryRow("SELECT COUNT(*) FROM player_team_members WHERE account_id=2 AND day_key=?", tomorrow()).Scan(&members); err != nil || members != 0 {
		t.Fatalf("member rows after leave = %d, err=%v", members, err)
	}
	var status string
	if err = db.QueryRow("SELECT status FROM player_team_applications WHERE id=?", first["requestId"]).Scan(&status); err != nil || status != "rejected" {
		t.Fatalf("application status after leave = %s, err=%v", status, err)
	}
	leaderLeave := callPlayerStatus(t, a, "/api/v1/player/teams/leave", leaderToken, map[string]any{"inviteCode": invite}, http.StatusConflict)
	if leaderLeave["code"] != "leader-cannot-leave" {
		t.Fatalf("leader leave code = %v, want leader-cannot-leave", leaderLeave["code"])
	}
}

func TestTeamApprovalAndCreationCloseOtherApplications(t *testing.T) {
	db, err := sql.Open("sqlite", "file:workflow-application-close-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
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
	}{{1, "120001", "leader-a", "101"}, {2, "120002", "player", "201"}, {3, "120003", "leader-b", "301"}} {
		if _, err = db.Exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(?,?,?,?)", row.id, "蘑菇", row.qq, row.name); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(?,?)", row.id, row.char); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(?,?)", 2, "202"); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db}
	leaderAToken := testSession(t, db, 1)
	playerToken := testSession(t, db, 2)
	leaderBToken := testSession(t, db, 3)
	teamA := callPlayer(t, a, "/api/v1/player/teams", leaderAToken, map[string]any{"bossType": "black-dragon", "characterId": "101"})
	teamB := callPlayer(t, a, "/api/v1/player/teams", leaderBToken, map[string]any{"bossType": "black-dragon", "characterId": "301"})
	teamZ := callPlayer(t, a, "/api/v1/player/teams", leaderBToken, map[string]any{"bossType": "zakum", "characterId": "301"})
	inviteA, inviteB, inviteZ := teamA["inviteCode"].(string), teamB["inviteCode"].(string), teamZ["inviteCode"].(string)
	first := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": inviteA, "characterId": "201"}, http.StatusAccepted)
	second := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": inviteB, "characterId": "202"}, http.StatusAccepted)
	viewReq := httptest.NewRequest(http.MethodGet, "/api/v1/player/teams", nil)
	viewReq.Header.Set("Authorization", "Bearer "+leaderAToken)
	viewResponse := httptest.NewRecorder()
	a.teams(viewResponse, viewReq)
	if bytes.Contains(viewResponse.Body.Bytes(), []byte("gameAccount")) {
		t.Fatalf("team response leaked a game account: %s", viewResponse.Body.String())
	}
	callPlayerStatus(t, a, "/api/v1/player/teams/approve", leaderAToken, map[string]any{"requestId": first["requestId"]}, http.StatusOK)
	var status, reason string
	if err = db.QueryRow("SELECT status,decision_reason FROM player_team_applications WHERE id=?", second["requestId"]).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "rejected" || reason != applicationReasonJoinedOtherTeam {
		t.Fatalf("other application = status %s, reason %s", status, reason)
	}
	playerViewReq := httptest.NewRequest(http.MethodGet, "/api/v1/player/teams", nil)
	playerViewReq.Header.Set("Authorization", "Bearer "+playerToken)
	playerViewResponse := httptest.NewRecorder()
	a.teams(playerViewResponse, playerViewReq)
	var playerView struct {
		Applications []teamApplication `json:"applications"`
	}
	if playerViewResponse.Code != http.StatusOK || json.Unmarshal(playerViewResponse.Body.Bytes(), &playerView) != nil {
		t.Fatalf("player application view = status %d, body %s", playerViewResponse.Code, playerViewResponse.Body.String())
	}
	var autoClosed bool
	for _, application := range playerView.Applications {
		if application.ID == second["requestId"] && application.Reason == applicationReasonJoinedOtherTeam {
			autoClosed = true
		}
	}
	if !autoClosed {
		t.Fatalf("player view did not explain closed application: %s", playerViewResponse.Body.String())
	}
	var pendingCount int
	if err = db.QueryRow("SELECT COUNT(*) FROM player_team_applications WHERE team_id=(SELECT id FROM player_teams WHERE invite_code=?) AND status='pending'", inviteB).Scan(&pendingCount); err != nil {
		t.Fatal(err)
	}
	if pendingCount != 0 {
		t.Fatalf("leader pending application count = %d", pendingCount)
	}
	callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": inviteZ, "characterId": "201"}, http.StatusAccepted)
	callPlayer(t, a, "/api/v1/player/teams", playerToken, map[string]any{"bossType": "zakum", "characterId": "202"})
	if err = db.QueryRow("SELECT status,decision_reason FROM player_team_applications WHERE team_id=(SELECT id FROM player_teams WHERE invite_code=?) AND account_id=2", inviteZ).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "rejected" || reason != applicationReasonJoinedOtherTeam {
		t.Fatalf("creation-closed application = status %s, reason %s", status, reason)
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
	callPlayerStatus(t, a, "/api/v1/player/teams/approve", otherLeaderToken, map[string]any{"requestId": secondApplication["requestId"]}, http.StatusNotFound)
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM player_team_members WHERE account_id=2 AND boss_type='black-dragon' AND day_key=?", tomorrow()).Scan(&count); err != nil || count != 1 {
		t.Fatalf("approved membership count = %d, err=%v", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM player_team_members WHERE team_id=(SELECT id FROM player_teams WHERE invite_code=?)", secondInvite).Scan(&count); err != nil || count != 3 {
		t.Fatalf("merged target member count = %d, err=%v", count, err)
	}
	var sourceStatus string
	if err = db.QueryRow("SELECT status FROM player_teams WHERE invite_code=?", invite).Scan(&sourceStatus); err != nil || sourceStatus != "merged" {
		t.Fatalf("source team status = %s, err=%v", sourceStatus, err)
	}
	callPlayerStatus(t, a, "/api/v1/player/teams/leave", leaderToken, map[string]any{"inviteCode": secondInvite}, http.StatusOK)
	if _, err = db.Exec("UPDATE player_accounts SET server='蘑菇' WHERE id=4"); err != nil {
		t.Fatal(err)
	}
	thirdCreated := callPlayer(t, a, "/api/v1/player/teams", snowToken, map[string]any{"bossType": "black-dragon", "characterId": "401"})
	thirdInvite := thirdCreated["inviteCode"].(string)
	callPlayerStatus(t, a, "/api/v1/player/teams/preview", leaderToken, map[string]any{"inviteCode": thirdInvite}, http.StatusOK)
	callPlayerStatus(t, a, "/api/v1/player/teams/join", leaderToken, map[string]any{"inviteCode": thirdInvite, "characterId": "101"}, http.StatusAccepted)
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
	} else if path == "/api/v1/player/teams/leave" {
		a.leaveTeam(recorder, req)
	} else if path == "/api/v1/player/teams/merge" {
		a.mergeTeam(recorder, req)
	} else if path == "/api/v1/player/teams/merge/approve" {
		a.approveMerge(recorder, req)
	} else if path == "/api/v1/player/teams/reject" {
		a.rejectJoin(recorder, req)
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
