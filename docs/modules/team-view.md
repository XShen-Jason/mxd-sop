# team-view

## Purpose

Provide an authenticated operations-desk view of the daily locked player teams
owned by the separately deployed `mxd-player` service.

## Scope

Also owns persisted CSV clear imports (`team-view.import-clears`), exact
server/date/boss/character matching and per-member/whole-team status. Upload
permissions and parsing semantics are defined in the contract. This data does
not mutate the player service and is independent of snapshot replacement.

In scope:

- Persisting one operations-desk snapshot per lock date, replaceable by a sync.
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
  fetches the current Beijing date: September 7 registrations lock at
  September 8 00:00 and are fetched as September 8 at 00:05.
- Startup after 00:05 re-fetches today's snapshot, including existing empty
  snapshots saved prematurely by older versions. Before 00:05 it waits.
- Failures retry after 60 seconds, with one request in flight. Success resumes
  daily scheduling. A retry crossing midnight waits for the new day's 00:05;
  older missed dates can be repaired with `backend/dist/src/sync-team-view.js`.
- Character IDs are transported as digit-only strings.
- A projection always contains every configured server and both boss types,
  including empty groups.
- A failed source request never replaces the previous snapshot.

## Public surface

See `docs/contracts/team-view.md` for `team-view.read` (`GET
/api/v1/team-view`). The backend calls the player service's internal
full-snapshot endpoint through a replaceable `LockedTeamSource` port.

## Dependencies

Reward application is orchestrated in application/apply-rewards.ts using
player-directory.findCharacters and operation-groups.submitApprovedBatch.
Eligibility and reward configuration belong to team-view; normalized group
validation, atomic persistence and approval audit belong to operation-groups.
The public contract team-view.apply-rewards defines limits and deduplication.
Regression coverage is in backend/tests/team-rewards.test.ts, including JSON,
SQLite rollback, HTTP submission, review projections and restart deduplication.

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

Clear records live in `team_view_clears`, created by the idempotent SQLite
startup migration, with a date-leading composite primary key. JSON tests use
a separate `.clears.json` file. CSV syntax is parsed by `csv-parse`; parsing
and row validation finish before one atomic merge. No polling is added.
`backend/tests/team-clears.test.ts` covers the supplied export, exact date,
server and boss isolation, partial/full clears, invalid-file atomicity,
deduplication, adapter persistence and HTTP permissions.

## Tests

The service tests cover date validation, deterministic ordering, complete
server/type grouping, source failures, and HTTP role access. Scheduler regression
tests cover Beijing dates, startup repair, retries, and shutdown. The scheduler
is unref'ed; the Fastify close hook drains an in-flight sync before closing SQLite.

The deployment command `backend/dist/src/sync-team-view.js YYYY-MM-DD` repairs one
locked date through the same source and service contracts. It requires an
existing absolute `DATABASE_PATH` and uses the configured active player endpoint.

## Migration notes

The source adapter calls `/api/v1/internal/player/teams/snapshot`, because
`/api/v1/player/teams` is account-scoped. It never writes to player data and
keeps the read contract and persistence stable when the deployment is switched.
