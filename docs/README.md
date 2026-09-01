# 文档索引

项目文档统一放在本目录。根目录同时包含 `backend/`、`frontend/` 的运行时代码和 `data/` 原始资产。

## 项目治理

- PROJECT.md：项目身份、应用、模块、契约注册表和约束。
- INIT.md：初始化决策、当前范围和下一步顺序。
- ARCHITECTURE.md：系统边界、依赖方向和数据流。
- MODULE.md：模块清单的通用约定。
- CONTRACTS.md：稳定契约注册表和跨边界规则。
- DEVELOPMENT.md、PERFORMANCE.md、UI.md、REVIEW.md、MIGRATION.md：后续开发、性能、界面、评审和迁移规范。

## 能力与边界

- modules/auth.md：登录会话、三层权限和账号目录。
- modules/operation-groups.md：工单组生命周期与角色投影。
- modules/item-catalog.md：物品目录与 Excel 导入语义。
- modules/command-generation.md：指令模板和数量拆分。
- contracts/：前后端及模块公开契约。
- applications/：backend/frontend 的实现边界。
- data/item-catalog.md：原始物品表资产说明。
