# team-view

## team-view.import-clears (v1)

`POST /api/v1/team-view/clears/import` requires `super_admin`, like player-directory imports.
Body: `{ "serverId": "mushroom", "file": { "name": "9-8.csv", "content": "..." } }`.
One CSV, at most 1,000,000 characters, 20,000 rows, 2 MiB JSON request.
Required case-insensitive headers: `char_id`, `reason`, `created_at`.
Quoted fields, escaped quotes, BOM and CRLF are supported. IDs remain strings.
`created_at` is Beijing local time in `D/M/YYYY H:mm:ss` (8/9/2026 means
September 8), or `YYYY-MM-DD HH:mm:ss`; date-only variants are accepted.
No inference from filenames, current date, timezone conversion or preceding lock day.
Exact reasons `副本赞助点:黑龙` and `副本赞助点:进阶扎昆` map to
`black-dragon` and `zakum`. Other reasons are skipped and counted. Invalid
recognized rows reject the whole file before any write; no recognized rows is an error.
Records are atomically merged by (date, server, boss, char_id), so repeat uploads
are idempotent and partial uploads preserve earlier clears. Multiple dates are
stored separately. Response: `{ serverId, dates: ["2026-09-08"], rowCount,
skippedRows, importedAt }`; rowCount counts unique recognized rows in the file.
Errors: unauthorized (401), forbidden (403), unknown-server/invalid-file (400).

The read projection adds `clearedMembers: string[]` and `cleared: boolean` to
each team. All four matching dimensions must agree. `cleared` requires a
nonempty team with all members matched. `zakum` displays as `进阶扎昆`.
Clears persist independently of snapshot syncs, including uploads before a snapshot exists.

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
