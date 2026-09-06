# team-view

## Purpose

Provide an authenticated operations-desk view of the daily locked player teams
owned by the separately deployed `mxd-player` service.

## Scope

In scope:

- Persisting one immutable operations-desk snapshot per usage date.
- Reading a bounded, read-only projection for customer, manager, and
  super-admin users.
- Grouping the five configured servers, then `black-dragon` and `zakum`.
- Sorting teams within a type by member count descending, first join time
  ascending, and stable team ID; assigning the displayed sequence after that
  sort.
- A replaceable source adapter and a Beijing-time 00:05 scheduler.

Out of scope:

- Creating, editing, joining, leaving, approving, or locking teams.
- Accessing the `mxd-player` database directly.
- Player business rules remain out of scope; the read-only snapshot endpoint
  under `mxd-player` is an explicit integration contract.

## Ownership and invariants

- The operations desk owns its snapshot copy and never mutates player data.
- `date` is the usage date for the locked list. The scheduled run at 00:05
  fetches the next Beijing business date, so teams locked at the preceding
  midnight are shown for the following day.
- Character IDs are transported as digit-only strings.
- A projection always contains every configured server and both boss types,
  including empty groups.
- A failed source request never replaces the previous snapshot.

## Public surface

See `docs/contracts/team-view.md` for `team-view.read` (`GET
/api/v1/team-view`). The backend calls the player service's internal
full-snapshot endpoint through a replaceable `LockedTeamSource` port.

## Dependencies

- Authenticated identity from `auth`.
- Configured server options from `operation-groups`.
- SQLite in production or JSON in tests.
- Active player HTTP source selected by the `player-integration` capability;
  legacy full endpoint variables remain supported for migration.

## Data, configuration, and assets

Production snapshots are stored in `team_view_snapshots`. When the source URL
is absent, the scheduler stays idle until the future source endpoint is
configured; the read contract returns an `unavailable` status with empty
groups.

## Tests

The service tests cover date validation, deterministic ordering, complete
server/type grouping, source failures, and HTTP role access. The scheduler is
unref'ed and stopped through the Fastify close hook.

## Migration notes

The source adapter calls `/api/v1/internal/player/teams/snapshot`, because
`/api/v1/player/teams` is account-scoped. It never writes to player data and
keeps the read contract and persistence stable when the deployment is switched.
