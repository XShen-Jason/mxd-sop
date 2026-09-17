# frontend

“所有队伍”的超管通关上传控件先选择服务器，再选 CSV。上传成功后重新读取
后端通关投影；文件只包含一个日期时自动定位该日期，包含多个日期时保留当前
日期，可通过日期选择器查看其他日期。通关角色使用高亮，整队通过显示“全员通关”。
解析及日期/服务器/副本匹配规则仅由 `team-view` 后端拥有。

浏览器回归：在前端开发服务运行后，使用可解析的 Playwright 安装执行
`node frontend/tests/team-clears.browser.cjs`。可通过 `PLAYWRIGHT_PACKAGE`
指定已有 Playwright 模块路径；覆盖桌面/手机、上传禁用、日期切换及通关展示，
接口数据隔离模拟，截图输出至系统临时目录。

## Responsibility

首屏为登录页，不提供注册。所有可见工作区由会话返回的 `workspacePermissions` 决定；角色只提供新增账号时的默认值。拥有同一工作区的任意角色看到相同内容和操作，申请操作中的活动快捷填充对拥有 `request` 工作区的角色开放。

前端提供客服（A）和管理（B）的角色界面、表单、物品模糊搜索、工单列表、复制按钮、完成/取消操作和归档面板。所有数据通过 versioned contracts 获取。

## Boundary rules

所有角色导航均提供 `/reminders` 待提醒工作区，复用“我的申请”的记录展示，只读取当前登录用户自己提交、已被提醒且仍待处理的申请；支持发物资/常规操作筛选及分类型数字标记。拥有 `ready` 工作区的账号可以在待完成记录上执行“提醒上线”，首次成功后显示“再次提醒”。

工作区使用独立路径 `/request`、`/records`、`/player-directory`、`/team-view`、`/reminders`、`/activities`、`/queue`、`/ready`、`/reissue`、`/archive`、`/accounts` 和 `/server-operations`；每条路径都按 `workspacePermissions` 过滤。活动与道具工作区的读取需要 `activities` 或 `request` 工作区，编辑需要 `activities` 工作区。申请操作中的“活动快捷填充”通过 activities.list 读取共享配置。

“所有队伍”页面默认使用当天北京时间作为名单日期；例如 9 月 8 日的组队名单，展示 9 月 7 日全天开放组队、于 9 月 8 日 00:00 锁定的队伍。成员列表只展示角色 ID。

工作区导航按能力拆分：申请操作、我的申请、待审核/待完成、物资发放记录、常规操作记录和账号管理分别作为左侧入口；默认角色会继承其默认工作区，账号级覆盖可以独立增加或移除任意入口。表单校验错误使用固定 toast，不改变页面布局。

- 不在前端拼接、拆分或持久化指令；待审核、待完成和记录工作区只渲染管理契约返回的 commands。
- 我的申请、待提醒和申请写入使用客服投影；明确授予管理工作区的客服使用同一管理页面和管理投影。
- 搜索请求应 debounce、取消过期请求并使用契约的 limit/cursor。
- 页面需表现 loading、empty、error、disabled 和权限拒绝状态，但这些不改变后端规则。
- 服务器管理工作区展示 `mxd-player` 和一个合并的游戏服务器工作区；自动处理服务的本地/远程端点在游戏服务器工作区内统一配置。每台游戏服务器单独配置 TCP IP、端口和账号，但不重复配置本地/远程服务。未接入后端契约的配置只能保存浏览器草稿，不得伪装成运行时状态。

## Activity catalog

The activities workspace uses cursor pagination for both category browsing and
text search. Each request is limited to eight rows; category changes load
immediately, while text input is debounced and obsolete requests are aborted.
Search and category selection are independent modes, so changing one resets the
other. Catalog feedback is presented through the shared floating notice.

On a role's default entry route, customer opens `/request`, manager opens
`/queue`, and super administrator opens `/ready`.

## Permission-aware workspace shell

The session user carries the complete `workspacePermissions` map. Navigation is
derived from that map, and a disabled direct URL is replaced with the first
enabled workspace. Account management presents an accounts-workspace holder
with two compact dialog tabs: basic account settings and a flat, role-independent
workspace selection with a role-default reset. Backend workspace checks remain
authoritative for every capability.

The material-distribution and regular-operation history tabs are separate
entries backed by the same archive contract with `kind=issuance` and
`kind=regular`. Any role granted those workspaces receives the same management
projection, commands, and actions; only own-record and reminder views omit
command payloads. Navigation, direct routes, counts, and live-refresh
subscriptions follow the effective map.

## Stack

使用 TypeScript + React + Vite；UI token 和组件规则遵循 docs/UI.md。请求通过 `frontend/src/api/client.ts` 连接版本化契约。

## Screens

新版界面补充：登录页不提供注册并支持记住账号密码；客服工作台将发物品/发点券并列展示，拖人/封禁为独立小功能且无需审核；导航按账号的工作区权限显示，获授权客服可以进入待审核、待完成或记录页面并看到与管理端一致的内容和操作。账号管理支持弹窗创建、编辑（含修改密码）、停用/启用和删除。

1. 客服提交页：服务器、账号、角色 ID、玩家 QQ、理由预设/备注、可增删的 operation 行和物品搜索。
2. 客服我的申请：只能看到当前账号提交的记录，按提交时间倒序；筛选栏中的发物资/常规操作互斥并显示当前账号对应类型的申请数量，默认显示发物资；物资记录在 pending 审核前、常规操作记录在 approved 待完成前可修改或经二次确认后取消，不显示任何指令；默认状态展示待审核、待完成、已完成和已驳回，取消默认不选，刷新恢复默认筛选。
3. 待审核队列：按服务器分组、提交时间升序，服务器筛选按钮显示数量；拥有 `queue` 工作区的任意角色看到同一记录字段、commands 和审批/驳回操作；只有补发记录可展开，指令只在有权限的管理工作区展示。
4. 管理归档：默认全状态，支持服务器/状态筛选和分页。

## 展示约定

申请记录、待审核、待完成和全部申请使用统一的表格网格，末列统一命名为“操作”。申请记录与待审核增加“提交员”列，待完成增加“审核员”列；这些人员字段按稳定用户 ID 动态解析当前昵称，账号删除时回退记录中的历史快照。待完成工作区将理由列替换为一条可复制指令，其他指令以 `+N` 汇总。展开后的指令方框在复制后保留标记，复制不会自动折叠；全部指令复制完成后，主行“指令”字段显示勾选。无可用操作的记录不显示按钮，操作按钮保持单行。拥有对应工作区的所有角色使用同一表格、展开内容和操作。申请记录和提醒投影不显示指令；队列、待完成和管理记录投影按契约显示 commands。账号管理按角色横向分栏，拥有 `accounts` 工作区的账号可维护账号，成功、失败和校验提示统一使用悬浮通知。
