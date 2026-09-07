# Performance

- SQLite runs in WAL mode with `synchronous=NORMAL`, busy timeout, bounded pool,
  and indexed account/session/team lookups.
- Team creation and approval use write transactions; approval uses an atomic
  `COUNT(*) < 10` guard, so concurrent requests cannot oversell capacity.
- Application history is indexed by `(account_id, day_key, requested_at)` and
  capped at the latest 50 rows for the history response.
- Team merge approval moves a source roster in one transaction and rechecks the
  combined member count before changing either team.
- The frontend performs one verification request and one team read; mutations
  refresh that bounded list. There is no polling or unbounded pagination.
- Locked roster history uses the existing `(account_id,day_key)` and team
  membership indexes, one exact-date query capped at 20 member rows. The UI
  fetches on mount, date selection, or explicit retry only; it cancels obsolete
  requests and has no polling or full-history download.
- Request bodies are capped at 32 KiB and concurrent handlers are limited by a
  process semaphore.
- HTTP headers are read within 5 seconds and request reads/writes are bounded to
  15 seconds; idle keep-alive connections expire after 60 seconds.
