# INIT.md

## Goal

在不预先锁定生产供应商的前提下，为客服工单、管理处理和历史归档建立可直接运行的本地最小实现。生产认证、数据库和部署仍保留替换边界。

## Initialization decisions

本次功能扩展采用 auth capability：三层角色、服务端会话和受控账号创建；公开注册保持关闭。operation-groups 的新状态流为 pending/approved/rejected/issued，旧 MVP 状态继续兼容读取。

1. 项目规模为 Standard：存在独立前端/后端边界，且有工单、目录、指令三个能力。
2. 保留 frontend、backend 应用实现目录，项目文档和契约正文统一放在 docs/；不创建 worker，因为当前没有异步任务要求。
3. 业务能力按责任划分为 auth、operation-groups、item-catalog、command-generation。
4. 后端是授权、校验、状态和指令的唯一权威；前端只负责交互和展示。
5. CSV 放在 data/item-catalog/source/，作为原始输入，不在前端复制一份。
6. 服务器、理由预设和操作类型使用可扩展的字符串配置；初始值记录在 docs/modules/operation-groups.md。
7. 指令规则、数量拆分和客服不可见规则写入稳定契约，后续实现必须以契约为准。

## Required project map

docs/PROJECT.md 已建立项目 ID、应用、模块、契约、性能预算、文件大小预算和后续命令。模块细节位于 docs/modules/，跨边界定义位于 docs/contracts/。

## Initialization checklist

- [x] 盘点并保留用户提供的物品表原文件。
- [x] 建立能力模块和应用边界。
- [x] 建立角色、状态、排序、数量拆分和数据语义。
- [x] 建立前后端契约索引及示例。
- [ ] 选择生产认证、数据库和部署方案（MVP 使用可替换适配器）。
- [x] 实现物品目录导入与模糊搜索。
- [x] 实现指令生成领域规则和测试。
- [x] 实现工单 API、角色投影和前端页面。

## Deliberate exception

认证扩展后，正常运行使用登录会话；请求头身份仅在 `NODE_ENV=test` 下保留为既有契约测试兼容路径。

MVP 使用 JSON 持久化和请求头身份适配器，以便在没有供应商决策时直接演示完整流程；这两者均位于后端边界，生产环境必须替换。

## Implementation order

1. 固化物品目录导入映射：CSV 的 item_id 为命令代码，按字符串保存；name 为显示名称，class 保留为目录属性，Id 仅作为源行标识。
2. 实现并测试 command-generation.generate，覆盖 1000、1001、2888、多个物品和非法数量。
3. 实现 operation-groups 的提交/取消/完成状态机和客服/管理两种投影。
4. 加入有界分页、角色授权、审计和持久化适配器。
5. 接入客服和管理界面，并用契约级测试验证“客服响应无指令”。
