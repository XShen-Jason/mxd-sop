# ARCHITECTURE.md

## Goal

当前身份模型为三层：customer（普通客服）、manager（管理）、super_admin（超级管理）。公开注册关闭，认证适配器向业务模块提供已验证 Identity。

以能力为中心组织游戏客服操作工单系统，使前端、后端、物品目录和指令规则可以独立替换而不改变稳定 ID 或可观察行为。

## System boundaries

~~~text
客服浏览器（A） ─┐
                  ├─ versioned contracts ─> backend
管理浏览器（B） ─┘                         ├─ operation-groups
                                            ├─ item-catalog
                                            ├─ command-generation
                                            ├─ identity adapter (replaceable)
                                            └─ persistence adapter (replaceable)
data/item-catalog/source/道具表-9-5.csv ────────> item-catalog import adapter
~~~

当前不需要 worker。指令生成是确定性的有界同步规则；目录导入可以作为受控管理/部署步骤，未来若变成大批量任务再增加 worker。

角色映射：customer = 客服 A，manager = 管理 B。角色来自认证上下文，不由表单或查询参数决定。

当前扩展新增 `super_admin`；manager 和 super_admin 继承客服的自有申请能力，审批由 manager/super_admin 执行，发放仅 super_admin 执行。

## Dependency direction

~~~text
frontend UI -> versioned contracts -> backend interface
backend application -> module public interfaces
operation-groups -> item-catalog (resolve and snapshot selected item)
backend manager projection -> command-generation (generate from immutable snapshot)
module domain -> ports -> adapters/infrastructure
~~~

前端不能读取数据库、导入 Excel 或拼接指令。后端领域规则不能依赖 React、Fastify、ORM 或具体认证 SDK。

## Request flow

新版申请流为客服提交/编辑 pending -> 管理或超级管理 approve/reject -> 超级管理 issue；客服取消也仅限 pending。旧 MVP 的 completed/warp 数据保持只读兼容。

1. 客服提交一个 group：一个服务器、账号、纯数字角色 ID、玩家 QQ、理由和一个或多个 operation。
2. 后端校验角色和输入；物品 operation 通过目录查找并保存代码/名称快照；初始状态为 pending。
3. 客服列表只返回自己的文字投影，commands 字段不返回；客服只能取消自己仍为 pending 的 group。
4. 管理队列只查询未处理 group，按服务器分组，再按 submittedAt ASC, id ASC 排序；管理投影调用指令生成模块。
5. 管理复制指令并完成 group；后端记录完成者和时间，终态数据不可变。
6. 归档查询保留 pending、completed、cancelled 全部历史，支持分页和筛选。

## Domain semantics

- 服务器、理由预设、operation type 都是可扩展的不透明字符串；初始枚举见 docs/modules/operation-groups.md。
- 时间统一为 UTC RFC 3339；ID 为不透明字符串。
- v1 的 characterId 默认是仅含 0-9 的数字字符串；即使内容是数字，接口也使用字符串以避免精度问题。若某服务器有例外，必须通过配置和契约版本显式声明。
- 数量是正整数。发物品单条指令上限为 1000，拆分保持 operation 顺序和 chunk 顺序。
- 指令字符串禁止任何空白字符；角色 ID、物品代码等参与指令的字段在后端生成前再次校验。
- 历史 group 使用提交时的 item code/name 快照，不随 Excel 更新回写。

## Persistence and integration

持久化、认证和 Excel 读取均通过适配器接入。当前 MVP 使用 JSON 文件适配器和内存会话身份适配器；生产可替换为 PostgreSQL/SQLite 与真实认证，而不改变模块契约。身份由认证适配器提供 userId 与 role，客户端不能自行声明权限。

## Progressive complexity

先完成三个模块和契约级测试，再根据真实数据量增加索引、缓存、队列或独立读模型；不要为尚未存在的依赖创建空层。
Production deployment now binds the backend to loopback, stores users,
sessions, and operation groups in SQLite WAL mode, and serves the frontend/API
through one Nginx origin. JSON and legacy header adapters are test-only.
