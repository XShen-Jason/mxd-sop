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
- `POST .../start` and login-enabled account creation/update return immediately with
  a transitional account snapshot. The account manager performs login,
  character selection, and map entry in the background. Enabled accounts are
  automatically reconciled after a disconnect; `.../reconnect` provides a
  manual trigger.
- `.../stop` clears login intent, stops its session, and closes the TCP
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
ordered command batch. It always sends `privateChat`, selects an automation-enabled online
account using a persisted round-robin cursor, and stores one execution record
with per-command statuses. Reusing an ID with the same payload is idempotent;
`retry: true` continues only commands not marked successful.
Each command is one independent chat send. The batch transport never joins
multiple command texts into one chat message.

When the target server has no automation-enabled online account, the response remains a
normal persisted `failure` response and includes `failure_reason:
no_online_accounts`. Consumers can distinguish this from a command delivery
failure and tell the requester that no online GM account is available.

An execution keeps the selected account for all of its remaining commands;
the next execution advances the round-robin cursor. The account is checked
again immediately before each send. A stopped, disabled, or no-longer-ready
account is removed from that execution before a chat frame is written, and the
next automation-enabled online account is tried. Errors that may have happened after a
write are not automatically replayed on another account, preventing duplicate
item delivery.

If the game server responds with `请输入正确的玩家姓名。`, the response is
treated as an account-permission failure rather than a player-offline result.
The current account is excluded for the remainder of that execution and the
same command is retried on the next automation-enabled online account. The switch is
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
- `backend-auto-process/internal/operatorapi/account_handlers.go` — account CRUD and automation setting
- `backend-auto-process/internal/operatorapi/account_actions.go` — login/logout/reconnect and manual messages
- `backend-auto-process/internal/operatorapi/audit.go` — bounded redacted request audit
- `backend-auto-process/internal/operatorapi/assets/` — embedded read-only and operator pages

## Verification

Go tests cover route authorization, default pages, full session compatibility,
interactive role selection and account-session binding, operator
initialization/password change, login throttling, SQLite persistence, audit
redaction, account lifecycle, and reconnect behavior.

Server records in the operator overview and server create/update responses include the persisted quick command settings (`spawn_rate`, `exp_rate`, `exp_max`, `drop_rate`, `meso_rate`, `domain_times`). The management UI sends the corresponding `spawnrate@`, `exp@`, `droprate@`, `mesorate@`, and `domaintimes@` strings through the existing private chat message route.

`exp_max` is the legacy wire name for the EXP duration in minutes. The operator
UI exposes it as duration, with independently editable quick-command drafts,
per-command send/reset actions, and saved reference values beside the inputs.
Polling does not overwrite drafts; switching servers resets form state.
Quick commands and custom messages open a second-confirmation modal on submit.
It shows the server/address, account/character, channel, and complete message
snapshot. Only confirming dispatches the existing message API request; cancel,
close, and Escape preserve drafts without sending. The target is revalidated
before dispatch, duplicate in-flight clicks are ignored, and retries require
a new confirmation. Editing, reset, and refresh never send commands.
Saved references are not relabeled as live game state after delivery (including
unknown/failed delivery). The main and auto frontends are independently built;
their UI translations of this contract have a joint browser regression at
`frontend/tests/quick-commands.browser.cjs` in the parent workspace.

## Independent login and automation

`enabled` retains persisted login/reconnect intent. `automation_enabled` is a
separate persisted eligibility flag. New accounts default to false; the SQLite
migration copies the old `enabled` value once for existing accounts, atomically
with column creation. Restarting does not repeat that backfill.

A PATCH with only `automation_enabled` updates eligibility under the account
lock using current stored login intent. It cannot log in/out or reconnect even
if another request changed the session since the HTTP snapshot. `start` and
`stop` preserve eligibility. Manual message delivery does not check automation;
execution selection and every `ChatIfOnline` call do. A command already being
sent may finish before the toggle is acknowledged; subsequent commands see the
new value. Existing two-second polling and bounded request sizes are unchanged.

Both UIs expose login/logout separately from the automation switch and preserve
message confirmation. The switch label is always `自动化`; all account-row
actions share one height, with equal-width automation and login/logout controls.
Configuration cards show their values without the `参考` prefix under
`当前服务器配置`; this presentation does not change the saved-value semantics.
Management server lists show each account's status from the existing overview.
Only fresh, online, login-enabled accounts on enabled servers with automation
enabled are green. Connecting/reconnecting and unconfirmed snapshots are yellow;
failed/offline accounts are red, and manual-only or logged-out accounts are gray.
The server list renders only the aggregate status circle; indicators prioritize
transitions/unconfirmed state, failures, then automation availability. Refresh
failures invalidate the status until a successful overview; management polling
allows one in-flight overview and aborts it on unmount. It retains the existing
two-second interval and introduces no extra account requests. These are client
projections of the existing contract, verified together in the parent browser
regression; each frontend keeps its own build boundary.
Response panels display themed status cards, channel,
content, raw server reply, timing, and complete JSON. Regression coverage is in
`account_automation_test.go`, the account-manager and SQLite migration tests,
and the parent workspace's mocked two-frontend browser regression.
