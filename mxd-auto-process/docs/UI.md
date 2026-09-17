# Operator UI

The operator page is a separated Vite/React application. Before authentication
it renders only a password form; server names, accounts, operational state, and
logs are not fetched or displayed. After authentication it opens with a server
and account directory. Selecting one server reveals only that server's request
trace.

The root page (`/`) and compatibility route (`/operator`) serve the same React
application. The page refreshes a bounded overview and selected-server logs every
two seconds while visible. Logs show a Chinese request description, source,
status, and duration. Selecting a row opens a persistent detail pane with
status, captured redacted request and response; the selection can be changed
with keyboard focus as well as a pointer.

Heartbeat operation 19 is intentionally excluded from the request log so the
screen represents business traffic rather than connection noise.

The chat controls show the backend delivery classification and the session's
success, failure, and unknown counters after each send. Every server response,
session update, progress message, and error is appended to the single activity
log that starts with `自动化流等待启动。`; the page does not reimplement
protocol result matching.

The monitoring view uses three equal-height panels: the server/account directory,
the selectable request-record list, and the selected request detail. The detail
panel keeps only basic metadata at the top; the captured request and response
areas fill the remaining height, with the response receiving slightly more
space. The dashboard fits the viewport without page-level scrolling; long
request details and the larger response preview scroll inside their own bounded
containers. The authenticated header includes a
change-password control that uses the existing operator password contract and
keeps the session active after a successful update.

The authenticated header also opens the standalone server-management page.
That page calls auto's own server/account/session API directly: server
definitions, encrypted account credentials, enable/disable state, reconnects,
and messages are stored and executed only by mxd-auto-process. The monitoring
server-and-account list reads the same auto-owned projection, so it reflects
changes made there without synchronizing with the customer-support backend.

The operator can set a bounded send count from 1 to 100 (default 50) and use
the continuous-send action. Messages are submitted sequentially with the
selected channel and message captured when the action starts.
