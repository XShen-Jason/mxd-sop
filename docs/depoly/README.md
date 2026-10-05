# MXDCMD Ubuntu 24 部署文档

本目录提供三个独立项目的首次部署手册：

- [SOP 运营台](DEPLOY-SOP-UBUNTU24.md)：Node/Fastify 后端与 React 前端，端口 `26902`。
- [mxd-player](DEPLOY-PLAYER-UBUNTU24.md)：Go 后端与 React 前端，端口 `26906`。
- [mxd-auto-process](DEPLOY-AUTO-UBUNTU24.md)：Go 自动化服务及嵌入式 React 前端，端口 `26909`。

推荐在同一台服务器按 SOP、player、auto 的顺序执行。三个服务都只监听
`127.0.0.1`，公网只开放 Nginx 的 `80/443`。每个服务都有独立 systemd
单元、运行用户、数据目录和 SQLite 数据库。

域名、Git 仓库地址、邮箱和游戏服务器地址均是部署者自己的配置；文档中的
`example.com`、`YOUR_*` 和 `CHANGE_ME` 必须替换。

每个命令块都包在子 shell 中。某一步失败时只会结束当前步骤并保留 SSH 会话；
请修复终端显示的最后一个错误后，从该步骤重新执行。不要一次性把多个步骤拼接
后执行。
