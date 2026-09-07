# team-view

## team-view.read (v1)

`GET /api/v1/team-view`

Authentication is required. `customer`, `manager`, and `super_admin` may read
the endpoint. The optional `date` query parameter is the usage date in
`YYYY-MM-DD` (Beijing calendar). When omitted, the current Beijing lock date
is used.

The response is bounded to the configured five servers and two boss types:

```json
{
  "date": "2026-09-08",
  "fetchedAt": "2026-09-07T16:05:03.000Z",
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
server/type group. Not-yet-synced snapshots return all groups with
`sourceStatus: "unavailable"` and `fetchedAt: null`. A successful sync with no
teams returns `sourceStatus: "ready"` and a non-null `fetchedAt`.

The daily pull runs at 00:05 Beijing for that same date. Startup after 00:05
re-fetches today's snapshot; failures retry at one-minute intervals. Older
dates require the deployment repair command. GET only reads the saved snapshot.

The source adapter consumes the player service internal full-snapshot response
shaped as `{ "date", "teams": [{ "id", "serverId", "bossType", "createdAt",
"members": [{ "characterId", "joinedAt" }] }] }`. This is an integration
boundary only; it does not authorize or modify player operations. It uses the
same active local/remote player endpoint selected for account imports.

Stable errors include `unauthorized`, `invalid-date`, and
`source-unavailable`.
