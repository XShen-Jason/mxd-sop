# player-integration

## player-integration.status (v1)

`GET /api/v1/player-integration/status`

Any authenticated user with the `server-operations` workspace may call this
endpoint. It returns the persisted `enabled` connection state, active mode, a sanitized active endpoint
URL, and bounded health results for the configured local and remote endpoints.
Service tokens are never returned. When `enabled` is false, configured endpoint
metadata is returned with `available: null`; the status request performs no
remote health checks.

## player-integration.connection (v1)

`POST /api/v1/player-integration/connection`

Any authenticated user with the `server-operations` workspace may call this
endpoint. Body: `{ "enabled": false, "confirmation": "CHANGE PLAYER CONNECTION" }`.
The exact confirmation is required. Disabling is persisted immediately and
does not stop `mxd-player`. Enabling first performs one health check against the
active configured endpoint and persists only after success.

While disabled, account imports and snapshot endpoint resolution fail before
an HTTP request is created. The `team-view` scheduler aborts an in-flight fetch,
does not log the intentional pause as a failure, and does not perform remote
retries. The stable direct integration error is `connection-disabled` (503);
owning consumers may translate it to their existing boundary error.

## player-integration.switch (v1)

`POST /api/v1/player-integration/switch`

Any authenticated user with the `server-operations` workspace may call this endpoint. The body is:

```json
{ "mode": "local", "confirmation": "SWITCH PLAYER SERVER" }
```

`mode` may be `local` or `remote`. The server requires the exact confirmation
text, verifies that the target endpoint is configured and healthy, then stores
the mode. A failed health check leaves the current mode unchanged.

The active endpoint is also used by `player-directory.import` and the daily
`team-view` snapshot fetch.

The local endpoint may use loopback HTTP. Remote endpoint configuration must
use HTTPS so the service bearer token is not sent in plaintext between servers.
