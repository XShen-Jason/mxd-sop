# auto-integration

The main backend owns this adapter contract. Its downstream remote boundary is
`mxd-auto-process/backend-auto-process/contracts/operator-api-v1.yaml`.

## auto-integration.status (v1)

`GET /api/v1/auto/status` requires the `server-operations` workspace. It returns
`{ enabled, endpoint, configured, available, checkedAt }`. The service token is
never returned. When `enabled` is false, `available` is null and no request is
sent to `mxd-auto-process`.

## auto-integration.connection (v1)

`POST /api/v1/auto/connection` requires the `server-operations` workspace.
Body: `{ "enabled": false, "confirmation": "CHANGE AUTO CONNECTION" }`.
The exact confirmation is required. Disabling persists the local adapter gate
without stopping auto, its accounts, or its game-server sessions. Enabling
performs one health check and persists only after success.

While disabled, every `/api/v1/auto/*` operation except status and connection
control fails with `connection-disabled` (503) before a downstream HTTP request
is created. Operation-group automation uses the same gate, but treats an
intentional disabled state as a manual-workflow selection: approval and
no-review submission remain `approved`, expose their existing manager command
projection, and do not create an automation failure or reminder. Re-enabling
the connection does not dispatch previously approved work automatically.

## Forwarded operations (v1)

Overview, setup sessions, server/account CRUD, account lifecycle, messaging,
and execution routes retain the mappings registered in `docs/CONTRACTS.md`.
The adapter sends the configured service token and authenticated actor headers;
credentials remain write-only.

Setup-session login and account create/update accept `credential_type` with
`password` (default) or `md5`. In `md5` mode the credential must be the final
16-character hexadecimal login value; every layer forwards it unchanged to
auto, which persists it encrypted and sends it unchanged to the game server.
Account projections expose only `credential_type`, never the credential value.

Standalone sessions support GET /api/v1/auto/sessions/:sessionId for current
state and POST /api/v1/auto/sessions/:sessionId/chat for {message, mode}.
GET does not prolong or stop the game session. DELETE is explicit logout.
Standalone sessions are not registered as automation accounts. Heartbeats run
inside auto independently of browser requests. The potential editor restores
a session reference only after server ID and creation timestamp also match.

Server create accepts an optional `version`; auto persists `1.0.2` when it is
omitted. Server update accepts `version` as an independent per-server override,
and changing it restarts that server's managed account sessions.

Server projections include saved reference values `spawn_rate`, `exp_rate`,
`exp_max`, `drop_rate`, `meso_rate`, and `domain_times`. `exp_max` is the legacy
wire name for EXP duration in minutes; it is not an EXP cap. Quick-command
drafts use the existing account-message route with `mode: privateChat`.
Sending a command does not update the saved reference values or prove they
match the game server's current state.

## Independent account login and automation

Account snapshots and create/update bodies add `automation_enabled`. It defaults
to false for new accounts. Existing accounts migrate this value from their old
`enabled` value once, preserving prior automation participation. `enabled` now
explicitly represents login intent and reconnect, not automation eligibility.
`start`/`stop` log in/out without changing `automation_enabled`. A PATCH containing
only `automation_enabled` does not reconnect or terminate the session. Manual
messages require a logged-in account; automation additionally requires
`automation_enabled`, checked before each command. Both independent frontends
expose login/logout and an automation switch.
