# MXDCMD Ubuntu 24 部署文档

本目录提供三个独立项目的首次部署手册：

- [SOP 运营台](DEPLOY-SOP-UBUNTU24.md)：Node/Fastify 后端与 React 前端，端口 `26902`。
- [mxd-player](DEPLOY-PLAYER-UBUNTU24.md)：Go 后端与 React 前端，端口 `26906`。
- [mxd-auto-process](DEPLOY-AUTO-UBUNTU24.md)：Go 自动化服务及嵌入式 React 前端，端口 `26909`。
- [迁移 SOP 数据](MIGRATE-SOP-DATA.md)：旧服务器导出 SQL，传到新服务器后导入账号、记录和活动。

推荐在同一台服务器按 SOP、player、auto 的顺序执行。三个服务都只监听
`127.0.0.1`，公网只开放同一个 Nginx 的 `80/443`。Nginx 根据各自不同的
`server_name` 转发到 `26902`、`26906`、`26909`；三个域名必须不同，且都要
解析到这台服务器。SOP 和 player 共用 `mxd-sop` 运行用户，auto 使用
`mxd-auto`；三个服务各有独立 systemd 单元、数据目录和 SQLite 数据库。

域名、Git 仓库地址、邮箱和游戏服务器地址均是部署者自己的配置；文档中的
`example.com`、`YOUR_*` 和 `CHANGE_ME` 必须替换。

各手册按阶段给出命令块。某一步失败时请停下，修复终端显示的错误后，
从该步骤重新执行；不要一次性把多个步骤拼接后执行。
