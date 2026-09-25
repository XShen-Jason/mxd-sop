# potential-editor
## Purpose
Super-admin workspace for temporary game account sessions and ordered equipment potential editing.
## Scope
Uses configured game servers, completes login and character entry, reads potential lists, maps template IDs through item-catalog, and sends complete reset commands.
## Ownership and invariants
Temporary sessions are held by mxd-auto-process and never persisted as automation accounts.
A reset contains one to three ordered pool entries and is generated server-side.
Empty equipment starts with three editable slots. Gaps are rejected instead of
silently shifting slot order. Names, grades and values map through the enabled
CSV pool; a small numeric value does not imply an equipment percentage stat.
## Public surface
`potential-pool`, `potentials.list`, and `potentials.set` HTTP endpoints restricted to `super_admin`.
## Dependencies
auto-integration, item-catalog, `data/tbl_potential_pool.csv`.
## Tests
Backend potential-editor.test.ts and auto-integration.test.ts cover the supplied
response, empty equipment, ordered reset commands and authorization.
Frontend potential-options.test.ts and potential-workspace.browser.mjs cover
empty-slot writes, search, keyboard navigation, responsive layout, session
restore/reopen, transient failures, serialized polling and explicit logout.
Browser tests use Playwright with installed Chrome, a frontend dev server and
mocked API calls; no real game account is used.
Auto heartbeat_idle_test.go reproduces a blocking idle monitor preventing
heartbeat writes, then verifies successful heartbeat delivery and explicit close.

## Session lifetime
Auto owns runtime credentials, the fixed 10-second op=19 heartbeat and reconnect.
Navigation, refresh, browser closure and desk logout do not stop the game session.
Only explicit game logout calls DELETE. A user-scoped local reference saves ID,
server ID, creation timestamp and account label, never credentials. Restoring
checks timestamp and server to reject IDs reused after auto restarts.
Transient read failures retain the reference and block edits until verified.
Runtime sessions do not survive an auto process restart.

## UI and performance
Login and character selection share a modal. Closing it never stops the game
session; a pending role selection can be reopened from the account panel.
Operation feedback uses the shared FloatingNotice component. Input focus uses
a muted outer border/ring, without an additional inner search-input outline.
Each equipment card shows three aligned comparison rows: saved values on the
read-only left, searchable draft values on the right. Changed rows are marked
as added, modified or pending removal. Reset restores the saved values. Only
confirmed successful saves advance the baseline; failed/unconfirmed writes
retain both the old baseline and draft. Mobile preserves the two-column pairing.
Local multi-token search supports name, stat code, value and grade; repeated
pool entries are deduplicated. At most 60 search results render with a narrowing
hint. Equipment can be searched by name or IDs. Status reads bypass GET caching,
run at most one at a time every five seconds after completion, pause when hidden
and resume when visible. These HTTP reads are not game heartbeats.

## Migration notes
No game credentials are stored by the main backend. Preserve the auto HTTP
boundary if extracting the editor to another application.
