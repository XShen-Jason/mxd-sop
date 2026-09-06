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

## player.teams

Owner: player-registration  
Version: v1  
GET response: `{ teams[] }`. POST request: `{ bossType, characterId }`. A
successful create returns the team and a six-character invite code. The opaque
team ID is omitted from JSON. Errors include `unauthorized`,
`character-not-owned`, `already-in-team`, and `internal-error`.

## player.teams.join

Owner: player-registration  
Version: v1  
Request: `{ inviteCode, characterId }`. The invite is normalized to uppercase;
the account and selected character are checked in one transaction. Errors:
`invalid-input`, `team-not-found`, `server-mismatch`, `team-full`,
`already-in-team`, `character-not-owned`.

## Daily approval rules (v2 behavior)

All team and application records are scoped to the Beijing business day
(`Asia/Shanghai`, reset at 00:00). Old invite codes are not accepted after the
boundary. A player may create or apply to multiple teams, but a transaction
allows at most one approved team per boss for that day. Applications remain in
`player_team_applications` as the player's join history.

`POST /api/v1/player/teams/join` creates a `pending` application and returns
HTTP 202. It never grants membership. The leader approves with
`POST /api/v1/player/teams/approve` and `{ requestId }`; approval atomically
checks capacity and the one-team-per-boss rule. There is deliberately no
remove/kick contract for the current day.

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
Leader-owned teams include `pendingRequests`; team IDs remain private.
