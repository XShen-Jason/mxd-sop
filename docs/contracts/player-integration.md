# player-integration

## player-integration.status (v1)

`GET /api/v1/player-integration/status`

Only `super_admin` may call this endpoint. It returns the persisted active
mode, a sanitized active endpoint URL, and bounded health results for the
configured local and remote endpoints. Service tokens are never returned.

## player-integration.switch (v1)

`POST /api/v1/player-integration/switch`

Only `super_admin` may call this endpoint. The body is:

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
