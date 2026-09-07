# Contracts

## player.verify

Owner: player-registration  
Version: v1  
Request: `{ server, qq, gameAccount }`. `server` must be one of `蘑菇`, `雪人`,
`红蜗牛`, `UU`, `漂漂猪`; `qq` is 5–16 ASCII digits and `gameAccount` is 1–64
ASCII letters, digits, `_`, or `-`.  
Response: `{ token, account: { server, qq, gameAccount, characters[] } }`  
Errors: `invalid-input`, `account-not-found`, `internal-error`  
Authentication: none. The selected server must be one of the published server names.

## player.me

`GET /api/v1/player/me` returns `{ account }` for a valid bearer token issued by
`player.verify`. It is used to restore the player session after a browser
refresh. Invalid or expired tokens return `unauthorized`.

## player.teams

Owner: player-registration  
Version: v1  
GET response: `{ teams[], applications[], history[], day }`. POST request:
`{ bossType, characterId }`. A successful create returns the team and a
six-character invite code. The opaque team ID is omitted from JSON. Errors
include `unauthorized`, `character-not-owned`, `already-in-team`, and
`internal-error`.
Every successful create targets the next Beijing business day; the team and
its invite stop being mutable or joinable when that target day starts at 00:00.

## player.teams.history

Owner: player-registration. Version: v1.
`GET /api/v1/player/teams/history?date=YYYY-MM-DD` requires a player bearer
token. Omitted or empty date defaults to the current Beijing day. Dates after
today, invalid dates, and dates at or before the legacy unknown-date sentinel
`1970-01-01` return `invalid-input`.
Response: `{ day, today, teams: [{ bossType, members: [{ characterId, isLeader }] }] }`.
Only active teams where the authenticated account is a confirmed member on
that exact date are included. A pending/rejected application grants no access.
At most two teams and 20 members are returned; no matches returns `teams: []`.
The roster is the retained membership locked at Beijing midnight, not an
application history or proof of an actual Boss kill. Team IDs, invite codes,
account details and pending requests are omitted. Existing join/create APIs
continue to target tomorrow exclusively.

## Related team operations

`player.servers` is `GET /api/v1/player/servers` and returns the published
server names. `player.teams.preview` is `POST /api/v1/player/teams/preview`
with `{ inviteCode }` and returns the invite's boss, day, and member count
before the role picker opens. `player.teams.approve` is
`POST /api/v1/player/teams/approve` with `{ requestId }` and returns the updated
team after a leader approves a pending application. `player.teams.leave` is
`POST /api/v1/player/teams/leave` with `{ inviteCode }`; a non-leader member can
leave directly and the approved application is recorded as rejected. Leaders
cannot leave their own team; errors include `unauthorized`, `team-not-found`,
`not-in-team`, and `leader-cannot-leave`. `player.teams.merge` and
`player.teams.merge.approve` use the two merge endpoints described below.
`player.teams.reject` is `POST /api/v1/player/teams/reject` with `{ requestId }`;
the team leader can reject a pending application, which remains in the
applicant's history with `reason: "leader-rejected"`.

## player.teams.join

Owner: player-registration  
Version: v1  
Request: `{ inviteCode, characterId }`. The invite is normalized to uppercase;
the account and selected character are checked in one transaction. Errors:
`invalid-input`, `team-not-found`, `server-mismatch`, `team-full`,
`already-in-team`, `already-applied`, `character-not-owned`. Each account has
at most one application and one membership row per team. Repeating a pending
application with the same character returns `already-applied`; repeating it
with another character updates the existing pending row and reuses its request
ID, so the leader sees the replacement character without an extra request.

## Daily approval rules (v2 behavior)

All team and application records are scoped to the Beijing business day
(`Asia/Shanghai`, reset at 00:00). Old invite codes are not accepted after the
boundary. A team created during a calendar day is assigned to the next Beijing
business day and becomes locked when that target day starts at 00:00 Beijing
time. A player may create or apply to multiple teams, but a transaction allows
at most one approved team per boss for that day. Applications remain in
`player_team_applications` as the player's join history.

`POST /api/v1/player/teams/join` creates a `pending` application and returns
HTTP 202. It never grants membership. The leader approves with
`POST /api/v1/player/teams/approve` and `{ requestId }`; approval atomically
checks capacity and the one-team-per-boss rule. A member can leave with
`POST /api/v1/player/teams/leave` before the target day locks; the leader cannot
leave and there is no leader kick operation. Only active team records count when
checking whether an account is a locked leader; a merged source team no longer
blocks that account from applying to another team.

When an account is approved into or creates a team for a boss, all of that
account's other pending applications for the same boss and day are rejected in
the same transaction with `reason: "joined-other-team"`. This keeps the other
leaders' pending lists accurate and tells the player why those applications
closed. Application history may also report `left-team` or `team-merged`.

`POST /api/v1/player/teams/preview` validates an invite before the role picker
opens and returns the boss type. It rejects an already-approved membership and
keeps a leader locked to their own team for that boss.

`POST /api/v1/player/teams/merge` accepts `{ sourceInviteCode,
targetInviteCode }` from a leader. The target leader receives one pending
whole-team request with the source member count. `POST
/api/v1/player/teams/merge/approve` accepts `{ requestId }`; it rechecks the
combined capacity transactionally, moves all source members into the target,
and marks the source team merged.

`GET /api/v1/player/teams` returns `{ teams, applications, history, day }`.
Leader-owned teams include `pendingRequests` containing only request ID,
character ID, and request time; account usernames are never returned in team
or approval data. Team IDs remain private.

## Operations integration (internal)

`POST /api/v1/internal/player/accounts/import` requires `Authorization: Bearer
<PLAYER_SERVICE_TOKEN>` and accepts `{ serverId, file: { name, content } }`.
The player backend validates the canonical server/file mapping and
`char_id,user_id,username,bindQQ` rows, then upserts accounts and characters in
one SQLite transaction. It returns `{ serverId, rowCount, skippedRows,
importedAt }`. It does not write the CSV to disk or delete accounts, sessions,
teams, or memberships. Replaying the same file is safe: account and character
rows are upserted through unique keys.

`GET /api/v1/internal/player/teams/snapshot?date=YYYY-MM-DD` uses the same
service token and returns `{ date, teams: [{ id, serverId, bossType, createdAt,
members: [{ characterId, joinedAt }] }] }`. It contains no account names, QQ,
session tokens, invite codes, or pending requests. The response is bounded to
the first 500 active teams by creation order, with every selected team's
members included.
