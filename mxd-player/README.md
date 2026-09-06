# mxd-player

独立的玩家组队页面，前端和后端分别位于 `frontend-player`、`backend-player`。

在此目录运行 `start-player.ps1`（或 `start-player.bat`）即可启动：

- 前端：`http://127.0.0.1:6173`
- 后端：`http://127.0.0.1:26906`
- 数据库：项目根目录 `data/player-player.sqlite`

前端默认通过同源代理访问后端；如需跨域部署，可设置 `VITE_PLAYER_API`。

## 本地配置

本地同机测试只需要在下面两个文件填入同一个长随机服务令牌，其他默认值无需修改：

```text
C:\Users\22734\Desktop\PROJECTS\MXDCMD\.env
C:\Users\22734\Desktop\PROJECTS\MXDCMD\mxd-player\backend-player\.env
```

`start-player.ps1` 会自动读取第二个文件；运营台后端会从第一个文件读取
`MXD_PLAYER_LOCAL_URL` 和 `MXD_PLAYER_SERVICE_TOKEN`。这两个文件已被 Git
忽略，不会进入提交。

## Module manifest

### Module ID and purpose

`player-registration` owns player verification, next-day raid-team creation,
join applications, leader approval, and same-raid team merges.

### Ownership and invariants

- The backend owns account validation, daily Beijing-time boundaries, team
  capacity, approval transactions, and SQLite persistence.
- The frontend owns page state, interaction flow, loading/empty/error states,
  and presentation only. It consumes the HTTP contracts in `CONTRACTS.md`.
- A team has at most 10 members, team IDs stay private, and each team targets
  the next Beijing business day. Members can leave before the 00:00 lock;
  leaders cannot leave and cannot kick members.
- Approving or creating a team automatically closes the player's other pending
  applications for that boss, with a visible reason in application history.

### Public surface

The stable HTTP surface is `player.servers`, `player.verify`, `player.me`,
`player.teams`, `player.teams.join`, `player.teams.preview`,
`player.teams.approve`, `player.teams.reject`, `player.teams.leave`, `player.teams.merge`, and
`player.teams.merge.approve`. The canonical request/response and error shapes
are maintained in `CONTRACTS.md`.

### Implementation layout

`frontend-player/src/App.tsx` is a compatibility export. The page orchestration
boundary is `frontend-player/src/features/player-registration/PlayerRegistrationApp.tsx`;
its API client, session adapter, error mapping, and UI components are grouped
under the same capability directory.
`backend-player/cmd/mxd-player/main.go` is the explicit executable entrypoint;
`backend-player/main.go` remains a compatibility wrapper. The capability
implementation and tests live under `backend-player/internal/player`, grouped
by HTTP boundary, configuration, persistence, and team workflow files. No
frontend file imports backend implementation details.

### Tests and checks

Run `npm run lint` and `npm run build` in `frontend-player`, then `go test ./...`
and `go vet ./...` in `backend-player`.
