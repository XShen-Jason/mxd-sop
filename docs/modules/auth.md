# auth

## Purpose

提供登录会话、三层角色身份、账号级工作区权限和受控账号目录。账号只能由拥有 `accounts` 工作区的已认证账号创建，不提供公开注册。

## Scope

In scope:

- 用户名/密码登录、退出和当前身份查询。
- `customer`（普通客服）、`manager`（管理）、`super_admin`（超级管理）三层角色。
- `accounts` 工作区持有者可创建、编辑、停用、启用和删除三类账号，并分别调整其工作区权限和上传权限。
- 启用/停用账号、编辑时修改密码和最小一名超级管理约束。
- 为每个账号保存独立的工作区权限和上传权限；角色只提供默认值，账号管理工作区持有者可逐项覆盖两类权限。

Out of scope:

- 生产身份提供商、单点登录和多因素认证（通过适配器替换）。
- 工单业务规则（由 operation-groups 负责）。

## Ownership and invariants

- 后端会话中的 userId 和 role 是授权唯一来源，客户端不能通过表单或查询参数声明角色。
- 工作区权限决定页面可见性、数据投影和对应业务操作；拥有同一工作区的三类角色行为一致。角色不再作为业务操作的第二层门槛。
- 上传权限独立于工作区可见性；后端上传入口必须同时检查对应工作区和上传权限，前端禁用状态不能代替后端授权。
- 不允许停用或降级系统中最后一名启用的超级管理。
- 密码只保存 scrypt 派生摘要，不保存明文；会话令牌有明确过期时间。

## Public surface

| Contract | 用途 |
| --- | --- |
| auth.login | 登录并取得会话令牌 |
| auth.logout | 使当前会话失效 |
| auth.me | 查询当前用户 |
| auth.list-users | 管理员查看账号目录 |
| auth.create-user | 按角色层级创建账号 |
| auth.update-user | 修改账号状态、角色、名称或密码 |
| auth.delete-user | 永久删除下级账号（保留停用能力） |

## Dependencies

- user repository：当前 MVP 为 `JsonUserRepository`，生产可替换为数据库/身份服务适配器。
- operation-groups：消费 `Identity`，不反向依赖认证存储细节。

## Data, configuration, and assets

生产环境使用 SQLite。首次启动必须提供 `INITIAL_ADMIN_PASSWORD`，且只创建一个 `super_admin`；不存在演示账号和公开注册。管理和客服账号由超管登录后创建。

## Tests

认证测试覆盖登录、禁止注册、工作区默认值与覆盖、账号管理工作区、停用账号和最后超级管理保护；跨模块测试覆盖会话身份驱动的工单授权。

## Migration notes

保持 `Identity` 的稳定角色值、完整 `workspacePermissions`、完整 `uploadPermissions` 和 auth contract 字段；替换 JSON 存储时只替换 repository/session adapter，不把密码或授权规则复制到前端。
## Production initialization

Production uses `SqliteUserRepository` and `SqliteSessionRepository`. The first
startup creates exactly one super admin from `INITIAL_ADMIN_*`; there are no
seeded demo accounts and no public registration. Sessions are stored as
SHA-256 token digests, while the browser receives only an HttpOnly cookie.

## Workspace permission ownership

Auth owns the stable workspace vocabulary, role defaults, and the effective
permission calculation. A stored user contains a partial or complete
`workspacePermissions` map; missing keys resolve from the user's role default.
Assignments are independent of the target account role, and the `accounts`
workspace controls who may maintain account records and assignments.

`Identity` carries the effective map into every backend module. Modules must
check the relevant workspace at their public entry point and must not infer
access from a frontend route or from a client-supplied role. Account-management
workspace holders are the write path for per-user workspace assignments.

Auth also owns the stable upload-permission vocabulary and role defaults. The
effective `uploadPermissions` map travels with `Identity`; upload-capable
modules combine it with their workspace check. The account-management UI edits
this map separately from workspace visibility.

The SQLite adapter stores the map as `users.workspace_permissions_json`. Startup
adds this nullable column when opening a database created by an older version,
copies the former `tab_permissions_json` values into it, and drops the former
column. JSON users receive the same one-time field migration. The former field
is accepted only at this persistence compatibility boundary and is never part of
the runtime or response model.

SQLite stores upload assignments in `users.upload_permissions_json`. A missing
value from an older account resolves from that account's role defaults and is
persisted when the account is next changed.
