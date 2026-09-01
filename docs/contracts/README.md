# Contracts

这里保存跨应用和模块公开边界的 canonical definition。文件名按 owning module 组织，Contract ID 和版本写在每个文件的开头。

- operation-groups.md：选项、提交、客服自有列表、取消、管理队列、完成和归档。
- auth.md：登录、会话和受控账号管理。
- item-catalog.md：物品模糊搜索。
- command-generation.md：后端内部的确定性指令生成接口。

前端类型、OpenAPI 文档和 SDK（未来生成）只能由这些定义派生；不要手工维护第二份字段或业务规则。
