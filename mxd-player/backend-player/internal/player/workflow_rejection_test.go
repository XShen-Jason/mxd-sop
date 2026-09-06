package player

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLeaderCanRejectJoinApplication(t *testing.T) {
	db, err := sql.Open("sqlite", "file:workflow-rejection-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
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
	}{{1, "130001", "leader", "101"}, {2, "130002", "player", "201"}} {
		if _, err = db.Exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(?,?,?,?)", row.id, "蘑菇", row.qq, row.name); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(?,?)", row.id, row.char); err != nil {
			t.Fatal(err)
		}
	}
	a := &app{db: db}
	leaderToken := testSession(t, db, 1)
	playerToken := testSession(t, db, 2)
	created := callPlayer(t, a, "/api/v1/player/teams", leaderToken, map[string]any{"bossType": "black-dragon", "characterId": "101"})
	application := callPlayerStatus(t, a, "/api/v1/player/teams/join", playerToken, map[string]any{"inviteCode": created["inviteCode"], "characterId": "201"}, http.StatusAccepted)
	callPlayerStatus(t, a, "/api/v1/player/teams/reject", leaderToken, map[string]any{"requestId": application["requestId"]}, http.StatusOK)
	var status, reason string
	if err = db.QueryRow("SELECT status,decision_reason FROM player_team_applications WHERE id=?", application["requestId"]).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "rejected" || reason != applicationReasonLeaderRejected {
		t.Fatalf("rejected application = status %s, reason %s", status, reason)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/player/teams", nil)
	request.Header.Set("Authorization", "Bearer "+playerToken)
	response := httptest.NewRecorder()
	a.teams(response, request)
	var view struct {
		Applications []teamApplication `json:"applications"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &view) != nil || len(view.Applications) != 1 || view.Applications[0].Reason != applicationReasonLeaderRejected {
		t.Fatalf("player rejection history = status %d, body %s", response.Code, response.Body.String())
	}
}
