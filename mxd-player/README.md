# mxd-player

独立的玩家组队页面，前端和后端分别位于 `frontend-player`、`backend-player`。

在此目录运行 `start-player.ps1`（或 `start-player.bat`）即可启动：

- 前端：`http://127.0.0.1:6173`
- 后端：`http://127.0.0.1:26906`
- 数据库：项目根目录 `data/player-player.sqlite`

前端默认通过同源代理访问后端；如需跨域部署，可设置 `VITE_PLAYER_API`。
