# command-generation

## Purpose

把已经通过校验的角色操作快照转换成管理可复制执行的无空格指令。该模块是指令格式和发物品拆分规则的唯一权威。

## Scope

In scope:

- 根据 operation type 生成 herwarp、drop、cashid、ban 指令。
- 将 item quantity 按每条最多 1000 拆分。
- 保留 operation 顺序和拆分顺序，并返回可追踪的 operationIndex/sequence。
- 在输出前拒绝会产生空白或非法字段的输入。

Out of scope:

- 决定谁能看到指令（由 operation-groups 的授权投影负责）。
- 物品搜索、Excel 解析、工单持久化。
- 实际向游戏服务器执行或重试指令；本系统只提供复制文本。

## Ownership and invariants

| operation type | command template |
| --- | --- |
| warp | herwarp@角色ID |
| item | drop@角色ID@物品代码@数量 |
| cash | cashid@角色ID@数量 |
| ban | ban@角色ID |
| kick | herwarp@角色ID |

- 所有输出不得包含任何空格、制表符或换行。
- item 单条数量上限为 1000；quantity=2888 必须输出 1000、1000、888 三条。
- 单次生成最多 10,000 个 item chunk，超过后返回 invalid-quantity，避免异常输入造成无界同步工作。
- quantity=1000 输出一条；quantity=1001 输出 1000、1 两条；不输出 0 数量。
- 同一 group 的 operations 按输入数组顺序处理；同一 item 的 chunks 按从前到后处理。
- 生成只使用提交时保存的 code/characterId 快照，目录变化不能改写已提交 group 的指令语义。
- v1 默认要求 characterId 是仅含 0-9 的数字字符串；characterId 和 itemCode 不能包含空白或 @ 分隔符；其它字段字符集由后端输入规则明确拒绝，不让拼接产生歧义。

## Public surface

| Contract | 用途 |
| --- | --- |
| command-generation.generate | 接收角色 ID 和规范化 operation 快照，返回有序指令列表 |

这是 backend manager projection 使用的模块接口；客服 API 不调用或转发该输出。

## Dependencies

只依赖稳定的 operation 输入类型和可配置的 command mapping。模块核心不依赖数据库、HTTP 框架或游戏服务器 SDK。

## Data, configuration, and assets

command mapping 和 item limit 由本模块配置单一持有；初始 mapping 见上表，item limit=1000。若将来增加操作类型，必须同时增加配置、契约示例和测试。

当前四种模板与服务器无关；若未来不同服务器需要不同模板，按 serverId + command rule version 扩展配置，并保持历史版本可重现。

## Tests

测试覆盖四种初始 operation、0/负数/非整数、1000/1001/2888、多个 item、字段含空白、未知 type、特殊字符以及输出顺序。

## Migration notes

`kick` is the current player-removal operation and emits `herwarp@characterId`; `warp` remains a read-compatible legacy operation that emits `herwarp@characterId`.

保持生成结果的字节级格式（无空格、@ 分隔）和拆分顺序。迁移语言或框架时先复用 command-generation.generate 契约，不要从页面或控制器复制拼接逻辑。
