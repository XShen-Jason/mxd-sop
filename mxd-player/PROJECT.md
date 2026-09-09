# mxd-player

## Project identity

Project ID: mxd-player
Name: 玩家远征组队
Purpose and users: 为玩家提供账号验证、黑龙/进阶扎昆组队报名和邀请码加入
Scale: Standard
Primary languages: Go, TypeScript, SQLite
Applications: frontend-player, backend-player

## Application registry

| Application | Responsibility | Entry point | Command |
| --- | --- | --- | --- |
| frontend-player | 玩家页面、交互和展示状态 | `frontend-player/src/main.tsx` | `npm run dev` |
| backend-player | 验证、组队规则、SQLite 持久化 | `backend-player/cmd/mxd-player/main.go`, `backend-player/internal/player` | `go run ./cmd/mxd-player` |

## Module registry

| Module ID | Capability | Implementation | Contracts |
| --- | --- | --- | --- |
| player-registration | 玩家验证、角色选择、目标日期队伍创建、申请加入、退出、审批/拒绝和队伍合并 | `frontend-player/src/features/player-registration`, `backend-player/internal/player` | `player.verify`, `player.me`, `player.servers`, `player.teams`, `player.teams.join`, `player.teams.leave`, `player.teams.preview`, `player.teams.approve`, `player.teams.reject`, `player.teams.merge`, `player.teams.merge.approve` |
| player-operations-integration | 为客服工单系统提供账号导入和锁定队伍快照，不共享数据库 | `backend-player/internal/player` | internal account import, internal team snapshot |

## Project constraints

Backend uses SQLite WAL with bounded connection pool and transactional writes. A
team has at most 10 members; each created team targets the next Beijing
business day, one account can join at most one team per boss, and members can
leave before the 00:00 lock. Team IDs are opaque and never returned to the
frontend.
Application source files should remain at or below 300 lines.

## Application boundaries

`player-registration` also owns `player.teams.history`, the authenticated,
date-scoped locked roster query and compact mobile team-history view. Its
implementation lives in `team_history.go` and `components/TeamHistory.tsx`;
date and membership isolation are covered by `team_history_test.go`.

The frontend is an independent consumer of `CONTRACTS.md`. Its API client,
session storage, error-message mapping, and player UI components are separate
from the backend implementation. `src/App.tsx` is a compatibility export;
`src/features/player-registration/PlayerRegistrationApp.tsx` owns page state
and API mutation orchestration, while its `api/`, `components/`, and `config/`
directories own the capability internals.

The backend keeps HTTP registration in `router.go`, account endpoints in
`account_http.go`, configuration/database setup in `config.go`, and response
models in `models.go`. Validation, transactions, and SQLite queries remain
backend-owned and are not duplicated in frontend components.

## Commands

Frontend: `npm run build`, `npm run lint`
Backend: `go test ./...`, `go vet ./...`
