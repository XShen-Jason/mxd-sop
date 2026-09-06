# player-directory

Player account lookup and CSV import contracts for the operations desk.

## player-directory.search (v1)

`GET /api/v1/player-directory/search`

Authentication is required. `customer`, `manager`, and `super_admin` may use
the endpoint. Query parameters are:

- `q` optional text search, trimmed and limited to 64 characters. It matches
  server ID, user ID, game account, bind QQ, and character ID.
- `serverId` optional server ID from `operation-groups.options`.
- `limit` optional integer from 1 to 50, default 20.
- `cursor` optional opaque cursor returned by the previous page.

The response is bounded, ordered by `userId` (numeric IDs use natural numeric
ordering), and grouped by `(server, userId, username, bindQQ)`:

```json
{
  "accounts": [{
    "server": { "id": "mushroom", "displayName": "..." },
    "userId": "292",
    "username": "asd99293",
    "bindQQ": "8454349452",
    "characterIds": ["200"],
    "sourceFiles": ["hwn-char-user-qq.csv"]
  }],
  "nextCursor": null,
  "totalCount": 1
}
```

`commands`, passwords, session tokens, and CSV contents are never returned.

## player-directory.import (v1)

`POST /api/v1/player-directory/import`

Only `super_admin` may call this endpoint. The JSON body is
`{ "serverId": "mushroom", "file": { "name": "mg-char-user-qq.csv", "content": "..." } }`.
The file is no larger than 1,000,000 characters and the request is limited to
2 MiB. Supported names are `mg`, `xr`, `hwn`, `uu`, and `ppz` followed by
`-char-user-qq.csv`; the selected server must match the filename mapping. The
CSV header must contain `char_id,user_id,username,bindQQ` (case-insensitive).

The file is fully validated before a transactional repository replacement. It
replaces only the selected server's previous rows; other servers remain
unchanged. Invalid data rows are skipped and reported; malformed files, unsafe
values, and an empty valid result are rejected. A success response reports
`serverId`, `fileCount` (always 1), `rowCount`, `skippedRows`, and `importedAt`.

The operations desk keeps its own searchable copy in its configured
SQLite/JSON repository. In production, the import first calls the active
`mxd-player` service's internal account-import contract. The local directory is
replaced only after player SQLite accepts the transaction, so a failed player
sync cannot report a successful support upload.
