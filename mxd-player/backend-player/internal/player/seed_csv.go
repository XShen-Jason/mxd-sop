package player

import (
	"database/sql"
	"encoding/csv"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var serverFiles = map[string]string{
	"mg": "蘑菇", "xr": "雪人", "hwn": "红蜗牛", "uu": "UU", "ppz": "漂漂猪",
}

// seedCSV imports the authoritative char-user-qq exports. A row is a
// character; account identity is the (server, QQ, username) tuple.
func seedCSV(db *sql.DB) bool {
	dir := os.Getenv("PLAYER_CHAR_DATA_DIR")
	candidates := []string{dir}
	if dir == "" {
		candidates = []string{filepath.Join("data", "char-user-qq"), filepath.Join("mxd-player", "backend-player", "data", "char-user-qq")}
	}
	var files []string
	var err error
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		files, err = filepath.Glob(filepath.Join(candidate, "*-char-user-qq.csv"))
		if err == nil && len(files) > 0 {
			break
		}
	}
	if err != nil || len(files) == 0 {
		return false
	}
	tx, err := db.Begin()
	if err != nil {
		return false
	}
	defer tx.Rollback()
	loaded := 0
	for _, file := range files {
		prefix := strings.TrimSuffix(filepath.Base(file), "-char-user-qq.csv")
		server, ok := serverFiles[strings.ToLower(prefix)]
		if !ok || importCSVFile(tx, file, server, &loaded) != nil {
			continue
		}
	}
	if loaded == 0 || tx.Commit() != nil {
		return false
	}
	return true
}

func importCSVFile(tx *sql.Tx, file, server string, loaded *int) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	reader := csv.NewReader(f)
	reader.FieldsPerRecord = -1
	_, err = reader.Read()
	if err != nil {
		return err
	}
	for {
		record, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil || len(record) < 4 {
			continue
		}
		charID, userID, username, qq := strings.TrimSpace(record[0]), strings.TrimSpace(record[1]), strings.TrimSpace(record[2]), strings.TrimSpace(record[3])
		if !validCharacterID(charID) || !validQQ(qq) || !validGameAccount(username) || userID == "" {
			continue
		}
		_, err = tx.Exec(`INSERT INTO player_accounts(server,qq,game_account,user_id) VALUES(?,?,?,?)
ON CONFLICT(server,qq,game_account) DO UPDATE SET user_id=excluded.user_id`, server, qq, username, userID)
		if err != nil {
			continue
		}
		var accountID int64
		if tx.QueryRow("SELECT id FROM player_accounts WHERE server=? AND qq=? AND game_account=?", server, qq, username).Scan(&accountID) != nil {
			continue
		}
		if _, err = tx.Exec("INSERT OR IGNORE INTO player_characters(account_id,character_id) VALUES(?,?)", accountID, charID); err == nil {
			*loaded = *loaded + 1
		}
	}
	return nil
}
