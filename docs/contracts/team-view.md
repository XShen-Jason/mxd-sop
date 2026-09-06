# team-view

## team-view.read (v1)

`GET /api/v1/team-view`

Authentication is required. `customer`, `manager`, and `super_admin` may read
the endpoint. The optional `date` query parameter is the usage date in
`YYYY-MM-DD` (Beijing calendar). When omitted, the next Beijing business date
is used.

The response is bounded to the configured five servers and two boss types:

```json
{
  "date": "2026-09-08",
  "fetchedAt": "2026-09-07T00:05:03.000Z",
  "sourceStatus": "ready",
  "servers": [{
    "server": { "id": "mushroom", "displayName": "..." },
    "types": [{
      "type": "black-dragon",
      "displayName": "...",
      "teams": [{
        "id": "team-id",
        "sequence": 1,
        "memberCount": 10,
        "members": ["1001", "1002"]
      }]
    }, { "type": "zakum", "displayName": "...", "teams": [] }]
  }]
}
```

Teams are sorted by member count descending, then earliest member join time,
then the opaque team ID. `sequence` is assigned after sorting within each
server/type group. Empty or not-yet-synced snapshots still return all groups
with `sourceStatus: "unavailable"` and `fetchedAt: null`.

The source adapter consumes the player service internal full-snapshot response
shaped as `{ "date", "teams": [{ "id", "serverId", "bossType", "createdAt",
"members": [{ "characterId", "joinedAt" }] }] }`. This is an integration
boundary only; it does not authorize or modify player operations. It uses the
same active local/remote player endpoint selected for account imports.

Stable errors include `unauthorized`, `invalid-date`, and
`source-unavailable`.
