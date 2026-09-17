# Performance

- The manager allows 128 live sessions by default and rejects additional
  starts. Each account owns at most one managed game session.
- Login, character selection, map entry, chat, and reconnect operations use
  context deadlines. TCP bodies are capped at 4 MiB and operator request
  bodies at 32 KiB.
- Account login and reconnect run asynchronously behind the HTTP request. The
  API returns `connecting` or `reconnecting`; the overview is the source of
  truth for completion and failure.
- Enabled accounts are reconciled every two seconds. The watcher does not
  start disabled accounts and retries a disconnected enabled account with the
  complete login, character-selection, and map-entry flow.
- The embedded read-only page receives a bounded overview snapshot every two
  seconds through SSE. The main application uses a visible-page two-second
  overview/status refresh and requests `include_logs=false` so logs do not
  inflate the operational polling payload.
- Overview includes at most the latest 100 audit records; the dedicated logs
  endpoint accepts a bounded limit up to 200. SQLite retains at most 5000
  records and removes older entries after each write.
- The operator continuous-send control is capped at 100 sequential messages.
  Messages are serialized per session and a response timeout increments the
  bounded unknown-result counter without retrying the frame.
- No game-account password, service token, server key, role opaque, or raw TCP
  payload is included in an audit detail. Request bodies are redacted before
  persistence.
