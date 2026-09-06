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

func TestInternalAccountImportWritesPlayerDatabase(t *testing.T) {
	db, err := sql.Open("sqlite", "file:integration-import-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db, serviceToken: "service-secret"}
	payload := []byte(`{"serverId":"mushroom","file":{"name":"mg-char-user-qq.csv","content":"char_id,user_id,username,bindQQ\n101,7,alpha,12345678\n102,7,alpha,12345678\n"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/player/accounts/import", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer service-secret")
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	a.importAccounts(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("import status = %d: %s", recorder.Code, recorder.Body.String())
	}
	var accounts, characters int
	if err = db.QueryRow("SELECT COUNT(*) FROM player_accounts WHERE server=?", "蘑菇").Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM player_characters").Scan(&characters); err != nil {
		t.Fatal(err)
	}
	if accounts != 1 || characters != 2 {
		t.Fatalf("imported account/characters = %d/%d, want 1/2", accounts, characters)
	}
	verify := httptest.NewRecorder()
	verifyReq := httptest.NewRequest(http.MethodPost, "/api/v1/player/verify", bytes.NewReader([]byte(`{"server":"蘑菇","qq":"12345678","gameAccount":"alpha"}`)))
	verifyReq.Header.Set("Content-Type", "application/json")
	a.verify(verify, verifyReq)
	if verify.Code != http.StatusOK {
		t.Fatalf("verify status = %d: %s", verify.Code, verify.Body.String())
	}
}

func TestInternalTeamSnapshotDoesNotExposeAccounts(t *testing.T) {
	db, err := sql.Open("sqlite", "file:integration-snapshot-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(1,?,?,?)", "蘑菇", "12345678", "alpha"); err != nil {
		t.Fatal(err)
	}
	date := time.Now().Format("2006-01-02")
	created := time.Now().UTC().Format(time.RFC3339)
	if _, err = db.Exec("INSERT INTO player_teams(id,server,boss_type,invite_code,leader_account_id,leader_character_id,day_key,created_at) VALUES(?,?,?,?,?,?,?,?)", "team-1", "蘑菇", "black-dragon", "ABC234", 1, "101", date, created); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO player_team_members(team_id,account_id,boss_type,character_id,day_key,joined_at) VALUES(?,?,?,?,?,?)", "team-1", 1, "black-dragon", "101", date, created); err != nil {
		t.Fatal(err)
	}
	a := &app{db: db, serviceToken: "service-secret"}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/internal/player/teams/snapshot?date="+date, nil)
	req.Header.Set("Authorization", "Bearer service-secret")
	recorder := httptest.NewRecorder()
	a.teamSnapshot(recorder, req)
	if recorder.Code != http.StatusOK || bytes.Contains(recorder.Body.Bytes(), []byte("alpha")) {
		t.Fatalf("snapshot status/body = %d/%s", recorder.Code, recorder.Body.String())
	}
	var result struct {
		Teams []snapshotTeam `json:"teams"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Teams) != 1 || result.Teams[0].ServerID != "mushroom" || len(result.Teams[0].Members) != 1 {
		t.Fatalf("snapshot = %#v", result.Teams)
	}
}
