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

Server create accepts an optional `version`; auto persists `1.0.2` when it is
omitted. Server update accepts `version` as an independent per-server override,
and changing it restarts that server's managed account sessions.
