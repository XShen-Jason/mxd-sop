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

### 按 IP 的登录保护

- `/api/v1/auth/login` 与兼容地址 `/api/v1/login` 共用同一 IP 计数，不按账号分开。
- 任意滚动 5 分钟（300 秒）最多放行 10 次请求，第 11 次返回 `login-rate-limited`（429）。
  成功、密码错误和格式错误的请求均占额度；被限流/暂停拒绝的请求不追加额度，也不延长等待时间。
- 同一 IP 累计认证失败达到 5 次，第 5 次立即返回 `login-blocked`（429），
  暂停 20 分钟（1200 秒）。即使请求额度尚有剩余也锁定；错误跨请求窗口累计，
  期间正确密码也不能登录，换账号不能绕过。
  为避免暴露账号存在性，用户名不存在、停用账号和不合法凭据同样计入；
  JSON/请求结构错误与服务器内部错误不计认证失败次数。
- 成功登录只清零该 IP 的临时失败次数，不清除 5 分钟请求额度及持久累计次数。暂停到期清零临时失败次数，
  重新允许登录。暂停期间的请求不刷新暂停截止时间。已有登录会话不受影响。
- 429 返回 `{ error: { code, message, retryAfterSeconds } }`，`message` 为可展示的中文提示；
  `Retry-After` 响应头与 `retryAfterSeconds` 均为向上取整的剩余秒数。
- 独立的持久计数累计实际凭据验证失败；第 21 次（超过 20 次）立即永久封禁，返回
  `ip-permanently-banned`（403）和中文说明，不带 `Retry-After`。成功登录、临时锁定到期、
  进程重启和时间流逝均不清零总数。暂停/限流/永久封禁期间未验证密码的请求不增加总数。
  从安装该版本开始累计，不从旧访问日志推断历史次数。只有显式人工解封才能删除该计数。
- IPv6 访客直接返回 `ipv6-disabled`（403）；IPv4 映射地址归一为 IPv4 后正常处理。
  两类 403 在所有新后端业务请求的入口执行，已有 cookie 也不能绕过；已建立的 SSE 和已开始的
  操作不被强行中断。Nginx 另外拒绝两个站点的 IPv6 页面/静态资源请求。
  SOP 的永久封禁在后端执行，公共静态登录壳仍可下载，但不能访问任何业务 API。

IP 来自 Fastify 的可信客户端地址，仅信任直接相连的本机代理
（`127.0.0.1`、`::1` 或 IPv4 映射回环地址），只取该代理提供的最后一个
`X-Forwarded-For` 地址。直接外部连接的转发头不受信任。本项目单机部署的 Nginx 使用
`proxy_set_header X-Forwarded-For $remote_addr`，覆盖客户端传入的转发链。Cloudflare 橙云部署需在 Nginx
加载 `deploy/security/mxd-cloudflare-realip.conf`，只对官方网段来源的请求使用
`CF-Connecting-IP` 恢复 `$remote_addr`，然后只转发已验证的访客地址。
后端不直接信任客户端传入的 `CF-Connecting-IP`。安装和验证见
`docs/deployment/cloudflare-login-ip.md`；其他多层/异机代理需先调整明确的信任边界。
IPv4 及其 IPv6 映射形式归一后共用计数；真实 IPv6 直接拒绝，共享 IPv4 出口的用户共用额度。

临时限流仍保存在单进程内存，重启清零。最多跟踪 10,000 个 IP，
每个 IP 最多保留 10 个请求时间；每分钟按需清理无错误的过期窗口及已到期暂停。
未触发暂停的错误累计保留到成功登录或进程结束。容量满时，新 IP 返回 `login-capacity`（503）
及 `Retry-After: 60`，不会淘汰已有失败计数或暂停记录；已跟踪 IP 仍按各自状态处理。
扩展为多进程部署前必须将状态替换为共享且原子更新的存储。

永久计数存入 SOP 自己的 SQLite `auth_ip_failures(ip, failures)`，新表启动时幂等创建，
最多 100,000 个地址，计数饱和在 21；不淘汰封禁。容量满时新地址失败返回
`ip-protection-capacity`（503），已记录地址继续正常累加；正确凭据仍能登录。
每次请求做主键查询，失败在单个立即事务中预留容量并递增，存储异常拒绝请求，不降级放行。
auto 实现同样规则，但使用其独立数据库，两个服务的失败次数不合并。
人工查看/解封及部署步骤见 `docs/deployment/LOGIN-IP-PROTECTION.md`。

## auth.login-audit

登录尝试的库外操作记录，覆盖两个登录别名，每个到达 SOP 且完成响应的 POST 请求最多写
一条 JSON 行。记录用户实际提交的账号，而非根据登录成功后身份反查；失败和不存在账号
同样记录。该值是访客声明，不能当作已验证身份或账号存在的证据。

```json
{"event":"auth.login.attempt","time":"2026-11-16T12:00:00.000Z","requestId":"req-1","ip":"192.0.2.10","route":"/api/v1/auth/login","username":"Entered.Account","usernameState":"provided","status":401,"result":"invalid-credentials"}
```

`time` 是响应完成时的 UTC 时间；`ip` 使用与登录保护相同的可信来源并归一。
`username` 保留大小写、空格及原始拼写，最多 128 个 UTF-16 单元，超过则明确标记
`usernameState=truncated`。字符串正常为 `provided`；缺字段为 `missing`；非字符串为
`invalid-type`；正文未解析/无可用对象时为 `body-unavailable`，后三者 `username=null`。
不把对象序列化成账号，不记录密码、Cookie、Authorization、请求/响应正文或 URL 查询参数。
JSON 转义换行及 Unicode 行分隔符，输入不能伪造额外日志行。

`result` 按响应状态分为 `success`、`invalid-credentials`、`invalid-request`、`blocked`、
`limited`、`unavailable`、`failed`。第 5 次错误触发的 429 仍有已解析账号；之后在请求头
阶段被暂停/封禁/限流的请求不继续读取正文，只记录 IP、结果和 `username=null`。
Nginx 直接拦截的请求没有到达 SOP，只会出现在 Nginx 安全日志中，无法取得提交账号。

生产默认写在数据库所在目录的 `login-attempts.log`，权限 0600，当前文件与 4 份轮转归档
各最多 5 MiB（总计最多 25 MiB，单进程使用）。重启继续追加；不会迁移旧请求或回填历史账号。
这是尽力而为的操作证据，文件写入失败不改变认证结果，每分钟最多输出一次不含敏感数据的
`auth.login.audit_error` 诊断。认证事务、失败累计和文件日志不组成原子提交。
查看和边界说明见 `docs/deployment/SOP-LOGIN-AUDIT.md`。

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

Production and ordinary development never accept demo identity headers, including
when JSON persistence is explicitly selected. Legacy demo identities exist only
when `NODE_ENV=test`; a production route without an auth adapter rejects the
request. Internal `auto-process` audit identities do not create password-login
users or browser sessions.

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
