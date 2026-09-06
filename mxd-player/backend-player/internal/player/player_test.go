package player

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPublishedServerNames(t *testing.T) {
	want := []string{"蘑菇", "雪人", "红蜗牛", "UU", "漂漂猪"}
	if len(servers) != len(want) {
		t.Fatalf("server count = %d, want %d", len(servers), len(want))
	}
	for i, name := range want {
		if servers[i] != name {
			t.Errorf("server[%d] = %q, want %q", i, servers[i], name)
		}
	}
}

func TestPlayerRouterRegistersPublicRoutes(t *testing.T) {
	handler := newPlayerRouter(&app{})
	tests := []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "health", method: http.MethodGet, path: "/health", status: http.StatusOK},
		{name: "servers", method: http.MethodGet, path: "/api/v1/player/servers", status: http.StatusOK},
		{name: "wrong method", method: http.MethodPost, path: "/health", status: http.StatusMethodNotAllowed},
		{name: "unknown", method: http.MethodGet, path: "/missing", status: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != tt.status {
				t.Fatalf("%s %s status = %d, want %d", tt.method, tt.path, response.Code, tt.status)
			}
		})
	}
}

func TestPlayerInputValidation(t *testing.T) {
	for _, value := range []string{"22734355", "12345", "1234567890123456"} {
		if !validQQ(value) {
			t.Errorf("valid QQ %q was rejected", value)
		}
	}
	for _, value := range []string{"1234", "12345678901234567", "12 34"} {
		if validQQ(value) {
			t.Errorf("invalid QQ %q was accepted", value)
		}
	}
	for _, value := range []string{"player_01", "snow-01", "A1"} {
		if !validGameAccount(value) {
			t.Errorf("valid game account %q was rejected", value)
		}
	}
	for _, value := range []string{"玩家", "player 01", ""} {
		if validGameAccount(value) {
			t.Errorf("invalid game account %q was accepted", value)
		}
	}
}

func TestSeedCSVPreservesDistinctAccountsWithSharedQQ(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "mg-char-user-qq.csv"), []byte("char_id,user_id,username,bindQQ\n6480,5973,qe2,2453103\n6481,5972,qe1,2453103\n"), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:seed-csv-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PLAYER_CHAR_DATA_DIR", dir)
	if !seedCSV(db) {
		t.Fatal("seedCSV did not import the fixture")
	}
	var accounts, characters int
	if err = db.QueryRow("SELECT COUNT(*) FROM player_accounts").Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM player_characters").Scan(&characters); err != nil {
		t.Fatal(err)
	}
	if accounts != 2 || characters != 2 {
		t.Fatalf("imported accounts/characters = %d/%d, want 2/2", accounts, characters)
	}
	for _, name := range []string{"qe1", "qe2"} {
		var character string
		if err = db.QueryRow("SELECT c.character_id FROM player_accounts a JOIN player_characters c ON c.account_id=a.id WHERE a.server=? AND a.qq=? AND a.game_account=?", "蘑菇", "2453103", name).Scan(&character); err != nil {
			t.Fatal(err)
		}
		if character == "" {
			t.Fatalf("account %s has no character", name)
		}
	}
}

func TestPlayerMeRestoresSession(t *testing.T) {
	db, err := sql.Open("sqlite", "file:player-me-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(1,?,?,?)", "铇戣弴", "100001", "player1"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO player_characters(account_id,character_id) VALUES(1,?)", "101"); err != nil {
		t.Fatal(err)
	}
	token := testSession(t, db, 1)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/player/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	(&app{db: db}).me(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("me status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var result struct{ Account account }
	if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Account.GameAccount != "player1" || len(result.Account.Characters) != 1 || result.Account.Characters[0] != "101" {
		t.Fatalf("restored account = %#v", result.Account)
	}
}
