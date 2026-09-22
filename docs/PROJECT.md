# PROJECT.md

## Project identity

```text
Project ID: game-support-ops
Name: Game support operations desk
Purpose and users: Authenticated customer, manager, and super-admin workspaces for requests, approvals, player data, game-server operations, and audit-friendly execution.
Scale: Standard
Primary languages: TypeScript, React, Fastify, SQLite, and HTTP integration adapters
Applications: frontend, backend, mxd-player/frontend-player, mxd-player/backend-player, mxd-auto-process/backend-auto-process, mxd-auto-process/frontend-auto-process
Roles: customer, manager, super_admin
```

Stable IDs in this map do not change when a frontend framework, backend
framework, database, or deployment arrangement changes. Frontend and backend
communicate through versioned HTTP contracts; no frontend imports backend
internals or database structures.

## Application registry

| Application | Responsibility | Language/framework | Entry point | Commands |
| --- | --- | --- | --- | --- |
| frontend | Customer/manager workspaces, search, live projections, and interaction; it never generates commands | TypeScript + React + Vite | `frontend/src/main.tsx` | `npm run dev --workspace frontend` |
| backend | Authentication, persistence, directory queries, workflows, command projection, and external-service adapters | TypeScript + Fastify | `backend/src/server.ts` | `npm run dev --workspace backend` |
| mxd-auto-process/backend-auto-process | Authoritative game-server/account sessions, complete login, reconnect, chat, persistence, and audit API | Go + SQLite | `mxd-auto-process/backend-auto-process/cmd/mxd-auto-process/main.go` | `cd mxd-auto-process/backend-auto-process; go run ./cmd/mxd-auto-process` |
| mxd-auto-process/frontend-auto-process | Auto read-only monitoring and password-protected operator controls | Vite + React + TypeScript | `mxd-auto-process/frontend-auto-process/src/main.tsx` | `cd mxd-auto-process/frontend-auto-process; npm run dev` |
| mxd-player/frontend-player | Public player verification and team interface | TypeScript + React + Vite | `mxd-player/frontend-player/src/main.tsx` | `cd mxd-player/frontend-player; npm run dev` |
| mxd-player/backend-player | Public player verification, team rules, and player SQLite persistence | Go + SQLite | `mxd-player/backend-player/cmd/mxd-player/main.go` | `cd mxd-player/backend-player; go run ./cmd/mxd-player` |

## Module registry

| Module ID | Capability | Implementation location(s) | Owner application(s) | Public contracts | Dependencies |
| --- | --- | --- | --- | --- | --- |
| player-registration | Player verification, character selection, locked teams, and invite joining | `mxd-player/backend-player`; `mxd-player/frontend-player` | player backend + player frontend | `player.verify`, `player.me`, `player.teams`, `player.teams.join` | player SQLite adapter |
| auth | Login sessions, three roles, account directory, and workspace permissions | `backend/src/modules/auth`; `frontend/src/App.tsx` | backend + frontend | `auth.*` | user/session persistence adapter |
| operation-groups | Request submission, approval, issue, completion, reminders, archive, and live counts | `backend/src/modules/operation-groups`; `frontend/src/modules/operation-groups`, `customer`, `manager` | backend + frontend | `operation-groups.*` | item-catalog, auth, persistence adapter |
| item-catalog | Catalog import, code/name mapping, fuzzy search, class search, and image mapping | `backend/src/modules/item-catalog`; `data/item-catalog/source` | backend + frontend consumer | `item-catalog.*` | CSV/JSON import adapters |
| activities | Shared activity/reward configuration and request shortcuts | `backend/src/modules/activities`; `frontend/src/modules/activities` | backend + frontend | `activities.*` | SQLite/JSON activity adapter, item-catalog |
| command-generation | Generate bounded executable command projections from validated operations | `backend/src/modules/command-generation` | backend | `command-generation.generate` | operation-groups immutable snapshots |
| player-directory | Workspace-gated player account/QQ lookup and CSV replacement | `backend/src/modules/player-directory`; `frontend/src/modules/player-directory` | backend + frontend | `player-directory.*` | directory persistence, mxd-player adapter |
| team-view | Daily locked-team projection, clear imports, and reward application | `backend/src/modules/team-view`; `frontend/src/modules/team-view` | backend + frontend | `team-view.*` | mxd-player snapshot adapter, persistence |
| player-integration | Persisted mxd-player connection gate, active endpoint, health, switching, and source synchronization | `backend/src/modules/player-integration`; `frontend/src/modules/server-operations` | backend + frontend | `player-integration.*` | mxd-player HTTP contract, service token |
| auto-integration | Persisted connection gate and HTTP-only adapter to independent mxd-auto-process; no auto database or Go package access | `backend/src/modules/auto-integration` | backend | `auto-integration.*` | auto `operator-api.v1`, service token |
| server-operations | Live game-server/account configuration, complete account login, status, reconnect, and chat UI | `frontend/src/modules/server-operations`; `frontend/src/App.tsx` | frontend + backend adapter | `auto-integration.*`, `player-integration.*` | auth workspace permission, auto HTTP API |

## Contract registry

| Contract ID | Kind/API/event | Canonical definition | Owner | Version | Consumers |
| --- | --- | --- | --- | --- | --- |
| auth.login | HTTP API | `docs/contracts/auth.md` | auth | v1 | frontend |
| auth.logout | HTTP API | `docs/contracts/auth.md` | auth | v1 | frontend |
| auth.me | HTTP API | `docs/contracts/auth.md` | auth | v1 | frontend |
| auth.list-users | HTTP API | `docs/contracts/auth.md` | auth | v1 | accounts workspace |
| auth.create-user | HTTP API | `docs/contracts/auth.md` | auth | v1 | accounts workspace |
| auth.update-user | HTTP API | `docs/contracts/auth.md` | auth | v1 | accounts workspace |
| auth.delete-user | HTTP API | `docs/contracts/auth.md` | auth | v1 | accounts workspace |
| operation-groups.* | HTTP API and SSE | `docs/contracts/operation-groups.md` | operation-groups | v1 | backend + frontend |
| item-catalog.search | HTTP API | `docs/contracts/item-catalog.md` | item-catalog | v1 | frontend |
| item-catalog.by-class | HTTP API | `docs/contracts/item-catalog.md` | item-catalog | v1 | frontend |
| activities.list | HTTP API | `docs/contracts/activities.md` | activities | v1 | frontend |
| activities.replace | HTTP API | `docs/contracts/activities.md` | activities | v1 | frontend |
| command-generation.generate | module interface | `docs/contracts/command-generation.md` | command-generation | v1 | backend manager projection |
| player-directory.* | HTTP API | `docs/contracts/player-directory.md` | player-directory | v1 | frontend |
| team-view.* | HTTP API | `docs/contracts/team-view.md` | team-view | v1 | frontend |
| player-integration.status | HTTP API | `docs/contracts/player-integration.md` | player-integration | v1 | server-operations |
| player-integration.switch | HTTP API | `docs/contracts/player-integration.md` | player-integration | v1 | server-operations |
| player-integration.connection | HTTP API | `docs/contracts/player-integration.md` | player-integration | v1 | server-operations, team-view |
| auto-integration.* | HTTP API adapter | `docs/contracts/auto-integration.md` | auto-integration | v1 | server-operations, operation-groups |
| auto-integration.connection | HTTP API | `docs/contracts/auto-integration.md` | auto-integration | v1 | server-operations |
| player.verify, player.me, player.teams, player.teams.join | HTTP API | `mxd-player/CONTRACTS.md` | player-registration | v1 | player frontend |

## Game-server integration boundary

The `server-operations` game-server surface is backed entirely by
`mxd-auto-process`. Auto owns its SQLite server catalog, encrypted account
credentials, sessions, runtime state, and audit log. This project only forwards
authenticated user actions through its HTTP adapter and never reads auto's
database or imports its Go internals.

Auto API and embedded production frontend default to `127.0.0.1:26909`; the
standalone Vite development/preview server uses `127.0.0.1:6909` and must not
be exposed publicly. The game-server page has no remote endpoint mode.
Separate-host deployment is supported by explicitly configuring the
backend adapter URL and the auto service token over a private network or an
HTTPS reverse proxy. The auto root page is read-only. Its `/operator` page
requires the initialized operator password and a first-login password change.

## Project constraints

```text
Backend performance target or budget: Bounded cursor lists; p95 <= 300 ms for local backend reads excluding external network/auth; operation batches <= 100; catalog responses <= 50 items; frontend live refresh must be visible-page and bounded.
Maximum application-source file size: <= 300 physical lines normally; 301-400 requires a documented exception; >400 must be split during the change.
Required data, security, or deployment constraints: IDs are opaque strings and timestamps are UTC RFC 3339. Role IDs remain decimal digit strings. Production persistence is SQLite behind module adapters. Credentials, service tokens, protocol keys, role opaque values, and raw TCP payloads never appear in customer responses or audit details. Auto account credentials (raw passwords or 16-character MD5 login values) are AES-GCM encrypted and write-only at its API boundary. Auto binds to loopback by default and remote separation requires an explicitly secured URL/token path.
Known project-specific exceptions: Test-only JSON repositories and captured PCAP/reference data are not production authorities. Generated build output and lockfiles are exempt from application-source line limits.
```

## Commands

```text
Start: `npm run dev` (or run backend, frontend, and auto separately)
Test: `npm test`; `cd mxd-auto-process/backend-auto-process; go test ./...`
Lint/format: `npm run lint`; `gofmt -w cmd internal`
Build: `npm run build`; `cd mxd-auto-process/backend-auto-process; go build ./...`
File-size/quality check: inspect `backend/src`, `frontend/src`, and `mxd-auto-process/backend-auto-process`/`frontend-auto-process` against AGENTS.md budgets
```

## Update rule

When adding an application, module, contract, dependency, or performance
constraint, update this map first and then its owning module/contract document.
Keep detailed behavior in exactly one canonical module or contract document.
