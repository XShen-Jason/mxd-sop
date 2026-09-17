# backend

## Responsibility

后端同时提供 auth 模块的登录会话、角色身份和账号级工作区授权：账号只有在拥有对应工作区时才能提交申请、读取页面或编辑/取消仍处于可操作窗口的记录。角色只提供默认工作区；拥有同一工作区的 customer、manager、super_admin 使用相同的读取和业务操作，账号安全保护仍由 auth 负责。

后端是本项目的唯一业务权威，负责认证上下文、角色授权、输入校验、工单与活动配置持久化、物品目录导入/查询、指令生成和状态审计。实现代码按能力放入 `backend/src/modules/{module-id}/`，模块外只暴露 docs/contracts/ 中登记的接口。

## Boundary rules

- 拥有 `request`/`records` 工作区的已认证角色可访问自己的 submit/list-own/update/cancel 能力（角色权限向下兼容）；物资仅 pending 可编辑/取消，常规操作仅 approved（待完成）可编辑/取消，且响应不得有 commands。
- 工作区权限控制 queue/ready/reissue/archive/overview 等读取边界；拥有对应工作区的任意角色获得统一管理投影和 commands。approve/reject 仍要求 manager/super_admin，complete 仍要求管理角色，issue 和提醒仍仅 super_admin。活动配置替换仅 manager/super_admin，读取需要 `activities` 或 `request` 工作区。账号删除通过 auth.delete-user 执行，并受当前账号与最后超管保护。
- 前端不能直接读数据库、Excel 或后端内部模块。
- 数据库、认证 SDK 和文件读取都通过可替换 adapter 接入。

## Stack

使用 TypeScript + Fastify；MVP 通过 `JsonGroupRepository`、`JsonUserRepository` 和内存会话适配器运行，生产替换不进入领域模块。固定请求头仅保留旧契约测试兼容。

## Implementation slice

command-generation.generate、item-catalog 导入/搜索和 operation-groups 状态机已由 HTTP 层串联，测试与启动命令见 docs/PROJECT.md。

## Workspace authorization

The backend treats each workspace as an independent capability. Auth resolves
the effective `workspacePermissions` map from the persisted user on every
request, and domain services enforce it before reading or mutating data.
This covers every backend-backed workspace: request, own records, reminders,
review queue, ready work, material records, regular-operation records,
activities, player directory, teams, accounts, and the player-integration
contracts used by the server-operations workspace. The backend module keeps
the player-specific API boundary while the frontend exposes it through the
server-operations entry point.

The archive query uses `kind=issuance` for the material record tab and
`kind=regular` for the regular-operation record tab. A request containing only
`status=approved` is the ready workspace. Any caller with the matching tab
receives the manager projection, including generated commands; own-record and
reminder endpoints remain customer projections. A disabled tab returns `403
forbidden` even when a caller reaches the endpoint directly.

Account-management requests may include partial `workspacePermissions` updates
when the caller has the `accounts` workspace. The server merges them into a
complete map and starts a role change from the new role's defaults. A permission
change is reflected by subsequent session identity resolution without exposing
persistence details to the frontend. No role-specific business-action gate is
applied after a workspace is assigned.
