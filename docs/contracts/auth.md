# auth

认证相关 Contract ID 的 canonical definition。所有接口使用 `/api/v1/auth` 前缀，认证上下文通过 Bearer 令牌（或同源 session cookie）传递。

## Common model

```json
{
  "id": "opaque-user-id",
  "username": "agent01",
  "displayName": "客服一号",
  "role": "customer",
  "active": true,
  "createdAt": "2026-08-31T10:00:00Z",
  "workspacePermissions": {
    "request": true,
    "records": true,
    "reminders": true,
    "queue": false,
    "ready": false,
    "reissue": false,
    "archive": false,
    "activities": false,
    "player-directory": true,
    "team-view": true,
    "accounts": false,
    "server-operations": false
  },
  "uploadPermissions": {
    "player-directory": true,
    "team-view": true,
    "item-catalog": false
  }
}
```

角色值为 `customer`、`manager`、`super_admin`。响应永远不包含 password 或 passwordHash。

## auth.login

`POST /api/v1/auth/login`

请求体：`{ "username": "...", "password": "..." }`。账号必须由管理员预先创建；不存在注册接口。生产环境成功返回 `{ expiresAt, user }` 并设置同源 HttpOnly、SameSite=Strict cookie；仅测试环境保留 `token` 字段。失败返回 `unauthorized`（401），不区分用户名不存在或密码错误。

## auth.logout

`POST /api/v1/auth/logout`。使当前令牌失效，成功返回 204。重复调用幂等。

## auth.me

`GET /api/v1/auth/me`。需要有效会话，返回当前用户安全摘要。

## auth.list-users

`GET /api/v1/auth/users`。需要有效会话和 `accounts` 工作区权限，返回有界账号列表。拥有该工作区的任意角色都能读取完整账号摘要。`limit` 只限制单次响应，不限制系统账号总量。

## auth.create-user

`POST /api/v1/auth/users`

请求体：`{ username, password, displayName, role, workspacePermissions?, uploadPermissions? }`。调用者必须具备 `accounts` 工作区；任意拥有该工作区的角色都可创建三类账号并为目标账号选择任意工作区和上传权限。用户名必须为 3-64 位 ASCII 标识，密码为 6-128 位。重复用户名返回 `username-taken`（409）。

## auth.update-user

`PATCH /api/v1/auth/users/{userId}`。调用者必须具备 `accounts` 工作区。可修改 `password`、`displayName`、`role`、`active`、`workspacePermissions`、`uploadPermissions`；工作区和上传权限覆盖均不受目标角色默认值限制。停用/降级最后一名启用超级管理返回 `last-super-admin`（409）。

## auth.delete-user

`POST /api/v1/auth/users/{userId}/delete`。由上级永久删除下级账号；不能删除当前登录账号，也不能删除系统中最后一名启用的超级管理。停用账号仍使用 `PATCH` 的 `active: false`，便于保留账号审计记录。密码只保存不可逆摘要，只能在编辑账号时提交新密码，不能读取明文密码。

## Security and compatibility

工单接口只消费后端解析出的 `Identity`，不接受请求体中的角色字段。当前 MVP 的固定演示请求头仅为旧契约测试兼容入口，生产应关闭并使用真实认证适配器。新增用户字段向后兼容；改变角色语义需新版本。
## Production cookie response

In production, login sets an HttpOnly, SameSite=Strict cookie and returns only
`expiresAt` and `user`. A bearer token is not exposed to browser JavaScript;
the legacy token response is retained only for contract tests.

## Workspace permissions

`UserSummary` and `auth.me` include a complete `workspacePermissions` object. Its
keys are the stable workspace IDs:

```text
request, records, reminders, queue, ready, reissue, archive, activities,
player-directory, team-view, accounts, server-operations
```

Each value is an independent boolean. The role supplies the initial default map;
an account-management workspace holder may assign any workspace to an account,
regardless of the account's role. Once assigned, the workspace supplies the
page, projection, commands, and business operations for every role.

| Role | Default enabled workspaces |
| --- | --- |
| customer | request, records, reminders, player-directory, team-view |
| manager | request, records, reminders, queue, reissue, archive, activities, player-directory, team-view, accounts |
| super_admin | all workspaces |

`auth.create-user` and `auth.update-user` accept an optional partial
`workspacePermissions` object when the caller has the `accounts` workspace. The
server merges partial input with the target's effective map and returns the
complete map without dropping workspaces outside the role's defaults. Changing
a role starts from that role's defaults unless the caller sends an explicit map.
The account-management UI's reset action sends the role default map explicitly.

The frontend uses the returned map to filter navigation and reject disabled
direct routes. The backend applies the same check at every capability entry
point, so hiding a tab is not the security boundary.

Accounts with the relevant workspace may read and operate on the management
operation-group endpoints regardless of role. `queue`, `ready`, `reissue`, and
`archive` all return the same manager projection, including `commands`, so a
customer who is explicitly granted one of those workspaces sees and uses the
same record shape and actions as a manager or super admin. Own-record,
reminder, submit, update, and cancel endpoints continue to return the customer
projection without `commands`.

## Upload permissions

`UserSummary`、登录响应和 `auth.me` 都包含完整的 `uploadPermissions`：

```text
player-directory, team-view, item-catalog
```

每个值都是独立布尔值，不从当前工作区勾选状态推导。上传玩家目录需要
`player-directory` 工作区和同名上传权限；上传通关列表需要 `team-view`
工作区和同名上传权限；替换道具目录需要 `activities` 工作区和
`item-catalog` 上传权限。缺少任一项时后端返回 `forbidden`（403），前端保持
上传控件可见但禁用。

`auth.create-user` 和 `auth.update-user` 接受可选的部分
`uploadPermissions`，并始终返回完整映射。角色默认值只用于新账号、角色变化
或旧账号尚未保存上传权限时的兼容补全：`customer` 默认启用玩家目录和通关
列表上传，`manager` 与 `super_admin` 默认启用全部三项。账号管理页面可逐项
覆盖，也可独立恢复角色默认上传权限。

## Migration compatibility

The HTTP, JSON, and SQLite adapters accept the former `tabPermissions` field
only while migrating existing clients and data. It is translated to
`workspacePermissions`, persisted under the new name, and never returned in
responses. The old SQLite column is dropped after its values are copied.
