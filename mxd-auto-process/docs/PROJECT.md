# Project Map

## Project identity

```text
Project ID: mxd-auto-process
Name: MXD game session operator
Purpose and users: Own game-server/account data, run complete game login flows, reconnect enabled accounts, deliver chat, and expose authenticated monitoring plus operator controls.
Scale: Standard
Primary languages: Go, TypeScript, React, CSS
Applications: backend, separated Vite operator frontend
```

## Application registry

| Application | Responsibility | Language/framework | Entry point | Commands |
| --- | --- | --- | --- | --- |
| backend | TCP session orchestration, persistence, reconnect watcher, and HTTP API | Go standard library | `backend-auto-process/cmd/mxd-auto-process/main.go` | `cd backend-auto-process; go run ./cmd/mxd-auto-process` |
| operator-frontend | Password-protected server/account monitoring, request tracing, and standalone auto-owned server management | Vite + React + TypeScript | `frontend-auto-process/src/main.tsx` | `cd frontend-auto-process; npm run dev`, `npm run build` |

## Module registry

| Module ID | Capability | Implementation location(s) | Owner application(s) | Public contracts | Dependencies |
| --- | --- | --- | --- | --- | --- |
| `game-session` | Framed TCP login, character selection, map entry, heartbeat, reconnect transport, and classified chat delivery | `backend-auto-process/internal/gameprotocol`, `backend-auto-process/internal/gamesession` | backend | `game-session.*` | Go net, configured server, optional PCAP source |
| `server-catalog` | Validated multi-server definitions, default runtime settings, and persisted catalog | `backend-auto-process/internal/servercatalog` | backend | `server-catalog.*` | JSON bootstrap file, SQLite persistence |
| `session-control` | Concurrent sessions, account lifecycle, automatic re-login, manual reconnect, limits, and bounded probes | `backend-auto-process/internal/sessioncontrol` | backend | `session-control.*` | game-session, server-catalog, auto store |
| `auto-store` | SQLite schema, AES-GCM account credential storage, operator password, and bounded audit log | `backend-auto-process/internal/autostore` | backend | `auto-store.*` | SQLite, local key file |
| `operator-api` | Versioned HTTP boundary, authenticated overview/events/logs, service-token access, operator password login, and control UI | `backend-auto-process/internal/operatorapi` | backend, operator-frontend | `operator-api.v1` | session-control, auto-store |

## Contract registry

| Contract ID | Kind/API/event | Canonical definition | Owner | Version | Consumers |
| --- | --- | --- | --- | --- | --- |
| `game-session.login` | TCP operation `op=0`, password-derived token | `docs/contracts/game-session-v1.md` | game-session | v1 | session-control |
| `game-session.select-character` | TCP operation `op=6` with automatic field 81 source resolution | `docs/contracts/game-session-v1.md` | game-session | v1 | session-control |
| `game-session.enter-map` | TCP operations `op=7`, `op=8` | `docs/contracts/game-session-v1.md` | game-session | v1 | session-control |
| `game-session.private-chat` | TCP operation `op=10` with supported chat channels and delivery classification | `docs/contracts/game-session-v1.md` | game-session | v1 | session-control |
| `operator-api.v1` | HTTP JSON, SSE, service-token/operator authentication, account lifecycle, and audit projection | `contracts/operator-api-v1.yaml` | operator-api | v1 | game-support-ops auto-integration, operator frontend |

## Project constraints

```text
Backend performance target or budget: 128 concurrent sessions by default; one serialized business request per TCP session; network reads/writes use context deadlines; account startup and reconnect are bounded; audit retention is capped at 5000 records and read responses at 200 records; visible operator screens refresh at most once every two seconds.
Maximum application-source file size: 300 physical lines; split during a change above that size.
Required data, security, or deployment constraints: The default HTTP listener is 127.0.0.1:26909. The operator frontend is built separately and copied into Go's embedded asset directory for deployment. The browser shows only the login screen until the operator cookie is valid; overview, server catalog, logs, and events require that cookie (or the service token for non-browser integrations). SQLite in auto is authoritative for servers, accounts, and audit logs. Game-account credentials (raw passwords or already-derived 16-character MD5 login values) are encrypted with the local AES-GCM key and never returned or written to audit details. Audit details include redacted HTTP request/response bodies and game request/response exchanges; heartbeat operation 19 is excluded.
Known project-specific exceptions: Captured PCAP artifacts in docs/ and datacj/ are reference data, not application source. The embedded operator assets are deliberately browser source and are served without a separate build step.
```

## Commands

```text
Start: `start.bat` (or `start.ps1`); backend `go run ./cmd/mxd-auto-process --config config/servers.json --listen 127.0.0.1:26909` from `backend-auto-process`
Test: `cd backend-auto-process; go test ./...`
Lint/format: `cd backend-auto-process; gofmt -w cmd internal; go vet ./...`
Build: `cd backend-auto-process; go build ./...`
Frontend build: `cd frontend-auto-process; npm run build`
Frontend test/lint: `cd frontend-auto-process; npm test; npm run lint`
File-size/quality check: `Get-ChildItem -Recurse -File -Include *.go,*.ts,*.tsx | ForEach-Object { if ((Get-Content $_.FullName).Count -gt 300) { $_.FullName } }`
```
