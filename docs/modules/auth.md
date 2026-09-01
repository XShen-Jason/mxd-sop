# auth

## Purpose

提供登录会话、三层角色授权和受控账号目录。账号只能由已有管理角色创建，不提供公开注册。

## Scope

In scope:

- 用户名/密码登录、退出和当前身份查询。
- `customer`（普通客服）、`manager`（管理）、`super_admin`（超级管理）三层角色。
- 普通管理创建管理/客服；超级管理创建三类账号并调整角色。
- 启用/停用账号、编辑时修改密码和最小一名超级管理约束。

Out of scope:

- 生产身份提供商、单点登录和多因素认证（通过适配器替换）。
- 工单业务规则（由 operation-groups 负责）。

## Ownership and invariants

- 后端会话中的 userId 和 role 是授权唯一来源，客户端不能通过表单或查询参数声明角色。
- 权限按层级向下兼容：超级管理可执行管理和客服能力，管理可执行客服能力。
- 普通管理可以创建/维护管理和普通客服；超级管理可以创建和维护全部角色。
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

认证测试覆盖登录、禁止注册、角色层级创建、停用账号和最后超级管理保护；跨模块测试覆盖会话身份驱动的工单授权。

## Migration notes

保持 `Identity` 的稳定角色值和 auth contract 字段；替换 JSON 存储时只替换 repository/session adapter，不把密码或角色规则复制到前端。
## Production initialization

Production uses `SqliteUserRepository` and `SqliteSessionRepository`. The first
startup creates exactly one super admin from `INITIAL_ADMIN_*`; there are no
seeded demo accounts and no public registration. Sessions are stored as
SHA-256 token digests, while the browser receives only an HttpOnly cookie.
