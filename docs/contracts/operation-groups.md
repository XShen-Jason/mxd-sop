# operation-groups

本文件是 operation-groups 相关 Contract ID 的 canonical definition。HTTP 路径是 v1 的建议映射，路径可随框架调整，但字段、权限和可观察行为保持稳定。

## Common model

~~~json
{
  "id": "opaque-group-id",
  "server": {"id": "mushroom", "displayName": "蘑菇"},
  "account": "game-account",
  "characterId": "123456",
  "playerQQ": "123456789",
  "reason": {"code": "compensation", "text": "活动补偿"},
  "operations": [
    {"type": "item", "itemCode": "02000000", "itemName": "金币", "quantity": 2888},
    {"type": "cash", "quantity": 500},
    {"type": "warp"},
    {"type": "ban"}
  ],
  "status": "pending",
  "submittedAt": "2026-08-31T10:00:00Z",
  "submittedBy": {"id": "opaque-user-id", "displayName": "客服 A"}
}
~~~

itemName 是服务端解析后的快照；客户端提交时只选择 itemCode。同一 group 中的 item operation 不得重复 itemCode；如果只发 cash，可以不提交 item operation。v1 的 characterId 默认是仅含 0-9 的字符串，即使看起来是数字也不能改成 JSON number；服务器例外必须显式配置并版本化。submittedBy 在客服投影中可省略或只显示当前用户，不能用于客户端授权。

状态值为 pending、approved、rejected、issued、completed、cancelled；前端展示为待审核、待完成、已驳回、已完成、已取消。终态字段按对应状态出现。group 应记录 command rule version，或引用不可变的规则版本，以便归档重现历史指令。

## operation-groups.list-options

Owner: operation-groups  
Version: v1  
Consumers: 已认证客服、管理前端

### Request/event

GET /api/v1/operation-groups/options

无业务请求体；认证上下文决定可见范围。

### Response/handling

返回服务器、理由预设和 operation 元数据（显示名、所需字段、是否允许多选）。初始服务器和 operation 列表见 docs/modules/operation-groups.md。未知配置项应以可扩展枚举处理，客户端不能据此拼接指令。

响应可包含 `actionReasons.kick` 和 `actionReasons.ban`，分别供拖人/封禁小功能使用；它们与道具发放的 `reasons` 分开维护。

发物资初始理由预设为 bug-recovery（BUG补发）、event-reward（活动奖励）、compensation（补偿）、internal（自己人）、other（其他）；拖人初始理由预设为 corpse（尸体）、abnormal-behavior（抢吸）、player-request（玩家反馈）、other（其他）；封禁理由保留 cheating（外挂/作弊）、player-request（玩家举报）、abuse（违规行为）、other（其他），默认分别取各列表第一项。other 要求填写 reason.text。该列表是配置数据，不是客户端硬编码。

### Errors

unauthorized（401）、forbidden（403）、options-unavailable（503）。

### Limits and side effects

只读、有界响应；不得包含任何命令模板或已生成指令。

### Compatibility

新增选项是兼容变更；删除或改变字段含义需新版本并保留旧值兼容期。

### Examples

正常：返回 mushroom、yeti、red-snail、uu、piaopiao-pig 及四种 operation。失败：目录/配置不可用返回 options-unavailable，不返回半截列表。

## operation-groups.submit-group

Owner: operation-groups  
Version: v1  
Consumers: frontend 客服

### Request/event

POST /api/v1/operation-groups；认证角色必须为 customer。幂等键由 Idempotency-Key 请求头提供。

~~~json
{
  "serverId": "mushroom",
  "account": "game-account",
  "characterId": "123456",
  "playerQQ": "123456789",
  "reason": {"code": "compensation", "text": "活动补偿"},
  "operations": [
    {"type": "item", "itemCode": "02000000", "quantity": 2888},
    {"type": "cash", "quantity": 500}
  ]
}
~~~

服务器从配置校验；account、characterId、playerQQ、reason 按项目输入规则校验；v1 默认要求 characterId 匹配 ^[0-9]+$ 且作为字符串接收，服务器例外必须有显式规则；operations 必须非空且初始上限为 100 条。itemCode 必须存在于 item-catalog，quantity 必须为正十进制整数并处于 command-generation 的有界生成预算内；warp/ban 不接受额外字段。提交者身份从认证上下文取得。

### Response/handling

201 返回新 group 的客服投影；道具/点券申请初始 status 为 pending，纯拖人（kick）或封禁申请跳过审核并进入 approved（待完成）。服务端解析并保存 itemCode/itemName 快照，createdAt 使用 UTC RFC 3339。相同幂等键和相同请求重试返回原 group，不重复创建。

### Errors

unauthorized（401）、forbidden（403）、invalid-input（400）、unknown-server（422）、unknown-item（422）、invalid-quantity（422）、catalog-unavailable（503）、idempotency-conflict（409）。

### Limits and side effects

同步创建一个 group 和其有序 operations；写入必须原子完成。不得生成或返回 commands。请求体和单个字段必须有大小上限，具体部署值不能放宽业务语义。

### Compatibility

新增 operation type/可选理由字段应向后兼容；改变已有 type 的必填字段需 v2。

### Examples

正常：item quantity=2888 被保存为一个 operation（数量不在此处拆分），响应含 itemName=金币 且无 commands。失败：itemCode 不存在时整个 group 不创建。

### Equipment level normalization

Item operations may include `itemLevel` for equipment. The service defaults it to 1 and bounds it to 1-10. Level 1 keeps the base `itemCode`; higher levels use a `_N` suffix (for example `01012190_2`). The persisted operation and manager commands always use this final code. Duplicate checks use the final code, so different equipment levels may coexist. Legacy requests that already contain a suffixed equipment code remain readable.

### Item image snapshots

Item operations may include the optional `itemImage` URL resolved from `item-catalog` at normalization time. It is a display-only snapshot; clients submit `itemCode`, `quantity`, and (for equipment) `itemLevel`. Older records without this field are enriched from the current catalog when projected.

## operation-groups.list-own

Owner: operation-groups  
Version: v1  
Consumers: frontend 客服

### Request/event

GET /api/v1/operation-groups/mine?cursor={opaque-cursor}&limit={n}；认证角色必须为 customer。服务端只使用认证 userId 过滤。

### Response/handling

返回按 submittedAt 降序、id 降序稳定排序的客服投影和 nextCursor。每个 group 包含文字字段、operations、status、审计时间；commands 字段必须完全省略（不是空数组）。submittedBy 等审计参与者通过稳定用户 ID 关联当前账号目录，displayName 修改后后续投影应返回最新昵称；用户不存在时保留记录中的历史快照名称。

### Errors

unauthorized（401）、forbidden（403）、invalid-cursor（400）。

### Limits and side effects

只读；limit 默认 20、最大 100；禁止无界返回。

### Compatibility

新增非命令展示字段兼容；不得在此响应新增 commands。

### Examples

客服看到自己刚提交的 itemName、quantity 和 pending 状态，但 JSON 中不存在 commands、command、herwarp、drop、cashid、ban 字段。

`list-own` also accepts optional `status` (repeatable or comma-separated) and `kind=issuance|regular`; these filters are applied before pagination.

## operation-groups.cancel-group

Owner: operation-groups  
Version: v1  
Consumers: frontend 客服

### Request/event

POST /api/v1/operation-groups/{groupId}/cancel；认证角色必须为 customer。groupId 为不透明字符串，提交者必须是当前认证 userId。

### Response/handling

成功将可操作的 pending 物资或 approved 常规 group 原子转换为 cancelled，记录 cancelledAt/cancelledBy，返回客服投影。重复取消同一 cancelled group 幂等；completed group 或其他用户的 group 不得改变。

### Errors

unauthorized（401）、forbidden（403）、group-not-found（404）、invalid-status-transition（409）、conflict（409）。

### Limits and side effects

状态转换和审计写入同一事务；不删除历史记录，不产生指令。

### Compatibility

终态字段只增不改；未来增加撤销/恢复需新契约。

### Examples

正常：A 取消自己的 pending 物资 group 或 approved 常规 group 后 status=cancelled。失败：B 或 A 对 completed group 操作返回 forbidden/invalid-status-transition。

## operation-groups.list-queue

Owner: operation-groups  
Version: v1  
Consumers: frontend 管理

### Request/event

GET /api/v1/manager/operation-groups/queue?cursor={opaque-cursor}&serverId={optional}&limit={n}；认证角色必须为 manager。

### Response/handling

只返回 pending group；结果先按 serverId 分组，每组内按 submittedAt 升序、id 升序。管理投影包含文字字段和 commands 数组，commands 由 command-generation.generate 生成并按 operationIndex/sequence 标识。

### Errors

unauthorized（401）、forbidden（403）、invalid-cursor（400）、unknown-server（422）、generation-failed（500）。

### Limits and side effects

只读；limit 最大 100 个 group，查询和生成工作必须有界；不得为每个 group 触发无界重复查询。

### Compatibility

新增服务器是兼容变更；排序键和 commands 字段语义不可静默改变。

### Examples

## operation-groups.list-reviews

Owner: operation-groups
Version: v1
Consumers: frontend 绠＄悊/瓒呯骇绠＄悊

### Request/event

GET `/api/v1/manager/operation-groups/reviews?cursor={opaque-cursor}&serverId={optional}&limit={n}`。

### Response/handling

返回所有状态的审核记录（包括 pending、approved、rejected、issued、completed、cancelled），按服务器配置顺序及提交时间升序稳定分页。仅 pending 记录允许执行 approve/reject；该读取契约对 manager 与 super_admin 一致开放。

### Limits and side effects

只读；limit 最大 100；游标为不透明 keyset 游标，服务端不会一次性加载全部记录。

正常：蘑菇组先显示最早 submittedAt 的 pending group；同一 group 的 2888 物品对应三条 drop 指令。客服 token 调用同一路径必须得到 forbidden。

## operation-groups.complete-group

Owner: operation-groups  
Version: v1  
Consumers: frontend 管理

### Request/event

POST /api/v1/manager/operation-groups/{groupId}/complete；认证角色必须为 manager。可选请求体可携带执行备注，但不能覆盖 group 内容或指令。

### Response/handling

legacy warp 的 pending group 或常规 kick/ban 的 approved group 原子转换为 completed，记录 completedAt/completedBy；返回管理投影或最小确认对象。重复完成同一 completed group 幂等；cancelled group 返回冲突。

### Errors

unauthorized（401）、forbidden（403）、group-not-found（404）、invalid-status-transition（409）、conflict（409）。

### Limits and side effects

只改变状态和审计字段，不调用游戏服务器；复制/执行由管理人员在系统外完成。

### Compatibility

完成动作必须可安全重试；新增执行备注字段为可选兼容变更。

### Examples

正常：管理复制三条 drop 后完成 group，queue 不再返回该 group，archive 仍可见。失败：已 cancelled group 不能完成。

## operation-groups.list-archive

Owner: operation-groups  
Version: v1  
Consumers: frontend 管理

### Request/event

GET /api/v1/manager/operation-groups/archive?cursor={opaque-cursor}&status={optional}&serverId={optional}&limit={n}；认证角色必须为 manager。

### Response/handling

默认返回全部状态（pending、approved、rejected、issued、completed、cancelled），支持 status/serverId 筛选和游标分页。管理投影保留 commands，排序默认 submittedAt 降序、id 降序；筛选 pending 时仍能看到尚未操作的 group。

### Errors

unauthorized（401）、forbidden（403）、invalid-cursor（400）、invalid-status（422）、unknown-server（422）。

### Limits and side effects

只读；limit 最大 100；归档不能物理删除终态记录。

### Compatibility

历史 group 的 code/name 快照和已生成指令语义必须可重现；新增筛选参数兼容。

### Examples

正常：默认结果包含全部状态；status=pending 只显示未处理。客服调用返回 forbidden。

`list-archive` accepts optional repeatable/comma-separated `status` values and `kind=issuance|regular`; filtering occurs before keyset pagination.

## v1 workflow extension

The original `completed` state remains readable for MVP records. 物资记录使用 `pending -> approved -> issued`，常规 `kick`/`ban` 记录跳过审核并进入 `approved`（待完成）；物资记录可在 `pending` 状态修改或取消，常规操作记录可在 `approved` 完成前修改或取消。`approve` 可由 `manager` 或 `super_admin` 执行；`issue` 只能由 `super_admin` 执行；常规操作记录由管理角色调用完成接口结束。管理归档和客服投影会保留 approved、rejected、issued 的审计字段，客服投影仍绝不包含 commands。

角色层级向下兼容：manager 和 super_admin 也可调用客服的 submit/list-own/update/cancel 能力，但每次仍只作用于认证 userId 自己的 group。

纯 `kick`/`ban` group 的 account 和 playerQQ 字段可省略；道具或点券 operation 仍要求这两个玩家资料字段。actionReasons.kick 与 actionReasons.ban 由 options 返回，服务端按对应集合校验。

### operation-groups.update-group

`PUT /api/v1/operation-groups/{groupId}`，认证角色必须是提交者本人；customer、manager、super_admin 均可继承调用。申请在 pending、approved 或 rejected 状态可修改，服务端重新执行完整输入校验、清除旧审核及提醒字段、记录 updatedAt/updatedBy，并统一回到 pending 重新审核；已发放、完成或取消的 group 返回 `invalid-status-transition`。取消契约使用相同的完成前窗口，但取消后不能恢复。

### operation-groups.remind-customer / list-reminders

`POST /api/v1/super-admin/operation-groups/{groupId}/remind` 仅允许 `super_admin` 对 approved 申请调用。调用不改变 status，递增 `reminderCount` 并记录 `lastRemindedAt/lastRemindedBy`；重复调用表示再次提醒，发物资和常规操作均可提醒。

`GET /api/v1/operation-groups/reminders?cursor={opaque-cursor}&limit={n}&kind={issuance|regular}` 允许所有已认证角色调用；只返回当前登录用户提交者本人、仍为 approved、已被提醒的记录。`kind` 可筛选发物资或常规操作，省略时返回两类；使用与 list-own 相同的客服投影和倒序游标分页，绝不返回 commands。

`GET /api/v1/operation-groups/workspace-counts` 返回当前角色可见的小标计数；所有角色均得到自己的 `reminders`，并附带 `reminderIssuance`、`reminderRegular` 分类型计数，以及当前用户全部申请的 `ownIssuance`、`ownRegular` 分类型计数；管理角色额外得到 `pending`，超级管理员额外得到 `ready`。`GET /api/v1/operation-groups/events` 是认证 SSE 变更信号，只发送无业务数据的 changed 事件，客户端据此刷新当前页，不轮询。

### operation-groups.approve-group / reject-group / issue-group

分别映射到 `/api/v1/manager/operation-groups/{groupId}/approve`、`/reject`、`/issue`。approve/reject 允许管理及超级管理；issue 仅超级管理且只能作用于 approved group。reject 可携带可选 `reason`，issue 可携带可选 `executionNote`。所有操作幂等或返回稳定冲突错误。

### operation-groups.list-overview

`GET /api/v1/manager/operation-groups/overview` 返回按客服聚合的 total、pending、approved、rejected、issued、cancelled 计数；需要管理或超级管理，使用游标分页。单个申请详情通过 queue/archive 契约查询。
