# 游戏客服操作工单系统

Project ID: game-support-ops

这是一个供普通客服提交玩家操作申请、供管理审核并由超级管理确认发放的内部工单系统。仓库现在包含可运行的本地 MVP：后端负责登录授权、校验、快照、状态和指令生成，前端提供客服、管理和账号管理工作台。

详细文档入口：[docs/README.md](docs/README.md)，项目注册表见 [docs/PROJECT.md](docs/PROJECT.md)。

## 需求摘要

- 客服登录后进入“申请道具发放”工作台；发物品和发点券在同一面板填写，踢人/封号为只需服务器、角色 ID 和理由的独立小功能。
- 角色 ID 默认按纯数字字符串校验（例如 123456）；接口仍使用字符串传输，避免数值精度问题，服务器例外需显式配置。
- 理由支持常用预设（玩家申请、补偿、异常恢复、活动奖励、其他）和补充说明，预设可扩展。
- 初始操作包括发物品、发点券、踢人和封号；服务器和操作类型都按配置扩展。
- 物品从 Excel 目录中模糊搜索，提交时保存物品代码和名称快照；每个物品数量独立。
- 客服只能看到自己的文字信息和状态，不能得到任何指令；客服可以取消自己尚未处理的工单。
- 管理按服务器查看待审核工单，管理/超级管理可通过或驳回；只有超级管理能确认已发放。管理可按客服查看申请总览并维护客服账号，超级管理可维护全部三类账号。
- 发物品数量超过 1000 时，后端按原顺序拆成多个无空格指令。
- 归档面板保留全部历史状态，未处理、已完成和已取消均可查询。

## 目录

~~~text
.
├── AGENTS.md                        Codex/AI 自动发现的根规则
├── README.md                        项目入口
├── .gitignore
├── docs/                            全部项目文档
│   ├── PROJECT.md / INIT.md / ARCHITECTURE.md
│   ├── MODULE.md / CONTRACTS.md / DEVELOPMENT.md
│   ├── PERFORMANCE.md / UI.md / REVIEW.md / MIGRATION.md
│   ├── modules/                     能力模块说明
│   ├── contracts/                   稳定边界契约
│   ├── applications/                前后端边界说明
│   └── data/                        数据资产说明
├── backend/                         Fastify + TypeScript 后端
├── frontend/                        React + Vite 前端
└── data/item-catalog/source/        物品表原始导入资产
~~~

## 运行

需要 Node.js 20+。在仓库根目录执行：

```bash
npm install
npm run dev
```

打开 http://localhost:5173。开发环境测试会使用固定测试账号；生产环境必须通过 `INITIAL_ADMIN_*` 初始化一个超管，禁止使用默认密码。登录后由超管创建管理和客服账号；账号只能由管理或超级管理创建，页面不提供注册。也可以分别运行 `npm run dev --workspace backend` 和 `npm run dev --workspace frontend`。

验证命令：`npm test`、`npm run lint`、`npm run build`。

所有业务规则以 docs/modules/ 和 docs/contracts/ 为准；docs/PROJECT.md 只做索引，避免在多个位置维护不同版本的规则。
## Debian deployment decision

The supported deployment is one Fastify process behind Nginx and one SQLite
database at `DATABASE_PATH`. The application does not impose a fixed user
count; PostgreSQL and Redis are intentionally not required yet. Move to
PostgreSQL when measured write concurrency, multiple replicas, or centralized
reporting requires it. See `docs/DEPLOYMENT-DEBIAN.md`.

On a new production database, startup refuses to continue unless
`INITIAL_ADMIN_PASSWORD` is set. Exactly one `super_admin` is created, public
registration remains disabled, and later accounts are created by that admin.

For local development, set the same initialization variables before starting
the backend (PowerShell: `$env:INITIAL_ADMIN_PASSWORD='local-only-password'`).
There is no default password and an empty database will refuse to start.
