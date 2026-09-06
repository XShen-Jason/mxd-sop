# PROJECT.md

## Project identity

~~~text
Project ID: game-support-ops
Name: 游戏客服操作工单系统
Purpose and users: 客服提交玩家操作申请，管理审核、复制指令、完成并归档
Scale: Standard
Primary languages: TypeScript, SQLite (production persistence), JSON (legacy test adapter)
Applications: frontend, backend, mxd-player/frontend-player, mxd-player/backend-player
Current roles: customer (普通客服), manager (管理), super_admin (超级管理)
Roles: customer（客服 A）, manager（管理 B）
~~~

本项目的稳定 ID 不随前端框架、后端框架或数据库迁移改变。当前提供可运行的本地 MVP；认证和生产数据库仍通过适配器保留替换边界。

## Application registry

Authentication uses three roles: `customer` (普通客服), `manager` (管理), and `super_admin` (超级管理). Public registration is disabled; see `docs/contracts/auth.md`.

| Application | Responsibility | Language/framework | Entry point | Commands |
| --- | --- | --- | --- | --- |
| frontend | 客服/管理界面、角色视图、搜索与复制交互；不生成指令 | TypeScript + React + Vite | frontend/src/main.tsx | `npm run dev --workspace frontend` |
| backend | 授权、持久化、目录查询、工单生命周期、指令生成 | TypeScript + Fastify | backend/src/server.ts | `npm run dev --workspace backend` |
| mxd-player/frontend-player | 玩家验证、组队创建/加入界面 | TypeScript + React + Vite | mxd-player/frontend-player/src/main.tsx | `cd mxd-player/frontend-player; npm run dev` |
| mxd-player/backend-player | 玩家验证、队伍规则与 SQLite 持久化 | Go + SQLite | mxd-player/backend-player/cmd/mxd-player/main.go | `cd mxd-player/backend-player; go run ./cmd/mxd-player` |

认证、数据库和部署供应商尚未选择，均必须通过后端边界接入，不得进入领域规则。

## Module registry

`player-registration` is the public player raid-registration capability. It is
implemented independently under `mxd-player/frontend-player` and
`mxd-player/backend-player` so player traffic and its database do not share the
operations desk process.

| Module ID | Capability | Implementation location(s) | Owner application(s) | Public contracts | Dependencies |
| --- | --- | --- | --- | --- | --- |
| player-registration | 玩家身份验证、角色选择、黑龙/扎昆组队与邀请码加入 | mxd-player/backend-player; mxd-player/frontend-player | player backend + player frontend | player.verify, player.me, player.teams, player.teams.join | SQLite WAL adapter |

The `auth` capability is implemented in `backend/src/modules/auth` and `frontend/src/App.tsx`.

The operation-groups workflow contracts now include update-group, approve-group, reject-group, issue-group, list-reviews, and list-overview; see the canonical contract for the pending/approved/rejected/issued state machine.

| Module ID | Capability | Implementation location(s) | Owner application(s) | Public contracts | Dependencies |
| --- | --- | --- | --- | --- | --- |
| auth | 登录会话、三层角色和受控账号目录 | backend/src/modules/auth; frontend/src/App.tsx; docs/modules/auth.md | backend + frontend | auth.login, auth.logout, auth.me, auth.list-users, auth.create-user, auth.update-user, auth.delete-user | user persistence/session adapter |
| operation-groups | 工单组提交、分组、角色视图、取消、完成和归档状态 | backend/src/modules/operation-groups; frontend/src/modules/operation-groups, frontend/src/modules/customer, frontend/src/modules/manager; manifest docs/modules/operation-groups.md | backend + frontend | operation-groups.list-options, operation-groups.submit-group, operation-groups.list-own, operation-groups.update-group, operation-groups.cancel-group, operation-groups.list-queue, operation-groups.list-reviews, operation-groups.complete-group, operation-groups.list-archive, operation-groups.remind-customer, operation-groups.list-reminders, operation-groups.workspace-counts, operation-groups.events | item-catalog（提交时校验/快照）；身份适配器；持久化适配器 |
| item-catalog | 物品表导入、代码/名称映射、模糊搜索和分类读取 | backend/src/modules/item-catalog; manifest docs/modules/item-catalog.md; data/item-catalog/source | backend + frontend consumer | item-catalog.search, item-catalog.by-class | CSV 导入适配器；持久化适配器 |
| activities | 客服活动与奖励配置、申请表单快捷填充 | backend/src/modules/activities; frontend/src/modules/activities; manifest docs/modules/activities.md | backend + frontend | activities.list, activities.replace | SQLite/JSON activity repository；item-catalog.search/by-class；operation-groups form |
| command-generation | 根据已校验操作生成可执行指令并按上限拆分 | backend/src/modules/command-generation; manifest docs/modules/command-generation.md | backend | command-generation.generate | 无外部业务依赖；接收 operation-groups 的不可变快照 |

模块说明的完整内容见 docs/modules/；前端只消费契约，不导入后端内部文件。

operation-groups 当前还拥有 `update-group`、`approve-group`、`reject-group`、`issue-group`、`list-overview` 契约；其完整字段和状态规则只维护在 `docs/contracts/operation-groups.md`。

## Contract registry

Auth contracts are defined in `docs/contracts/auth.md`: `auth.login`, `auth.logout`, `auth.me`, `auth.list-users`, `auth.create-user`, `auth.update-user`, and `auth.delete-user`.

| Contract ID | Kind/API/event | Canonical definition | Owner | Version | Consumers |
| --- | --- | --- | --- | --- | --- |
| auth.login | HTTP API | docs/contracts/auth.md | auth | v1 | frontend |
| auth.logout | HTTP API | docs/contracts/auth.md | auth | v1 | frontend |
| auth.me | HTTP API | docs/contracts/auth.md | auth | v1 | frontend |
| auth.list-users | HTTP API | docs/contracts/auth.md | auth | v1 | frontend 管理/超级管理 |
| auth.create-user | HTTP API | docs/contracts/auth.md | auth | v1 | frontend 管理/超级管理 |
| auth.update-user | HTTP API | docs/contracts/auth.md | auth | v1 | frontend 管理/超级管理 |
| auth.delete-user | HTTP API | docs/contracts/auth.md | auth | v1 | frontend 管理/超级管理 |
| operation-groups.update-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 客服 |
| operation-groups.approve-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理/超级管理 |
| operation-groups.reject-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理/超级管理 |
| operation-groups.issue-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 超级管理 |
| operation-groups.list-overview | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | backend compatibility |
| operation-groups.list-options | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 客服/管理 |
| operation-groups.submit-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 客服 |
| operation-groups.list-own | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 客服 |
| operation-groups.cancel-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 客服 |
| operation-groups.list-queue | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理 |
| operation-groups.list-reviews | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend manager/super_admin |
| operation-groups.complete-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理 |
| operation-groups.list-archive | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理 |
| item-catalog.search | HTTP API | docs/contracts/item-catalog.md | item-catalog | v1 | frontend 客服/管理 |
| activities.list | HTTP API | docs/contracts/activities.md | activities | v1 | frontend all roles |
| activities.replace | HTTP API | docs/contracts/activities.md | activities | v1 | frontend manager/super_admin |
| team-view.read | HTTP API | docs/contracts/team-view.md | team-view | v1 | frontend all authenticated roles |
| player-integration.status | HTTP API | docs/contracts/player-integration.md | player-integration | v1 | frontend super_admin |
| player-integration.switch | HTTP API | docs/contracts/player-integration.md | player-integration | v1 | frontend super_admin |
| command-generation.generate | module interface | docs/contracts/command-generation.md | command-generation | v1 | backend operation-groups 管理投影 |
| operation-groups.remind-customer | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend |
| operation-groups.list-reminders | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend |
| operation-groups.workspace-counts | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend |
| operation-groups.events | SSE event stream | docs/contracts/operation-groups.md | operation-groups | v1 | frontend |

## Project constraints

认证约束：正常运行必须先通过 auth.login 取得会话；固定演示请求头只在测试环境兼容，不构成生产授权方式。

~~~text
Backend performance target or budget:
  - 列表和目录搜索使用有界查询；目标 p95 <= 300 ms（不含网络和外部认证）。
  - 单次工单组初始最多 100 个 operation；物品搜索初始最多返回 50 条。
  - 管理队列使用游标分页，禁止无界拉取或轮询；生成指令为有界同步工作。
Maximum application-source file size: 300 physical lines; 301-400 requires a recorded exception; >400 must split.
Required data, security, or deployment constraints:
  - 所有 ID 使用不透明字符串；时间使用 UTC RFC 3339。
  - item_id/物品代码按字符串保存，必须保留前导零。
  - v1 的 characterId/角色 ID 使用仅含 ASCII 数字 0-9 的字符串传输和存储，不使用 JSON number；服务器例外必须显式配置并版本化。
  - 参与指令的角色 ID 和物品代码不得含空白或 @ 分隔符。
  - 后端执行角色授权；客服响应中不得出现 commands 字段或指令文本。
  - 工单提交保存物品名称/代码快照，避免目录变更改写历史指令。
  - 终态工单保留审计信息；归档查询包含所有状态。
Known project-specific exceptions:
  - 测试环境保留 JSON 持久化和请求头身份适配器；生产环境使用 SQLite、HttpOnly session cookie，并关闭请求头身份回退。
  - 原始 Excel 存在 13 行空名称或重复代码，MVP 导入时跳过并输出警告；严格导入模式仍会拒绝这些数据。
  - 认证提供商和生产部署待下一阶段决策，不能被领域模块内部假定。
~~~

## Commands

~~~text
Start: `npm run dev`（或分别运行两个 workspace 命令）
Test: `npm test`（后端领域/目录测试）
Lint/format: `npm run lint`
Build: `npm run build`
Migration or release: 未配置
File-size/quality check: `Get-ChildItem backend/src,frontend/src -Recurse -File | % { ... }`；按 AGENTS.md 复核
~~~

## Update rule

新增应用、模块、契约、依赖或性能约束时先更新本表，再更新对应模块/契约文档。模块和契约的详细规则只保留一份。
Production persistence is SQLite for `auth`, `operation-groups`, and
`activities`; JSON
repositories remain test-only adapters. Sessions use the SQLite session table,
and the production identity path does not accept demo headers.

The `activities` capability provides a shared activity/reward workspace and
shortcut selection in customer issuance requests; see `docs/modules/activities.md`.

The `player-directory` capability is owned by `backend/src/modules/player-directory`
and `frontend/src/modules/player-directory`. It exposes
`player-directory.search` to all authenticated roles and
`player-directory.import` to `super_admin`; its own CSV snapshot lives under
the operations database and synchronizes through the active `mxd-player`
internal HTTP contract; it never reads the player database directly.

| Module ID | Capability | Implementation location(s) | Owner application(s) | Public contracts | Dependencies |
| --- | --- | --- | --- | --- | --- |
| player-directory | player account and QQ lookup with super-admin CSV replacement | backend/src/modules/player-directory; frontend/src/modules/player-directory | backend + frontend | player-directory.search, player-directory.import | SQLite/JSON directory repository; auth identity |

| team-view | daily locked-team snapshot and read-only server/type workspace | backend/src/modules/team-view; frontend/src/modules/team-view; docs/modules/team-view.md | backend + frontend | team-view.read | mxd-player snapshot source adapter; SQLite/JSON snapshot repository; auth identity |
| player-integration | active local/remote player endpoint, transactional account sync, and locked-team source selection | backend/src/modules/player-integration; frontend/src/modules/player-integration | backend + frontend | player-integration.status, player-integration.switch | mxd-player internal HTTP contracts; SQLite state; service token |
