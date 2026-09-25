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
- Creating or logging in an account returns a transitional state while
  auto performs login, character selection, and map entry asynchronously.
  Auto's watcher retries login-enabled accounts after a lost session. A failed
  or offline login-enabled account also has a manual reconnect action.
- Logging out clears login intent (`enabled`), exits the session, and closes
  the game TCP connection. Logging in requests the complete auto login flow.
  Neither changes the independent `automation_enabled` setting.
- Each account exposes a login/logout button and an automation switch. Online
  accounts can send manually with automation off. Only online accounts with
  automation enabled are eligible for automatic command batches. Switching
  automation does not start, stop, or reconnect a session. New accounts default
  to manual-only; a one-time migration preserves legacy participation.
- Account passwords are write-only at the API boundary. Editing may leave the
  password blank to retain the encrypted value in auto.
- Account setup selects either a raw password or an already-derived 16-character
  MD5 login value. The latter is forwarded unchanged and remains encrypted and
  write-only after persistence.
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

The GM quick-command forms keep editable drafts separate from the persisted
server reference values. Overview polling updates references without overwriting
drafts; selecting another server resets its form. Each command has its own
send action, always using private chat, and a restore-reference action. Only
positive safe integer parameters can be sent. Editing or sending a draft does
not change the stored reference configuration; it is not a live game-server
readback. The legacy `exp_max` field is the EXP duration in **minutes**, so
`exp@2@60` means 2x EXP for 60 minutes, not an experience cap.

Each quick-command card uses two compact rows: its name and saved reference
values above, then inline numeric inputs with units, reset, and send below.
The send tooltip retains the command preview; validation errors expand only
the affected card. Both frontends retain full accessible control labels.

Both UIs title this section `当前服务器配置` and show values with units without
the `参考` prefix. The reset label is `恢复当前配置`. The automation switch
always reads `自动化`; its checked state conveys eligibility. Account controls
share a 36px height, with equal-width automation and login/logout controls.

Both management server lists show each account's live status. Green requires
a fresh overview, an enabled server, login intent, `status: online`, and
`automation_enabled: true`. Online manual-only accounts and logged-out accounts
are gray; connecting/reconnecting or unconfirmed snapshots are yellow;
failed/offline accounts are red. The list renders only one aggregate status
circle. It prioritizes pending or transitional accounts, then failures, then
an automation-ready account, so a healthy account does not hide another
account's reconnect. Selection uses a separate neutral accent. Main
detail-header status uses the same projection;
service-connection health keeps its independent meaning. Existing two-second
polling supplies the data without per-account requests.

Quick commands and custom messages require a second confirmation before the
message request is submitted. The modal shows the selected server/address,
account/character, channel, and full message from the pending-send snapshot.
Cancel, close, and Escape preserve drafts and make no request. Confirmation
revalidates the target's identity and online/enabled state, and in-flight
submissions are locked against duplicate clicks. A retry requires a new
confirmation. This is a frontend interaction; the HTTP contract is unchanged.

UI boundary translations live in each independent frontend's
`QuickCommandPanel.tsx`; they follow `operator-api.v1` and are checked together
by `node frontend/tests/quick-commands.browser.cjs` (main frontend plus auto).
Its `server-list-status-checks.cjs` helper covers automation eligibility,
connection transitions, disabled servers, stale/recovered snapshots, mixed
accounts, distinct rendered colors, and desktop/mobile layout.

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

The message result panel retains themed status cards, command classification,
channel/content, raw server response, and complete response JSON. Main adapter
and game-server latencies use their existing response fields; raw content wraps
on mobile and does not grow beyond its bounded scroll region.
