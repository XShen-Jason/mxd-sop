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
Review, archive, and own-record filters are applied before payload projection;
the frontend requests only the active workspace page and guards continuation
requests against duplicate clicks.

Operation-group collaboration uses one authenticated SSE connection per active
browser session. Events contain no record payload and are emitted only after a
write; clients coalesce bursts within 50 ms before refreshing the active
workspace and compact aggregate count query, with no interval polling. Reminder
lists are filtered and paginated in SQLite.

Frontend GET requests use a short-lived in-memory cache keyed by role and full
request URL, and concurrent reads for the same key share one promise. Mutations
and SSE changes invalidate the cache; login/logout also closes the shared SSE
connection so credentials are never reused across sessions.
## Current deployment baseline

For up to 10 internal users, SQLite in WAL mode is the selected persistence
adapter. It provides transactional writes and indexed status/submitter queries
without an additional database service. Keep one backend process on the host;
do not add polling, workers, Redis, or PostgreSQL until measurements show a
concurrency or reporting requirement. The adapter boundary remains replaceable
for a later PostgreSQL migration.
