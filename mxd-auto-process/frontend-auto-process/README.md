# MXD Auto Process frontend

Independent Vite/React operator console for the `operator-api.v1` contract.

## Commands

```powershell
npm install
npm run dev       # Vite dev server on http://127.0.0.1:6909
npm run lint
npm test
npm run build     # emits ../backend-auto-process/internal/operatorapi/assets for Go embedding
```

Port `6909` is development-only and binds to `127.0.0.1`. Do not expose it in
a firewall, cloud security group, or production Nginx upstream; production
serves this build from the loopback auto process on port `26909`.

The browser requests no monitoring data until `/api/v1/operator/me` confirms
the HttpOnly operator session. Overview data is refreshed every two seconds
while visible; selected-server logs are fetched with a bounded `server_id`
filter. The UI renders Chinese request summaries in a selectable list and
keeps the captured, redacted request/response payloads in a persistent detail
pane. HTTP audit bodies are capped at 32 KiB per direction; game exchanges also
cap each captured protocol message at 64 KiB and record at most 64 responses.
Authenticated operators can change their password or open the standalone
auto server-management page from the console header. Server and account CRUD,
session setup, lifecycle controls, and chat on that page use auto's own API and
storage; they do not synchronize with the customer-support backend.
