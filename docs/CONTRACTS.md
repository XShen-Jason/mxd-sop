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
| auth.list-users | auth | v1 | manager/super_admin | contracts/auth.md |
| auth.create-user | auth | v1 | manager/super_admin | contracts/auth.md |
| auth.update-user | auth | v1 | manager/super_admin | contracts/auth.md |
| operation-groups.update-group | operation-groups | v1 | frontend customer | contracts/operation-groups.md |
| operation-groups.approve-group | operation-groups | v1 | manager/super_admin | contracts/operation-groups.md |
| operation-groups.reject-group | operation-groups | v1 | manager/super_admin | contracts/operation-groups.md |
| operation-groups.issue-group | operation-groups | v1 | super_admin | contracts/operation-groups.md |
| operation-groups.list-overview | operation-groups | v1 | manager/super_admin | contracts/operation-groups.md |
| operation-groups.list-options | operation-groups | v1 | frontend 客服/管理 | contracts/operation-groups.md |
| operation-groups.submit-group | operation-groups | v1 | frontend 客服 | contracts/operation-groups.md |
| operation-groups.list-own | operation-groups | v1 | frontend 客服 | contracts/operation-groups.md |
| operation-groups.cancel-group | operation-groups | v1 | frontend 客服 | contracts/operation-groups.md |
| operation-groups.list-queue | operation-groups | v1 | frontend 管理 | contracts/operation-groups.md |
| operation-groups.list-reviews | operation-groups | v1 | frontend manager/super_admin | contracts/operation-groups.md |
| operation-groups.complete-group | operation-groups | v1 | frontend 管理 | contracts/operation-groups.md |
| operation-groups.list-archive | operation-groups | v1 | frontend 管理 | contracts/operation-groups.md |
| item-catalog.search | item-catalog | v1 | frontend 客服/管理 | contracts/item-catalog.md |
| item-catalog.by-class | item-catalog | v1 | frontend 管理活动配置 | contracts/item-catalog.md |
| command-generation.generate | command-generation | v1 | backend manager projection | contracts/command-generation.md |
| activities.list | activities | v1 | frontend all roles | contracts/activities.md |
| activities.replace | activities | v1 | frontend manager/super_admin | contracts/activities.md |
| team-view.read | team-view | v1 | frontend all authenticated roles | contracts/team-view.md |
| team-view.import-clears | team-view | v1 | frontend super_admin | contracts/team-view.md |

| operation-groups.remind-customer | operation-groups | v1 | frontend super_admin | contracts/operation-groups.md |
| operation-groups.list-reminders | operation-groups | v1 | frontend all roles | contracts/operation-groups.md |
| operation-groups.workspace-counts | operation-groups | v1 | frontend | contracts/operation-groups.md |
| operation-groups.events | operation-groups | v1 | frontend | contracts/operation-groups.md |

## player-directory contracts

`player-directory.search` (`GET /api/v1/player-directory/search`) is available
to all authenticated roles and returns bounded, grouped account results with
opaque cursor pagination. `player-directory.import`
(`POST /api/v1/player-directory/import`) is restricted to `super_admin`,
accepts one server-selected validated CSV, and replaces only that server's
rows.
The canonical request and response definitions live in
`docs/contracts/player-directory.md`.

## team-view contracts

`team-view.read` (`GET /api/v1/team-view`) is available to all authenticated
roles and returns a bounded projection of the usage-date snapshot grouped by
the five servers and the two boss types. The canonical definition lives in
`docs/contracts/team-view.md`.

## player-integration contracts

`player-integration.status` (`GET /api/v1/player-integration/status`) and
`player-integration.switch` (`POST /api/v1/player-integration/switch`) are
super-admin-only controls. The switch request is `{ "mode": "local" | "remote",
"confirmation": "SWITCH PLAYER SERVER" }`; the server health-checks the target
endpoint before persisting the mode. Endpoint URLs and service tokens are
server configuration, never client input.

## Portable data semantics

- null 表示明确无值；省略字段表示该字段不适用于该 operation；空字符串不作为缺省值。
- 除角色 ID 这一明确例外外，业务实体 ID 使用不透明字符串；角色 ID 必须是仅含 ASCII 数字 0-9 的字符串，且不得以 JSON number 传输。
- 数量使用十进制正整数，不使用浮点数；超出实现上限返回稳定错误。
- 列表使用游标分页，响应中的排序和下一页语义必须稳定。
- 提交支持幂等键；取消/完成的重复请求在同一终态下幂等，冲突终态返回稳定错误。

## Visibility rule

客服契约的 response schema 不定义 commands 字段。管理契约才定义生成后的指令数组。任何后端序列化器、缓存或日志都不得通过客服接口泄露指令。

## Change rule

修改契约时按“更新 canonical definition -> 更新生产者和消费者 -> 更新契约测试 -> 检查兼容性”的顺序执行。破坏性变更必须新版本化，不能复用旧 Contract ID。
