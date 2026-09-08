# PERFORMANCE.md

## Priority

Backend correctness and predictable resource use are the default priority.
Frontend code must not create avoidable backend load.

Record concrete targets in PROJECT.md when performance matters. Measure before
optimizing and keep the measurement with the relevant application or module.

## Backend boundaries

- Bound query size, result size, and in-memory work.
- Avoid unbounded loops, N+1 access, and work in request paths that can be
  asynchronous.
- Use explicit timeouts, retry limits, idempotency, and cancellation.
- Choose indexes, caching, queues, and connection limits from measured needs.
- Keep expensive or provider-specific work behind an application boundary.
- Do not trade correctness or contract stability for an unmeasured optimization.

## Frontend boundaries

- Request only the data and actions the screen needs.
- Use pagination, caching, debouncing, and cancellation where appropriate.
- Do not add uncontrolled polling, duplicate requests, or oversized payloads.
- Keep presentation effects and styling independent of backend execution.

## Contract requirements

Where relevant, contracts state limits, pagination, timeout behavior, retry
semantics, and whether an operation is synchronous or asynchronous.

## Review trigger

Review the backend impact whenever a change adds a request, enlarges a payload,
changes a query, adds polling, or introduces a synchronous external call.

Operation-group records use bounded keyset pagination in the persistence adapter.
Archive keyword searches run in SQLite against specific JSON snapshot fields
before LIMIT; only a bounded result page is decoded and projected. Substring
search may scan candidate records and does not use a text index. The UI submits
on Enter or the search button rather than issuing a request per keystroke.
Review, archive, and own-record filters are applied before payload projection;
the frontend requests only the active workspace page and guards continuation
requests against duplicate clicks.

Operation-group collaboration uses one authenticated SSE connection per active
browser session. Events contain no record payload and are emitted only after a
write; clients coalesce bursts within 50 ms before refreshing only an affected
active workspace. Navigation counts refresh only on membership changes, and
hidden tabs defer requests until visible, with no interval polling. Reminder
lists are filtered and paginated in SQLite.

Frontend GET requests use a short-lived in-memory cache keyed by role and full
request URL, and concurrent reads for the same key share one promise. Mutations
and SSE changes invalidate the cache; login/logout also closes the shared SSE
connection so credentials are never reused across sessions.

The player directory uses indexed SQLite fields, grouped bounded queries, a
maximum page size of 50, and one server-scoped transactional replacement for
each CSV import. The frontend debounces directory searches and cancels obsolete
requests; it does
not poll or download the raw CSV snapshot.

The team-view workspace reads one bounded snapshot row per date. Its frontend
does not poll; a user-triggered refresh is a single GET and normal GET caching
coalesces concurrent requests. The backend scheduler performs one external
fetch at Beijing 00:05 for the current lock date and one catch-up fetch on
startup after 00:05. Failed requests retry after 60 seconds with a 10-second
timeout, at most one request in flight, and no write when the source fails.
Success resumes daily scheduling. The scheduler stays idle when no source is configured. Snapshots
are replaced atomically in SQLite/JSON adapters.

Clear imports accept at most 1,000,000 CSV characters and 20,000 data rows,
with a 2 MiB HTTP body limit. Each import validates before one atomic merge.
Read projections retrieve only the requested date through the date-leading
primary key and match members using a set; no per-team database requests or
player-service writes are introduced. Upload success triggers one snapshot GET.

Player integration keeps one bounded account-import request per CSV and sends
the validated file once to the active player endpoint before replacing the
support directory. The player endpoint parses and upserts rows in one SQLite
transaction, with a 1,000,000-character file limit and no filesystem copy.
Health checks and the super-admin switch are explicit requests; they do not
poll or fall back silently during an account write.
## Current deployment baseline

For up to 10 internal users, SQLite in WAL mode with `synchronous=NORMAL`,
memory temporary storage, and a bounded page cache is the selected persistence
adapter. It provides transactional writes and indexed status/submitter queries
without an additional database service. Keep one backend process on the host;
do not add polling, workers, Redis, or PostgreSQL until measurements show a
concurrency or reporting requirement. The adapter boundary remains replaceable
for a later PostgreSQL migration.
