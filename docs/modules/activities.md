# activities

Equipment rewards include an optional `itemLevel` (default 1, maximum 10). Level 1 uses the catalog base code; higher levels append `_N` when the reward is applied to a request.

## Purpose

管理客服常用活动及其道具、点券奖励，并在发物资申请中提供一键填充。该工作区仅管理及以上角色可见。

## Scope

活动名称、说明、奖励编辑与本地持久化；左侧活动列表与编辑表单在同一位置切换，点击“添加活动”后才显示表单，已配置活动和申请页活动快捷填充均使用自适应多列布局。右侧道具面板以单列展示，筛选栏仅保留消耗品、装备、时装、材料、椅子、任务和称号，点券及未分类（金币所在的“其他”）不提供筛选入口；固定分类使用中文标签；“全部”无搜索词时展示最近使用物品，输入关键词按目录搜索，选择分类时按游标分页直接读取该分类。活动数据保存在浏览器 localStorage，目录分类通过 item-catalog.by-class 读取。

## Ownership and invariants

每个活动有稳定 id、名称和至少一项正数量奖励；道具奖励必须来自 item-catalog 搜索结果，单个活动内同一 itemCode 不得重复。选择多个活动时，相同道具/点券按数量累加，取消活动只回退该活动贡献。

## Catalog pagination

The item board requests at most eight records per page. Category browsing uses
`item-catalog.by-class` immediately, while text search uses
`item-catalog.search` after a short debounce. Both flows retain the contract's
opaque cursor and cancel obsolete requests. Selecting a category clears the
text search; entering text clears the category filter. The board never fetches
or renders an entire category, and page navigation replaces the visible rows.

## Public surface

`ActivityView`（活动与奖励工作区）和 `activities/store`（Activity、ActivityReward 类型及读写函数）。

## Dependencies

item-catalog.search、item-catalog.by-class、现有 CustomerView 申请表单和浏览器 localStorage。

## Data, configuration, and assets

存储键 `game-support-activities`；复用 `game-support-recent-items` 最近道具记录。

## Tests

前端 TypeScript/Vite 构建；工单后端测试保持通过。
