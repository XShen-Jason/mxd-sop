# server-operations

## Purpose

Provide the authenticated `server-operations` workspace for configuring game
servers and operating their accounts through `mxd-auto-process`. The workspace
also retains the existing `mxd-player` connection tab.

## Ownership and invariants

- `mxd-auto-process` is the authority for game-server definitions, encrypted
  account credentials, sessions, runtime status, and request audit records.
- The main application's backend is an HTTP adapter. It never imports auto's
  Go packages, reads auto's database, or stores game-account passwords.
- The browser talks only to the main application's `/api/v1/auto/*` routes.
  Those routes call the corresponding auto API with the configured service
  token.
- The `mxd-player` and `mxd-auto-process` cards expose independent persisted
  connection switches beside their integrated status. Each switch requires a
  confirmation dialog. Disconnecting gates HTTP traffic; it never terminates
  either independent project or auto's existing game sessions.
- A disabled auto connection stops overview polling in the browser. Status
  reads remain local and do not call auto; all other adapter requests fail
  before network I/O.
- While auto is disabled, operation approvals and no-review submissions use the
  existing manual `approved` workflow. Commands remain available in the ready
  workspace, no automation failure is recorded, and reconnecting does not
  automatically dispatch that backlog.
- Auto defaults to `http://127.0.0.1:26909`. The game-server page exposes no
  remote endpoint mode. A separated deployment may set an explicit auto URL
  and token in backend configuration; that connection must use a trusted
  private network or HTTPS reverse proxy.
- Auto's account status is authoritative. The page refreshes status and the
  server overview every two seconds while visible and cancels requests when
  the page is hidden or unmounted.
- Creating, starting, or enabling an account returns a transitional state while
  auto performs login, character selection, and map entry asynchronously.
  Auto's watcher retries enabled accounts after a lost session. A failed or
  offline enabled account also has a manual reconnect action.
- Closing an account disables it, exits the session, and closes the game TCP
  connection. Starting it again requests the complete auto login flow.
- Account passwords are write-only at the API boundary. Editing may leave the
  password blank to retain the encrypted value in auto.
- Adding an account is an interactive flow: the first step calls auto's
  session-login endpoint, the returned server role list is shown in the second
  step, and the selected role is sent to `select-and-enter`. Only after the
  session is game-ready does the browser create the persisted account, passing
  `session_id` so auto binds that session instead of logging in twice.
- Returning from role selection to the credential step, or cancelling the
  dialog, stops the temporary setup session. The selected role is never
  accepted from browser-only state; auto validates the session and role at its
  HTTP boundary.
- Deleting an account, closing an account, and deleting a server require a
  danger confirmation. The player-service endpoint switch keeps its existing
  confirmation flow.

## Public boundary

When connected, support command batches are submitted by the operation-groups
workflow and auto-process owns online-account selection, private-chat delivery,
retry progress, and execution deduplication. When disconnected, the existing
ready workspace remains the manual copy/confirm execution surface.

The main application exposes these adapter operations:

- auto status and overview;
- auto connection status and confirmed enable/disable;
- temporary setup-session login, role selection, and map entry;
- server create, update, and delete;
- account create, update, and delete;
- account start, stop, reconnect, and message delivery.

The canonical remote contract is
`mxd-auto-process/contracts/operator-api-v1.yaml`. Auto's `/` page is a
read-only monitoring view of the auto database and its redacted audit log.
`/operator` is the password-protected control page. Its initial `admin`
password is supplied by `AUTO_INITIAL_PASSWORD` (default for a new local
database: `ChangeMe-26909!`) and must be changed on first login.

The account-message response includes the game-session delivery classification,
the bounded `game_server_response_latency_ms` measurement from auto to the
game server, and the main backend adapter's `auto_process.latency_ms`
measurement from this project to auto-process. The server-operations message
panel exposes only those timings/statuses plus command analysis, message type,
message content, the raw server response, and the complete response content.

## Implementation

- `backend/src/modules/auto-integration/`
- `frontend/src/modules/server-operations/`
- `frontend/src/App.tsx`
- `frontend/src/styles-server-operations.css`
- `frontend/tests/server-operations.browser.cjs`
- `mxd-auto-process/backend-auto-process/internal/operatorapi/`
- `mxd-auto-process/backend-auto-process/internal/sessioncontrol/`
- `mxd-auto-process/backend-auto-process/internal/autostore/`

## Verification

Backend integration tests cover the adapter boundary and authorization. Auto's
Go tests cover SQLite persistence, encrypted credentials, lifecycle and
reconnect behavior, operator authentication, audit redaction, and HTTP routes.
The browser test mocks only the main application's auto adapter endpoints and
covers online/offline status, two-second refresh, account/server CRUD,
temporary login sessions, role selection, map entry, start/stop/reconnect,
messaging, danger confirmations, and desktop/mobile overflow.
