# PROJECT.md

## Project identity

~~~text
Project ID: game-support-ops
Name: 游戏客服操作工单系统
Purpose and users: 客服提交玩家操作申请，管理审核、复制指令、完成并归档
Scale: Standard
Primary languages: TypeScript, SQLite (production persistence), JSON (legacy test adapter)
Applications: frontend, backend
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

认证、数据库和部署供应商尚未选择，均必须通过后端边界接入，不得进入领域规则。

## Module registry

The `auth` capability is implemented in `backend/src/modules/auth` and `frontend/src/App.tsx`.

The operation-groups workflow contracts now include update-group, approve-group, reject-group, issue-group, and list-overview; see the canonical contract for the pending/approved/rejected/issued state machine.

| Module ID | Capability | Implementation location(s) | Owner application(s) | Public contracts | Dependencies |
| --- | --- | --- | --- | --- | --- |
| auth | 登录会话、三层角色和受控账号目录 | backend/src/modules/auth; frontend/src/App.tsx; docs/modules/auth.md | backend + frontend | auth.login, auth.logout, auth.me, auth.list-users, auth.create-user, auth.update-user, auth.delete-user | user persistence/session adapter |
| operation-groups | 工单组提交、分组、角色视图、取消、完成和归档状态 | backend/src/modules/operation-groups; frontend/src/modules/operation-groups, frontend/src/modules/customer, frontend/src/modules/manager; manifest docs/modules/operation-groups.md | backend + frontend | operation-groups.list-options, operation-groups.submit-group, operation-groups.list-own, operation-groups.cancel-group, operation-groups.list-queue, operation-groups.complete-group, operation-groups.list-archive | item-catalog（提交时校验/快照）；身份适配器；持久化适配器 |
| item-catalog | 物品表导入、代码/名称映射、模糊搜索和分类读取 | backend/src/modules/item-catalog; manifest docs/modules/item-catalog.md; data/item-catalog/source | backend + frontend consumer | item-catalog.search, item-catalog.by-class | Excel 导入适配器；持久化适配器 |
| activities | 客服活动与奖励配置、申请表单快捷填充 | frontend/src/modules/activities; manifest docs/modules/activities.md | frontend | local activity storage | item-catalog.search/by-class；operation-groups form |
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
| operation-groups.complete-group | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理 |
| operation-groups.list-archive | HTTP API | docs/contracts/operation-groups.md | operation-groups | v1 | frontend 管理 |
| item-catalog.search | HTTP API | docs/contracts/item-catalog.md | item-catalog | v1 | frontend 客服/管理 |
| command-generation.generate | module interface | docs/contracts/command-generation.md | command-generation | v1 | backend operation-groups 管理投影 |

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
Production persistence is SQLite for both `auth` and `operation-groups`; JSON
repositories remain test-only adapters. Sessions use the SQLite session table,
and the production identity path does not accept demo headers.

The frontend `activities` capability provides a local activity/reward workspace
and shortcut selection in customer issuance requests; see `docs/modules/activities.md`.
