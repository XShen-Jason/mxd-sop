package player

import (
	"errors"
	"net/http"
)

func newPlayerRouter(a *app) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.health)
	mux.HandleFunc("/api/v1/player/servers", a.servers)
	mux.HandleFunc("/api/v1/player/verify", a.verify)
	mux.HandleFunc("/api/v1/player/me", a.me)
	mux.HandleFunc("/api/v1/player/teams", a.teams)
	mux.HandleFunc("/api/v1/player/teams/join", a.join)
	mux.HandleFunc("/api/v1/player/teams/leave", a.leaveTeam)
	mux.HandleFunc("/api/v1/player/teams/preview", a.previewJoin)
	mux.HandleFunc("/api/v1/player/teams/approve", a.approveJoin)
	mux.HandleFunc("/api/v1/player/teams/requests/approve", a.approveJoin)
	mux.HandleFunc("/api/v1/player/teams/reject", a.rejectJoin)
	mux.HandleFunc("/api/v1/player/teams/requests/reject", a.rejectJoin)
	mux.HandleFunc("/api/v1/player/teams/merge", a.mergeTeam)
	mux.HandleFunc("/api/v1/player/teams/merge/approve", a.approveMerge)
	mux.HandleFunc("/api/v1/internal/player/accounts/import", a.importAccounts)
	mux.HandleFunc("/api/v1/internal/player/teams/snapshot", a.teamSnapshot)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { writeErr(w, errors.New("not-found")) })
	return security(rateLimit(mux))
}
