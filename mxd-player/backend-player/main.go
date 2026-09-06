package main

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var servers = []string{"蘑菇", "雪人", "红蜗牛", "UU", "漂漂猪"}
var codeChars = []byte("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

type app struct{ db *sql.DB }
type account struct {
	ID                      int64
	Server, QQ, GameAccount string
	Characters              []string
}
type teamMember struct {
	GameAccount string `json:"gameAccount"`
	CharacterID string `json:"characterId"`
	IsLeader    bool   `json:"isLeader"`
}
type teamRequest struct {
	ID          string `json:"requestId"`
	GameAccount string `json:"gameAccount"`
	CharacterID string `json:"characterId"`
	RequestedAt string `json:"requestedAt"`
}
type teamMergeRequest struct {
	ID               string `json:"requestId"`
	SourceInviteCode string `json:"sourceInviteCode"`
	BossType         string `json:"bossType"`
	MemberCount      int    `json:"memberCount"`
	RequestedAt      string `json:"requestedAt"`
}
type teamApplication struct {
	ID          string `json:"requestId"`
	BossType    string `json:"bossType"`
	InviteCode  string `json:"inviteCode"`
	CharacterID string `json:"characterId"`
	Status      string `json:"status"`
	DayKey      string `json:"day"`
	RequestedAt string `json:"requestedAt"`
}
type team struct {
	ID            string             `json:"-"`
	BossType      string             `json:"bossType"`
	InviteCode    string             `json:"inviteCode"`
	Server        string             `json:"server"`
	Leader        bool               `json:"leader"`
	Members       []teamMember       `json:"members"`
	Pending       []teamRequest      `json:"pendingRequests,omitempty"`
	PendingMerges []teamMergeRequest `json:"pendingMergeRequests,omitempty"`
}
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func main() {
	dbPath := os.Getenv("PLAYER_DATABASE_PATH")
	if dbPath == "" {
		dbPath = filepath.Join("data", "player.sqlite")
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=synchronous=NORMAL&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=temp_store(MEMORY)&_pragma=cache_size(-64000)")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err = migrate(db); err != nil {
		log.Fatal(err)
	}
	seed(db)
	a := &app{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.health)
	mux.HandleFunc("/api/v1/player/servers", a.servers)
	mux.HandleFunc("/api/v1/player/verify", a.verify)
	mux.HandleFunc("/api/v1/player/me", a.me)
	mux.HandleFunc("/api/v1/player/teams", a.teams)
	mux.HandleFunc("/api/v1/player/teams/join", a.join)
	mux.HandleFunc("/api/v1/player/teams/preview", a.previewJoin)
	mux.HandleFunc("/api/v1/player/teams/approve", a.approveJoin)
	mux.HandleFunc("/api/v1/player/teams/requests/approve", a.approveJoin)
	mux.HandleFunc("/api/v1/player/teams/merge", a.mergeTeam)
	mux.HandleFunc("/api/v1/player/teams/merge/approve", a.approveMerge)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { writeErr(w, errors.New("not-found")) })
	host, port := os.Getenv("HOST"), os.Getenv("PORT")
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "26906"
	}
	log.Printf("mxd-player backend listening on %s:%s", host, port)
	server := &http.Server{
		Addr:              host + ":" + port,
		Handler:           security(rateLimit(mux)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}

func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	jsonWrite(w, 200, map[string]string{"status": "ok", "service": "mxd-player"})
}
func (a *app) servers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	jsonWrite(w, 200, map[string][]string{"servers": servers})
}
func (a *app) verify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	var in struct{ Server, QQ, GameAccount string }
	if !decode(r, &in) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	in.Server, in.QQ, in.GameAccount = strings.TrimSpace(in.Server), strings.TrimSpace(in.QQ), strings.TrimSpace(in.GameAccount)
	if !validServer(in.Server) || !validQQ(in.QQ) || !validGameAccount(in.GameAccount) {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	var ac account
	err := a.db.QueryRowContext(r.Context(), "SELECT id,server,qq,game_account FROM player_accounts WHERE server=? AND qq=? AND game_account=?", in.Server, in.QQ, in.GameAccount).Scan(&ac.ID, &ac.Server, &ac.QQ, &ac.GameAccount)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, errors.New("account-not-found"))
		return
	}
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	ac.Characters, err = a.characters(r.Context(), ac.ID)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	_, _ = a.db.ExecContext(r.Context(), "DELETE FROM player_sessions WHERE expires_at<=?", time.Now().UnixMilli())
	token := randomToken()
	if _, err = a.db.ExecContext(r.Context(), "INSERT INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)", digest(token), ac.ID, time.Now().Add(12*time.Hour).UnixMilli()); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, 200, map[string]any{"token": token, "account": publicAccount(ac)})
}
func (a *app) me(w http.ResponseWriter, r *http.Request) {
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonWrite(w, 200, map[string]any{"account": publicAccount(ac)})
}
