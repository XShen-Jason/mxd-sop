# mxd-player backend

The Go player service verifies accounts, manages daily teams, and owns the
SQLite persistence boundary.

Account data is imported only from `data/char-user-qq/*-char-user-qq.csv`.
Each row has `char_id,user_id,username,bindQQ`; the filename prefix maps the
server (`mg`, `xr`, `hwn`, `uu`, or `ppz`). Set `PLAYER_CHAR_DATA_DIR` to use a
different export directory. Account verification matches the complete
`(server, bindQQ, username)` tuple and keeps every character for that account.
If no CSV is available, the service creates no demo accounts or teams.

Run with `go run .`. The default listener is `127.0.0.1:26906`, and the direct
database path is `data/player.sqlite`. The project launcher uses
`data/player-player.sqlite`. `PLAYER_DATABASE_PATH`, `PLAYER_CHAR_DATA_DIR`,
`PLAYER_CORS_ORIGIN`, `HOST`, and `PORT` are configurable.
