package player

import (
	"crypto/subtle"
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxImportCharacters = 1_000_000

type accountImportRequest struct {
	ServerID string `json:"serverId"`
	File     struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	} `json:"file"`
}

type importedAccountRow struct {
	Server, CharacterID, UserID, Username, QQ string
}

func (a *app) importAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	if !a.serviceAuthorized(r) {
		writeErr(w, errors.New("unauthorized"))
		return
	}
	var in accountImportRequest
	if !decodeBody(r, &in, 2*1024*1024) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	server, rows, skipped, err := parseAccountCSV(in.ServerID, in.File.Name, in.File.Content)
	if err != nil {
		writeErr(w, err)
		return
	}
	importedAt := time.Now().UTC().Format(time.RFC3339)
	if err = a.upsertAccounts(r, server, rows); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string]any{"serverId": in.ServerID, "rowCount": len(rows), "skippedRows": skipped, "importedAt": importedAt})
}

func (a *app) upsertAccounts(r *http.Request, server string, rows []importedAccountRow) error {
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range rows {
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO player_accounts(server,qq,game_account,user_id)
VALUES(?,?,?,?) ON CONFLICT(server,qq,game_account) DO UPDATE SET user_id=excluded.user_id`, row.Server, row.QQ, row.Username, row.UserID); err != nil {
			return err
		}
		var accountID int64
		if err = tx.QueryRowContext(r.Context(), `SELECT id FROM player_accounts WHERE server=? AND qq=? AND game_account=?`, row.Server, row.QQ, row.Username).Scan(&accountID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT OR IGNORE INTO player_characters(account_id,character_id) VALUES(?,?)`, accountID, row.CharacterID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func parseAccountCSV(serverID, name, content string) (string, []importedAccountRow, int, error) {
	server, ok := canonicalServer(serverID)
	if !ok || !validCSVName(name, server) || len(content) > maxImportCharacters {
		return "", nil, 0, errors.New("invalid-input")
	}
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(content, "\ufeff")))
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return "", nil, 0, errors.New("invalid-input")
	}
	indexes := map[string]int{}
	for index, value := range header {
		indexes[strings.ToLower(strings.TrimSpace(value))] = index
	}
	charIndex, charOK := indexes["char_id"]
	userIndex, userOK := indexes["user_id"]
	nameIndex, nameOK := indexes["username"]
	qqIndex, qqOK := indexes["bindqq"]
	if !charOK || !userOK || !nameOK || !qqOK {
		return "", nil, 0, errors.New("invalid-input")
	}
	unique := make(map[string]importedAccountRow)
	skipped := 0
	for {
		record, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil || len(record) <= maxIndex(charIndex, userIndex, nameIndex, qqIndex) {
			skipped++
			continue
		}
		row := importedAccountRow{Server: server, CharacterID: strings.TrimSpace(record[charIndex]), UserID: strings.TrimSpace(record[userIndex]), Username: strings.TrimSpace(record[nameIndex]), QQ: strings.TrimSpace(record[qqIndex])}
		if row.CharacterID == "" && row.UserID == "" && row.Username == "" && row.QQ == "" {
			continue
		}
		if !validCharacterID(row.CharacterID) || !validUserID(row.UserID) || !validGameAccount(row.Username) || !validQQ(row.QQ) {
			skipped++
			continue
		}
		unique[row.CharacterID+"\x00"+row.QQ+"\x00"+row.Username] = row
		if len(unique) > 200_000 {
			return "", nil, 0, errors.New("invalid-input")
		}
	}
	rows := make([]importedAccountRow, 0, len(unique))
	for _, row := range unique {
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return "", nil, 0, errors.New("invalid-input")
	}
	return server, rows, skipped, nil
}

func maxIndex(values ...int) int {
	result := 0
	for _, value := range values {
		if value > result {
			result = value
		}
	}
	return result
}

func validCSVName(name, server string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	for prefix, candidate := range serverFiles {
		if candidate == server {
			return name == prefix+"-char-user-qq.csv"
		}
	}
	return false
}

func canonicalServer(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if validServer(value) {
		return value, true
	}
	ids := map[string]string{"mushroom": "蘑菇", "yeti": "雪人", "red-snail": "红蜗牛", "uu": "UU", "piaopiao-pig": "漂漂猪"}
	server, ok := ids[strings.ToLower(value)]
	return server, ok
}

func validUserID(value string) bool {
	return len(value) > 0 && len(value) <= 64 && !strings.ContainsAny(value, "\x00\r\n")
}

func (a *app) serviceAuthorized(r *http.Request) bool {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	return a.serviceToken != "" && len(token) == len(a.serviceToken) && subtle.ConstantTimeCompare([]byte(token), []byte(a.serviceToken)) == 1
}

type snapshotMember struct {
	CharacterID string `json:"characterId"`
	JoinedAt    string `json:"joinedAt"`
}

type snapshotTeam struct {
	ID        string           `json:"id"`
	ServerID  string           `json:"serverId"`
	BossType  string           `json:"bossType"`
	CreatedAt string           `json:"createdAt"`
	Members   []snapshotMember `json:"members"`
}

func (a *app) teamSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	if !a.serviceAuthorized(r) {
		writeErr(w, errors.New("unauthorized"))
		return
	}
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if !validDayKey(date) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `WITH selected_teams AS (
SELECT id FROM player_teams WHERE status='active' AND day_key=? ORDER BY created_at,id LIMIT 500
)
SELECT t.id,t.server,t.boss_type,t.created_at,m.character_id,m.joined_at
FROM selected_teams s JOIN player_teams t ON t.id=s.id JOIN player_team_members m ON m.team_id=t.id
ORDER BY t.created_at,t.id,m.joined_at`, date)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer rows.Close()
	teams := make([]snapshotTeam, 0)
	positions := make(map[string]int)
	for rows.Next() {
		var id, server, boss, createdAt, characterID, joinedAt string
		if err = rows.Scan(&id, &server, &boss, &createdAt, &characterID, &joinedAt); err != nil {
			writeErr(w, errors.New("internal-error"))
			return
		}
		index, exists := positions[id]
		if !exists {
			serverID := playerServerID(server)
			if serverID == "" {
				continue
			}
			teams = append(teams, snapshotTeam{ID: id, ServerID: serverID, BossType: boss, CreatedAt: createdAt, Members: []snapshotMember{}})
			index = len(teams) - 1
			positions[id] = index
		}
		teams[index].Members = append(teams[index].Members, snapshotMember{CharacterID: characterID, JoinedAt: joinedAt})
	}
	if err = rows.Err(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, map[string]any{"date": date, "teams": teams})
}

func validDayKey(value string) bool {
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}

func playerServerID(server string) string {
	ids := map[string]string{"蘑菇": "mushroom", "雪人": "yeti", "红蜗牛": "red-snail", "UU": "uu", "漂漂猪": "piaopiao-pig"}
	return ids[server]
}
