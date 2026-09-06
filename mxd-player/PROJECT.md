# mxd-player

## Project identity

Project ID: mxd-player
Name: 玩家远征组队
Purpose and users: 为玩家提供账号验证、黑龙/扎昆组队报名和邀请码加入
Scale: Standard
Primary languages: Go, TypeScript, SQLite
Applications: frontend-player, backend-player

## Application registry

| Application | Responsibility | Entry point | Command |
| --- | --- | --- | --- |
| frontend-player | 玩家页面、交互和展示状态 | `frontend-player/src/main.tsx` | `npm run dev` |
| backend-player | 验证、组队规则、SQLite 持久化 | `backend-player/main.go` | `go run .` |

## Module registry

| Module ID | Capability | Implementation | Contracts |
| --- | --- | --- | --- |
| player-registration | 玩家验证、角色选择、队伍创建和加入 | `frontend-player/src`, `backend-player` | `player.verify`, `player.teams`, `player.teams.join` |

## Project constraints

Backend uses SQLite WAL with bounded connection pool and transactional writes. A
team has at most 10 members; one account can join at most one team per boss and
can join both bosses. Team IDs are opaque and never returned to the frontend.
Application source files should remain at or below 300 lines.

## Commands

Frontend: `npm run build`, `npm run lint`
Backend: `go test ./...`, `go vet ./...`
