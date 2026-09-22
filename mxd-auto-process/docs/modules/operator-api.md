# operator-api

## Purpose

Expose a small versioned HTTP boundary for `mxd-auto-process`, serve the
embedded monitoring and standalone management pages, and keep the operations
desk independent from auto's Go packages and database.

## Scope

The API owns health and authenticated monitoring projections, operator authentication,
server/account CRUD, interactive login sessions with role selection and map
entry, complete account lifecycle controls, chat delivery, SSE snapshots, and
a bounded audit-log projection. Legacy session-level routes are retained for
direct operator clients and use the same authentication boundary.

## Authentication and deployment

- `GET /` serves the separated Vite/React application shell. The browser shows
  only the operator login screen until the HttpOnly session cookie is valid.
  `GET /api/v1/overview`, `/logs`, `/events`, and `/servers` require that
  authenticated operator cookie (or the service token for integrations).
- `/operator` is the control page. Login uses the `admin` operator initialized
  from `AUTO_INITIAL_PASSWORD`; a new database marks that password as
  `must_change`, and control requests remain blocked until it is replaced.
- Mutating routes accept either the HttpOnly `mxd_auto_operator` session cookie
  or `Authorization: Bearer <AUTO_SERVICE_TOKEN>`. The service token is for
  the separated game-support-ops backend; it cannot change the operator
  password.
- The default listener is `127.0.0.1:26909`. The page has no remote endpoint
  mode. If the two projects are deployed on different hosts, expose only a
  trusted private or HTTPS reverse-proxy route and configure the same service
  token in both applications.

## Ownership and invariants

- SQLite is authoritative for the server catalog, game accounts, operator
  state, and audit records. The JSON server file is only the first-run
  bootstrap when no catalog has been persisted.
- Account credentials are encrypted at rest with the local AES-GCM key. Each
  account records whether the write-only value is a raw password or an
  already-derived 16-character MD5 login value. Raw passwords use the protocol
  derivation; MD5 login values are sent unchanged. Credential values never
  appear in account snapshots, overviews, logs, or error responses.
- `POST /api/v1/servers/{serverId}/sessions` returns the authenticated session
  and its server-provided role list without persisting an account. The caller
  chooses a role through `POST /api/v1/sessions/{sessionId}/select-and-enter`;
  the session must reach `ready` before it can be bound to an account with
  `session_id`.
- Temporary setup sessions are closed through `DELETE /api/v1/sessions/{sessionId}`
  when setup is cancelled or restarted. Binding a ready session avoids a second
  password login and keeps the selected role on the same TCP connection.
- `POST .../start` and enabled account creation/update return immediately with
  a transitional account snapshot. The account manager performs login,
  character selection, and map entry in the background. Enabled accounts are
  automatically reconciled after a disconnect; `.../reconnect` provides a
  manual trigger.
- `.../stop` disables the account, stops its session, and closes the TCP
  connection. Server changes that affect a live connection stop old sessions
  before they are reconciled against the new definition.
- All request bodies are bounded and validated. Audit details retain method,
  path, actor, status, duration, redacted HTTP request/response bodies, and
  game-protocol request/response exchanges. Passwords, tokens, server keys,
  role opaque values, and heartbeat operation 19 are never retained.
- Normal snapshots expose delivery status and bounded chat counters. Explicit
  protocol diagnostic routes remain protected operator controls and are not
  used by the game-support-ops integration.

## Public surface

`POST /api/v1/servers/{serverId}/executions` accepts an `execution_id` and an
ordered command batch. It always sends `privateChat`, selects an enabled online
account using a persisted round-robin cursor, and stores one execution record
with per-command statuses. Reusing an ID with the same payload is idempotent;
`retry: true` continues only commands not marked successful.
Each command is one independent chat send. The batch transport never joins
multiple command texts into one chat message.

When the target server has no enabled online account, the response remains a
normal persisted `failure` response and includes `failure_reason:
no_online_accounts`. Consumers can distinguish this from a command delivery
failure and tell the requester that no online GM account is available.

An execution keeps the selected account for all of its remaining commands;
the next execution advances the round-robin cursor. The account is checked
again immediately before each send. A stopped, disabled, or no-longer-ready
account is removed from that execution before a chat frame is written, and the
next enabled online account is tried. Errors that may have happened after a
write are not automatically replayed on another account, preventing duplicate
item delivery.

If the game server responds with `请输入正确的玩家姓名。`, the response is
treated as an account-permission failure rather than a player-offline result.
The current account is excluded for the remainder of that execution and the
same command is retried on the next enabled online account. The switch is
bounded by the number of online accounts, so a permission failure cannot loop
forever; ordinary offline or unknown responses keep the existing failure
behavior and leave the execution retryable.

The canonical route and schema definition is
`mxd-auto-process/contracts/operator-api-v1.yaml`. The game-support-ops
adapter calls `/api/v1/overview?include_logs=false`, the temporary
setup-session login/selection/cleanup routes, server/account CRUD, `start`,
`stop`, `reconnect`, and `message` with the service token.

## Implementation

- `backend-auto-process/internal/operatorapi/routes.go` — route/auth dispatch
- `backend-auto-process/internal/operatorapi/auth.go` — operator login, password change, and logout
- `backend-auto-process/internal/operatorapi/overview.go` — read-only snapshot, logs, and SSE
- `backend-auto-process/internal/operatorapi/server_handlers.go` — server persistence/lifecycle
- `backend-auto-process/internal/operatorapi/account_handlers.go` — account persistence/lifecycle
- `backend-auto-process/internal/operatorapi/audit.go` — bounded redacted request audit
- `backend-auto-process/internal/operatorapi/assets/` — embedded read-only and operator pages

## Verification

Go tests cover route authorization, default pages, full session compatibility,
interactive role selection and account-session binding, operator
initialization/password change, login throttling, SQLite persistence, audit
redaction, account lifecycle, and reconnect behavior.
