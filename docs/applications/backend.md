# backend

## Responsibility

后端同时提供 auth 模块的登录会话和账号层级授权：所有已认证角色可提交自己的申请，并可编辑/取消仍处于可操作窗口的记录；manager 可审核物资、完成常规操作和管理客服，super_admin 还可确认发放物资并维护全部账号。

后端是本项目的唯一业务权威，负责认证上下文、角色授权、输入校验、工单持久化、物品目录导入/查询、指令生成和状态审计。实现代码按能力放入 `backend/src/modules/{module-id}/`，模块外只暴露 docs/contracts/ 中登记的接口。

## Boundary rules

- 所有已认证角色可访问自己的 own/submit/update/cancel 能力（权限向下兼容）；物资仅 pending 可编辑/取消，常规操作仅 approved（待完成）可编辑/取消，且响应不得有 commands。
- manager/super_admin 才能读取 queue/archive/overview、看到 commands 和审批；issue 仅 super_admin。账号删除通过 auth.delete-user 执行，并受当前账号与最后超管保护。
- 前端不能直接读数据库、Excel 或后端内部模块。
- 数据库、认证 SDK 和文件读取都通过可替换 adapter 接入。

## Stack

使用 TypeScript + Fastify；MVP 通过 `JsonGroupRepository`、`JsonUserRepository` 和内存会话适配器运行，生产替换不进入领域模块。固定请求头仅保留旧契约测试兼容。

## Implementation slice

command-generation.generate、item-catalog 导入/搜索和 operation-groups 状态机已由 HTTP 层串联，测试与启动命令见 docs/PROJECT.md。
