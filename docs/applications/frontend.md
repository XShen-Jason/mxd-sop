# frontend

## Responsibility

首屏为登录页，不提供注册。普通客服只看到申请操作和我的申请工作区；管理和超级管理进入待审核、待完成、物资发放记录、常规操作记录及账号管理工作区，操作按钮按会话角色显示。申请操作中的活动快捷填充对所有角色开放。

前端提供客服（A）和管理（B）的角色界面、表单、物品模糊搜索、工单列表、复制按钮、完成/取消操作和归档面板。所有数据通过 versioned contracts 获取。

## Boundary rules

所有角色导航均提供 `/reminders` 待提醒工作区，复用“我的申请”的记录展示，只读取当前登录用户自己提交、已被超级管理员提醒且仍待处理的申请；支持发物资/常规操作筛选及分类型数字标记。超级管理员的待完成记录提供“提醒上线”，首次成功后显示“再次提醒”；普通管理不显示该操作。

工作区使用独立路径 `/request`、`/records`、`/reminders`、`/activities`、`/queue`、`/ready`、`/reissue`、`/archive`、`/accounts`；活动与道具工作区 `/activities` 仅管理及以上角色可见和编辑，配置通过 activities.replace 保存。申请操作中的“活动快捷填充”对所有角色开放，通过 activities.list 读取活动工作区的已配置活动。

工作区导航按能力拆分：申请操作、我的申请、待审核/待完成、物资发放记录、常规操作记录和账号管理分别作为左侧入口；高权限角色同时继承低权限工作区。表单校验错误使用固定 toast，不改变页面布局。

- 不在前端拼接、拆分或持久化指令；只渲染管理契约返回的 commands。
- 客服路由只调用客服契约，不能通过隐藏字段或缓存读取管理投影。
- 搜索请求应 debounce、取消过期请求并使用契约的 limit/cursor。
- 页面需表现 loading、empty、error、disabled 和权限拒绝状态，但这些不改变后端规则。

## Activity catalog

The activities workspace uses cursor pagination for both category browsing and
text search. Each request is limited to eight rows; category changes load
immediately, while text input is debounced and obsolete requests are aborted.
Search and category selection are independent modes, so changing one resets the
other. Catalog feedback is presented through the shared floating notice.

On a role's default entry route, customer opens `/request`, manager opens
`/queue`, and super administrator opens `/ready`.

## Stack

使用 TypeScript + React + Vite；UI token 和组件规则遵循 docs/UI.md。请求通过 `frontend/src/api/client.ts` 连接版本化契约。

## Screens

新版界面补充：登录页不提供注册并支持记住账号密码；客服工作台将发物品/发点券并列展示，拖人/封禁为独立小功能且无需审核；管理和超级管理分别显示审批、全部申请和账号管理能力，申请卡片保留申请人、审核人、发放人和时间，发放按钮仅超级管理可见。账号管理支持弹窗创建、编辑（含修改密码）、停用/启用和删除。

1. 客服提交页：服务器、账号、角色 ID、玩家 QQ、理由预设/备注、可增删的 operation 行和物品搜索。
2. 客服我的申请：只能看到当前账号提交的记录，按提交时间倒序；筛选栏中的发物资/常规操作互斥并显示当前账号对应类型的申请数量，默认显示发物资；物资记录在 pending 审核前、常规操作记录在 approved 待完成前可修改或经二次确认后取消，不显示任何指令；默认状态展示待审核、待完成、已完成和已驳回，取消默认不选，刷新恢复默认筛选。
3. 管理待审核队列：按服务器分组、提交时间升序，服务器筛选按钮显示数量，审批/驳回直接在行内操作并要求确认；只有补发记录可展开，指令只在有权限的待完成工作区展示。
4. 管理归档：默认全状态，支持服务器/状态筛选和分页。

## 展示约定

申请记录、待审核、待完成和全部申请使用统一的表格网格，末列统一命名为“操作”。申请记录与待审核增加“提交员”列，待完成增加“审核员”列；这些人员字段按稳定用户 ID 动态解析当前昵称，账号删除时回退记录中的历史快照。待完成工作区将理由列替换为一条可复制指令，其他指令以 `+N` 汇总。展开后的指令方框在复制后保留标记，复制不会自动折叠；全部指令复制完成后，主行“指令”字段显示勾选。无可用操作的记录不显示按钮，操作按钮保持单行。客服、待审核和待完成页面只有补发记录可以展开，展开使用图标；“常规操作记录”中的记录只保留展开操作。申请记录按发物资/常规操作互斥筛选，默认发物资；状态默认筛选待审核、待完成、已完成和已驳回，取消默认不选。补发记录展示道具/点券数量，客服投影永远不显示指令，管理指令仅在待完成工作区显示。账号管理按角色横向分栏，普通管理可添加管理和客服，成功、失败和校验提示统一使用悬浮通知。
