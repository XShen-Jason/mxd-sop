# CONTRACTS.md

## Purpose

这里登记客服工单系统的稳定边界。详细定义只保留在 docs/contracts/ 对应文件中；生成的客户端类型或 OpenAPI 文件均属于派生物，不能反向成为业务规则来源。

## Identity and ownership

Contract ID 使用 module-id.operation-name，版本单独记录。所有 ID 为不透明字符串，时间为 UTC RFC 3339。客服和管理的权限由后端认证上下文决定，不接受客户端传入的角色作为授权依据。

## Contract registry

玩家公开报名站使用独立的 `player-registration` 契约（v1）：
`player.verify`、`player.me`、`player.teams`、`player.teams.join`。后端负责
服务器/QQ/游戏账号匹配、角色归属、每个副本每账号一次、队伍最多 10 人和
并发加入事务；前端只消费这些 HTTP 接口，不读取数据库。

认证契约登记于 `docs/contracts/auth.md`：auth.login、auth.logout、auth.me、auth.list-users、auth.create-user、auth.update-user、auth.delete-user。operation-groups 还提供 update-group、approve-group、reject-group、issue-group 和 list-overview；新申请状态为 pending、approved、rejected、issued（旧 completed 仅兼容读取）。

| Contract ID | Owner | Version | Consumers | Canonical definition |
| --- | --- | --- | --- | --- |
| auth.login | auth | v1 | frontend | contracts/auth.md |
| auth.logout | auth | v1 | frontend | contracts/auth.md |
| auth.me | auth | v1 | frontend | contracts/auth.md |
| auth.list-users | auth | v1 | accounts workspace | contracts/auth.md |
| auth.create-user | auth | v1 | accounts workspace | contracts/auth.md |
| auth.update-user | auth | v1 | accounts workspace | contracts/auth.md |
| operation-groups.update-group | operation-groups | v1 | frontend customer | contracts/operation-groups.md |
| operation-groups.approve-group | operation-groups | v1 | queue workspace | contracts/operation-groups.md |
| operation-groups.reject-group | operation-groups | v1 | queue workspace | contracts/operation-groups.md |
| operation-groups.issue-group | operation-groups | v1 | ready workspace | contracts/operation-groups.md |
| operation-groups.list-overview | operation-groups | v1 | queue workspace | contracts/operation-groups.md |
| operation-groups.list-options | operation-groups | v1 | frontend 客服/管理 | contracts/operation-groups.md |
| operation-groups.submit-group | operation-groups | v1 | frontend 客服 | contracts/operation-groups.md |
| operation-groups.list-own | operation-groups | v1 | frontend 客服 | contracts/operation-groups.md |
| operation-groups.cancel-group | operation-groups | v1 | frontend 客服 | contracts/operation-groups.md |
| operation-groups.list-queue | operation-groups | v1 | frontend with queue workspace | contracts/operation-groups.md |
| operation-groups.list-reviews | operation-groups | v1 | frontend with queue workspace | contracts/operation-groups.md |
| operation-groups.complete-group | operation-groups | v1 | frontend with ready/archive workspace | contracts/operation-groups.md |
| operation-groups.list-archive | operation-groups | v1 | frontend with reissue/archive workspace | contracts/operation-groups.md |
| item-catalog.search | item-catalog | v1 | frontend 客服/管理 | contracts/item-catalog.md |
| item-catalog.by-class | item-catalog | v1 | frontend 管理活动配置 | contracts/item-catalog.md |
| command-generation.generate | command-generation | v1 | backend manager projection | contracts/command-generation.md |
| activities.list | activities | v1 | frontend with request/activities workspace | contracts/activities.md |
| activities.replace | activities | v1 | frontend with activities workspace | contracts/activities.md |
| team-view.read | team-view | v1 | frontend with team-view workspace | contracts/team-view.md |
| team-view.import-clears | team-view | v1 | frontend with team-view workspace | contracts/team-view.md |

| operation-groups.remind-customer | operation-groups | v1 | frontend with ready workspace | contracts/operation-groups.md |
| operation-groups.mark-online | operation-groups | v1 | frontend request owner | contracts/operation-groups.md |
| operation-groups.list-reminders | operation-groups | v1 | frontend with reminders workspace | contracts/operation-groups.md |
| operation-groups.workspace-counts | operation-groups | v1 | frontend | contracts/operation-groups.md |
| operation-groups.events | operation-groups | v1 | frontend | contracts/operation-groups.md |

## player-directory contracts

`player-directory.search` (`GET /api/v1/player-directory/search`) requires the
`player-directory` workspace and returns bounded, grouped account results with
opaque cursor pagination. `player-directory.import`
(`POST /api/v1/player-directory/import`) requires the `player-directory`
workspace, accepts one server-selected validated CSV, and replaces only that
server's rows.
The canonical request and response definitions live in
`docs/contracts/player-directory.md`.

## team-view contracts

`team-view.apply-rewards` (`POST /api/v1/team-view/apply`) creates system-approved
reward requests for eligible teams; see contracts/team-view.md. It consumes
the internal `player-directory.find-characters` contract in
contracts/player-directory.md.

`team-view.read` (`GET /api/v1/team-view`) requires the `team-view` workspace
and returns a bounded projection of the usage-date snapshot grouped by the
five servers and the two boss types. The canonical definition lives in
`docs/contracts/team-view.md`.

## player-integration contracts

`player-integration.status` (`GET /api/v1/player-integration/status`) requires
the `server-operations` workspace. Switching requires the same workspace. The
switch request is `{ "mode": "local" |
"remote", "confirmation": "SWITCH PLAYER SERVER" }`; the server health-checks
the target endpoint before persisting the mode. Endpoint URLs and service
tokens are server configuration, never client input.

`player-integration.connection` (`POST /api/v1/player-integration/connection`)
persists the confirmed connection gate. Disabled status reads do not health-check
either endpoint, account synchronization fails locally, and team-view pauses
without remote retry. See `docs/contracts/player-integration.md`.

## auto-integration contracts

`auto-integration` is an HTTP-only adapter to the independent
`mxd-auto-process` project. The canonical remote contract is
`mxd-auto-process/backend-auto-process/contracts/operator-api-v1.yaml`; the main application never
reads auto's SQLite database or imports its Go packages. The adapter sends the
configured service token and forwards the authenticated main-application actor.
The main adapter contract, including its persisted connection gate, is defined
in `docs/contracts/auto-integration.md`.

The main application's `/api/v1/auto/*` routes provide:

| Operation | Main route | Auto route | Semantics |
| --- | --- | --- | --- |
| `auto-integration.status` | `GET /api/v1/auto/status` | `GET /api/v1/healthz` | Bounded endpoint health projection |
| `auto-integration.connection` | `POST /api/v1/auto/connection` | None | Persisted local traffic gate; enabling performs one health check |
| `auto-integration.overview` | `GET /api/v1/auto/overview` | `GET /api/v1/overview?include_logs=false` | Live server, account, and session projection |
| `auto-integration.setup-session` | `POST /api/v1/auto/servers/{serverId}/sessions`, `POST /api/v1/auto/sessions/{sessionId}/select-and-enter`, `DELETE /api/v1/auto/sessions/{sessionId}` | Same paths under `/api/v1` | Interactive login, server role selection/map entry, and temporary-session cleanup |
| `auto-integration.server-create/update/delete` | `/api/v1/auto/servers...` | `/api/v1/servers...` | Auto-owned server catalog CRUD |
| `auto-integration.account-list/create/update/delete` | `/api/v1/auto/servers/{serverId}/accounts...` | Same path | Auto-owned account CRUD; credentials are write-only; `md5` sends the supplied 16-character login value unchanged |
| `auto-integration.account-start/stop/reconnect` | `POST .../{accountId}/{action}` | Same path | Complete login/entry, disable-and-close, or reconnect |
| `auto-integration.account-message` | `POST .../{accountId}/message` | Same path | Backend-validated chat delivery through the account session |

`auto-integration.account-message` also adds an `auto_process` projection owned
by the main backend adapter: `{ "latency_ms": number, "status": "success" |
"failure" | "unknown" }`. Its latency covers the request from this project
to auto-process and the response back. Auto's `ChatResult` exposes
`game_server_response_latency_ms` and `game_server_status`, measured from the
auto chat write to the matching game-server response or the bounded timeout.
The frontend renders these measurements directly and does not infer them from
browser timing.

Auto defaults to `127.0.0.1:26909`, and the game-server UI does not expose a
remote endpoint mode. For separate hosts, set `MXD_AUTO_LOCAL_URL` and
`MXD_AUTO_SERVICE_TOKEN` explicitly and use a private network or HTTPS reverse
proxy. `POST start` and enabled account create/update are asynchronous: the
response may be `connecting`, and the overview is authoritative for the final
`online`, `offline`, or `failed` state. Enabled accounts are automatically
reconciled after disconnect; reconnect is also available as a manual action.
New account setup first creates a temporary authenticated session, renders its
returned `roles`, calls `select-and-enter` for the chosen role, and creates the
account with `session_id` only after the session reaches `ready`. This prevents
a second login and leaves no temporary session when the dialog is cancelled or
restarted.

## auto read-only and operator contracts

Auto's `/` page and the following API routes are non-mutating read-only
projections: `GET /api/v1/overview`, `GET /api/v1/logs`, and the two-second SSE
stream `GET /api/v1/events`. They expose no account password, service token,
server key, role opaque, or raw TCP payload. The overview includes the latest
bounded audit entries unless `include_logs=false` is requested.

The `/operator` page uses `POST /api/v1/operator/login`, `GET
/api/v1/operator/me`, `POST /api/v1/operator/password`, and `POST
/api/v1/operator/logout`. A new auto database creates `admin` using
`AUTO_INITIAL_PASSWORD` (default `ChangeMe-26909!`) and requires a password
change before control routes are enabled. Control routes accept the HttpOnly
`mxd_auto_operator` session cookie or the configured bearer service token;
operator password changes accept only the operator session.

## Portable data semantics

- null 表示明确无值；省略字段表示该字段不适用于该 operation；空字符串不作为缺省值。
- 除角色 ID 这一明确例外外，业务实体 ID 使用不透明字符串；角色 ID 必须是仅含 ASCII 数字 0-9 的字符串，且不得以 JSON number 传输。
- 数量使用十进制正整数，不使用浮点数；超出实现上限返回稳定错误。
- 列表使用游标分页，响应中的排序和下一页语义必须稳定。
- 提交支持幂等键；取消/完成的重复请求在同一终态下幂等，冲突终态返回稳定错误。

## Visibility rule

客服契约的 response schema 不定义 commands 字段。拥有 queue、ready、reissue 或 archive 工作区的账号读取对应管理契约时，统一返回管理投影；管理契约才定义生成后的指令数组。任何后端序列化器、缓存或日志都不得通过客服 own-record/reminder 接口泄露指令。

## Change rule

修改契约时按“更新 canonical definition -> 更新生产者和消费者 -> 更新契约测试 -> 检查兼容性”的顺序执行。破坏性变更必须新版本化，不能复用旧 Contract ID。

## Workspace permission rule

`auth` owns the stable workspace list and role defaults. Auth responses return a
complete boolean `workspacePermissions` map, while account-management requests
may carry partial overrides. Overrides may select any workspace independently of
the target role, and any account with the `accounts` workspace can maintain the
account directory and these assignments. Every consumer must treat the map as a
visibility/capability filter and still rely on backend `403` responses for
enforcement. In particular, `reissue` and `archive` are independent record
capabilities, and customer record projections never expose `commands`.

The role supplies only the initial default workspace set. Once a workspace is
assigned, customer, manager, and super_admin use the same page, projection,
commands, and business operations for that workspace. Account safety rules such
as protecting the last active super_admin remain owned by auth.
