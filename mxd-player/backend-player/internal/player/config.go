package player

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type playerConfig struct {
	Host, Port, DatabasePath, ServiceToken string
}

func loadPlayerConfig() playerConfig {
	databasePath := os.Getenv("PLAYER_DATABASE_PATH")
	if databasePath == "" {
		databasePath = filepath.Join("data", "player.sqlite")
	}
	host, port := os.Getenv("HOST"), os.Getenv("PORT")
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "26906"
	}
	return playerConfig{Host: host, Port: port, DatabasePath: databasePath, ServiceToken: strings.TrimSpace(os.Getenv("PLAYER_SERVICE_TOKEN"))}
}

func openPlayerDatabase(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=synchronous=NORMAL&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=temp_store(MEMORY)&_pragma=cache_size(-64000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}
