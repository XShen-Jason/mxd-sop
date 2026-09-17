# mxd-auto-process

`mxd-auto-process` is the independent owner of game-server definitions, game
account credentials, sessions, reconnects, chat delivery, and request audit
records. The game-support-ops backend uses its HTTP API and service token; it
does not share this process's database or Go packages.

## Run locally

```powershell
cd backend-auto-process
go run ./cmd/mxd-auto-process --config config/servers.json --listen 127.0.0.1:26909
cd ..
```

The default API listener is loopback port `26909`. The Vite development server
uses loopback port `6909`; it must remain bound to `127.0.0.1` and must not be
opened in a firewall or cloud security group. `start.bat` checks both ports,
builds the React bundle, and starts the Vite development server. The JSON server file is only used to
bootstrap an empty auto database; subsequent server/account data is stored in
SQLite under `AUTO_DATABASE_PATH`.

Build the separated React operator frontend before packaging the Go binary:

```powershell
cd frontend-auto-process
npm install
npm run build
cd ..
```

Run `start.bat` to launch both processes, then open `http://127.0.0.1:6909/` on
the server itself. In production, build the frontend into the Go embedded asset
directory and expose only the secured reverse-proxy route; do not publish 6909.
The browser initially shows only the operator
login form; server names, accounts, and logs are fetched only after login. The
initial operator is `admin` and the initial password is `AUTO_INITIAL_PASSWORD`
(default for a new local database: `ChangeMe-26909!`); the first login must
replace it. New administrator passwords must be at least 6 characters.
`/operator` is a compatibility alias for the same application.

## API and lifecycle

The canonical contract is `contracts/operator-api-v1.yaml`.
`/api/v1/overview`, `/api/v1/logs?server_id=<id>`, and `/api/v1/events` expose
bounded monitoring data only to the HttpOnly operator session cookie or
`Authorization: Bearer <AUTO_SERVICE_TOKEN>`. Logs include redacted HTTP and
game request/response exchanges; heartbeat operation 19 is excluded.

Creating or starting an enabled account returns immediately with a
`connecting` snapshot. Auto then performs password login, character selection,
and map entry in the background. Enabled accounts are reconciled every two
seconds and automatically run the same complete flow after a disconnect.
`reconnect` is available for a manual retry. `stop` disables the account,
closes its session, and disconnects the game TCP connection.

The normal chat modes are `scene`, `guild`, `team`, `world`, and `privateChat`.
Account passwords are encrypted at rest and never returned or written to audit
details. Role opaque values are resolved from the login response or configured
successful captures. A newly selected role can reuse one unambiguous value
captured for the same server, so the operator does not type field 81 into the
normal flow.

## Credential key

`backend-auto-process/data/auto-credentials.key` is a locally generated,
32-byte AES-GCM key. Auto uses it to encrypt game-account passwords before
storing them in `auto.sqlite`; it is not an API token, operator password, or
game protocol key. Keep the key outside GitHub with mode `600`, and back it up
together with the matching SQLite database. If the key is lost or replaced,
the saved account ciphertext cannot be decrypted and those accounts must be
entered again.

## Separate deployment

Keep the auto listener on loopback for a same-host deployment. If the
operations desk and auto run on different hosts, expose only a private-network
or HTTPS reverse-proxy route, set the backend's `MXD_AUTO_LOCAL_URL`, and use
the same long random `AUTO_SERVICE_TOKEN` and `MXD_AUTO_SERVICE_TOKEN`. The
operator page has no remote endpoint mode.

For the supported same-host Debian production layout, follow
[`../docs/DEPLOYMENT-MXD-AUTO-26909.md`](../docs/DEPLOYMENT-MXD-AUTO-26909.md)
for the first deployment and [`../docs/DEPLOYMENT-UPDATE.md`](../docs/DEPLOYMENT-UPDATE.md)
for later updates.

## Verify

```powershell
cd backend-auto-process
go test ./...
go vet ./...
go build ./...
cd ..\frontend-auto-process
npm test
npm run lint
npm run build
```
