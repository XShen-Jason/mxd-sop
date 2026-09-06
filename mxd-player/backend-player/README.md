# mxd-player backend

The Go player service verifies accounts, manages daily teams, and owns the
SQLite persistence boundary.

Account data is imported only from `data/char-user-qq/*-char-user-qq.csv`.
Each row has `char_id,user_id,username,bindQQ`; the filename prefix maps the
server (`mg`, `xr`, `hwn`, `uu`, or `ppz`). Set `PLAYER_CHAR_DATA_DIR` to use a
different export directory. Account verification matches the complete
`(server, bindQQ, username)` tuple and keeps every character for that account.
If no CSV is available, the service creates no demo accounts or teams.

Run with `go run ./cmd/mxd-player` (the root `go run .` wrapper remains
backward-compatible). The default listener is `127.0.0.1:26906`, and the direct
database path is `data/player.sqlite`. The project launcher uses
`data/player-player.sqlite`. `PLAYER_DATABASE_PATH`, `PLAYER_CHAR_DATA_DIR`,
`PLAYER_CORS_ORIGIN`, `PLAYER_SERVICE_TOKEN`, `HOST`, and `PORT` are
configurable. Set `PLAYER_SERVICE_TOKEN` to a long random value before
allowing the operations desk to call the internal account-import and
team-snapshot endpoints.

The internal endpoints are `POST /api/v1/internal/player/accounts/import` and
`GET /api/v1/internal/player/teams/snapshot`. They require the service bearer
token. Account imports are applied directly to SQLite in one transaction and
only upsert accounts/characters; they never create an uploaded CSV file or
delete teams, sessions, or existing accounts.

The executable entrypoint is `cmd/mxd-player`. The `internal/player` package
contains the capability implementation and its tests; it is intentionally
private to this backend module. The root `main.go` is only a compatibility
wrapper for existing `go run .` and deployment commands.

```text
backend-player/
├── cmd/mxd-player/main.go       # production executable
├── internal/player/             # private player-registration implementation
│   ├── account_http.go          # account/session HTTP boundary
│   ├── router.go                # route and middleware registration
│   ├── config.go                # environment and SQLite setup
│   ├── models.go                # domain/response shapes
│   ├── storage.go, seed_csv.go  # schema and data import
│   └── teams*.go, preview.go    # team workflows and queries
└── main.go                      # compatibility wrapper for `go run .`
```
