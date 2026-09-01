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
  "createdAt": "2026-08-31T10:00:00Z"
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

`GET /api/v1/auth/users`。需要 `manager` 或 `super_admin`，返回有界账号列表。`limit` 只限制单次响应，不限制系统账号总量。普通管理可看到和维护管理、客服账号；超级管理可维护全部角色。

## auth.create-user

`POST /api/v1/auth/users`

请求体：`{ username, password, displayName, role }`。普通管理可创建 `customer` 或 `manager`；超级管理可创建三类账号。用户名必须为 3-64 位 ASCII 标识，密码为 6-128 位。重复用户名返回 `username-taken`（409）。

## auth.update-user

`PATCH /api/v1/auth/users/{userId}`。可修改 `password`、`displayName`、`role`、`active`。角色变更仅超级管理可做；停用/降级最后一名启用超级管理返回 `last-super-admin`（409）。

## auth.delete-user

`POST /api/v1/auth/users/{userId}/delete`。由上级永久删除下级账号；不能删除当前登录账号，也不能删除系统中最后一名启用的超级管理。停用账号仍使用 `PATCH` 的 `active: false`，便于保留账号审计记录。密码只保存不可逆摘要，只能在编辑账号时提交新密码，不能读取明文密码。

## Security and compatibility

工单接口只消费后端解析出的 `Identity`，不接受请求体中的角色字段。当前 MVP 的固定演示请求头仅为旧契约测试兼容入口，生产应关闭并使用真实认证适配器。新增用户字段向后兼容；改变角色语义需新版本。
## Production cookie response

In production, login sets an HttpOnly, SameSite=Strict cookie and returns only
`expiresAt` and `user`. A bearer token is not exposed to browser JavaScript;
the legacy token response is retained only for contract tests.
