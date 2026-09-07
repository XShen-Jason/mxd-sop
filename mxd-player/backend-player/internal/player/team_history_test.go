package player

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTeamHistoryDateAndMembershipIsolation(t *testing.T) {
	db, err := sql.Open("sqlite", "file:team-history-test?mode=memory&cache=shared&_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for id := 1; id <= 3; id++ {
		exec("INSERT INTO player_accounts(id,server,qq,game_account) VALUES(?,?,?,?)", id, "test", fmt.Sprint(110000+id), fmt.Sprint(id))
	}
	past := businessDay(time.Now().AddDate(0, 0, -1))
	for index, day := range []string{past, today(), tomorrow()} {
		for _, boss := range []string{"black-dragon", "zakum"} {
			id := fmt.Sprintf("%d-%s", index, boss)
			exec(`INSERT INTO player_teams(id,server,boss_type,invite_code,leader_account_id,leader_character_id,day_key,created_at) VALUES(?,?,?,?,1,'101',?,?)`, id, "test", boss, id, day, day)
			for accountID := 1; accountID <= 2; accountID++ {
				exec(`INSERT INTO player_team_members(team_id,account_id,boss_type,character_id,day_key,joined_at) VALUES(?,?,?,?,?,?)`, id, accountID, boss, fmt.Sprint(index*1000+accountID), day, day)
			}
			exec(`INSERT INTO player_team_applications(id,team_id,account_id,boss_type,character_id,day_key,status,requested_at) VALUES(?,?,3,?,'301',?,'pending',?)`, id, id, boss, day, day)
		}
	}
	a := &app{db: db}
	token := testSession(t, db, 2)
	outsider := testSession(t, db, 3)
	router := newPlayerRouter(a)
	for _, tc := range []struct {
		name, date, token string
		status, count     int
	}{
		{"today", "", token, 200, 2},
		{"past", past, token, 200, 2},
		{"future", tomorrow(), token, 400, 0},
		{"malformed", "2026-02-30", token, 400, 0},
		{"legacy unknown date", "1970-01-01", token, 400, 0},
		{"pending outsider", today(), outsider, 200, 0},
		{"unauthenticated", "", "", 401, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/player/teams/history?date="+tc.date, nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != tc.status {
				t.Fatalf("status %d: %s", res.Code, res.Body.String())
			}
			if tc.status != 200 {
				return
			}
			var result teamHistoryResponse
			if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Teams) != tc.count || result.Today != today() {
				t.Fatalf("unexpected response: %+v", result)
			}
			wantDay := tc.date
			if wantDay == "" {
				wantDay = today()
			}
			if result.Day != wantDay {
				t.Fatalf("wrong day: %s", result.Day)
			}
			for _, team := range result.Teams {
				if len(team.Members) != 2 || !team.Members[0].IsLeader || team.Members[1].IsLeader {
					t.Fatalf("wrong roster: %+v", team)
				}
				wantCharacter := "1001"
				if wantDay == past {
					wantCharacter = "1"
				}
				if team.Members[0].CharacterID != wantCharacter {
					t.Fatalf("roster from wrong day: %+v", team)
				}
			}
			for _, private := range []string{"inviteCode", "requestId", "gameAccount", "qq", "pendingRequests"} {
				if strings.Contains(res.Body.String(), private) {
					t.Fatalf("leaked %s", private)
				}
			}
		})
	}
}
