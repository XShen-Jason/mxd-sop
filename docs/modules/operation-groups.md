# operation-groups

本版本将客服工作台命名为“申请道具发放”。发物品和发点券可在同一 group 中并列提交；拖人（`kick`）和封禁（`ban`）是只需要 serverId、characterId、reason 的独立操作。旧 `warp` 类型仅作为历史数据兼容读取。

`actionReasons.kick` 与 `actionReasons.ban` 是独立于道具发放理由的配置集合；服务端会按纯踢人/封号申请校验对应集合，前端不得把理由列表写死。

## Purpose

持有一次客服提交的完整工单组，以及它从提交到取消/完成/归档的生命周期。一个 group 对应一个角色的一次上传，可包含多个 operation；管理队列和归档都是该模块的授权投影。

## Scope

In scope:

- 校验服务器、账号、角色 ID、玩家 QQ、理由和 operation 列表。
- 以提交者和 group 为边界保存文字信息、操作顺序、时间和审计字段。
- 提交客服自己的列表、取消自己的未处理 group。
- 为管理提供按服务器分组、按提交时间排序的待处理队列和全量归档查询。
- 在提交时解析物品目录并保存物品代码/名称快照。

Out of scope:

- 具体指令字符串和数量拆分（由 command-generation 持有）。
- Excel 解析和物品搜索实现（由 item-catalog 持有）。
- 登录、用户目录和具体数据库/ORM。

## Ownership and invariants

### Initial configuration

服务器使用稳定的可扩展 ID，初始展示值如下：

| serverId | displayName |
| --- | --- |
| mushroom | 蘑菇 |
| yeti | 雪人 |
| red-snail | 红蜗牛 |
| uu | UU |
| piaopiao-pig | 漂漂猪 |

初始 operation type：

| type | displayName | 参数 |
| --- | --- | --- |
| item | 发物品 | itemCode、quantity |
| cash | 发点券 | quantity |
| warp | 拖人 | 无 |
| ban | 封号 | 无 |

服务器、reason preset 和 operation type 必须可配置扩展；客户端应通过 list-options 契约取得展示选项，不能把这些列表写成后端规则的第二份。

初始 reason preset（业务确认后仍可调整）：

| code | displayName | 备注 |
| --- | --- | --- |
| bug-recovery | BUG补发 | BUG/误操作恢复 |
| event-reward | 活动奖励 | 活动发放 |
| compensation | 补偿 | 活动或服务补偿 |
| internal | 自己人 | 内部处理 |
| other | 其他 | 需要填写 reason.text |

拖人使用 corpse（尸体）、abnormal-behavior（抢吸）、player-request（玩家反馈）、other（其他）；封禁使用 cheating（外挂/作弊）、player-request（玩家举报）、abuse（违规行为）、other（其他）。各列表第一项为默认理由。

预设 code 负责统计和筛选；reason.text 用于补充说明，不能被解释为指令参数。

### Group rules

- 一个 group 只能有一个 serverId、account、characterId、playerQQ 和 reason，且至少有一个 operation；v1 默认要求 characterId 是仅含 0-9 的数字字符串，服务器例外必须显式配置。
- operation 是有序数组；每个 item operation 单独保存数量，不能因 UI 合并而丢失原始顺序；同一 group 中不得重复 itemCode，纯 cash 申请可以没有 item operation。
- item 和 cash 的 quantity 都是十进制正整数；warp/ban 不接受额外参数。
- 状态使用 pending、approved、rejected、issued、completed、cancelled（前端分别显示待审核、待完成、已驳回、已完成、已取消）；道具/点券申请按 pending -> approved -> issued 流转，纯拖人（kick）和封禁申请跳过审核并进入 approved 待完成状态。
- 只有提交者可以取消自己的 pending 物资 group 或 approved 常规 group；管理可审核 pending，管理可完成 approved 常规 group，超级管理可将 approved 物资确认发放。竞争请求以先成功的状态转换为准，另一方得到稳定冲突错误。
- submittedAt、completedAt、cancelledAt 使用 UTC RFC 3339；历史 group 的物品代码和名称是提交时快照。
- group 记录所用的 command rule version，或保证指令映射版本不可变，确保归档可重现历史指令。
- 客服投影绝不包含 commands；管理投影才可组合 command-generation 的结果。

## Public surface

| Contract | 用途 |
| --- | --- |
| operation-groups.list-options | 返回可用服务器、理由预设和 operation 元数据 |
| operation-groups.submit-group | 客服创建一个 group |
| operation-groups.list-own | 客服分页查看自己的 group |
| operation-groups.cancel-group | 客服取消自己的可操作 group |
| operation-groups.list-queue | 管理按服务器查看 pending group |
| operation-groups.complete-group | 管理完成 legacy pending 或常规 approved group |
| operation-groups.list-archive | 管理查看全部历史（包含仍 pending 的 group） |

## Dependencies

- item-catalog：提交 item operation 时按 code 查找并取得名称快照。
- identity adapter：提供已认证 userId 和 role；客户端字段不参与授权。
- persistence adapter：保存 group、operation、状态转换和审计信息。
- command-generation：仅在构造管理投影时调用其公开接口。

## Data, configuration, and assets

建议的持久化聚合为 group + ordered operations + status audit。服务器/理由/operation 选项应有版本或更新时间，避免配置更新改写历史。物品原始文件位于 data/item-catalog/source/道具表.xlsx，导入规则见 item-catalog 模块。item operation 可保存由目录解析出的可选 itemImage 展示快照。

## Tests

下一阶段至少覆盖：最少字段校验、多个 item 的独立数量、客服只能读自己的 group、客服不能看到 commands、可操作状态的取消/编辑、终态冲突、队列服务器分组和稳定排序、归档包含 pending/completed/cancelled。

## Migration notes

模块 ID 和 group/operation 字段语义必须保持稳定。更换数据库或 API 框架时只替换适配器和接口层；若增加 processing 等状态，先升级契约并记录迁移。

工作流扩展使用 `pending`、`approved`、`rejected`、`issued` 和 `cancelled`；旧 `completed` 记录继续可读。客服可编辑/取消 pending 物资或 approved 常规操作记录，管理或超级管理可审核物资，管理角色可完成常规操作记录，只有超级管理可确认发放物资。
