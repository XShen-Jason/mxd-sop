# mxd-player development rules

This is an independent project stored in the same repository as the operations
desk. It follows the repository root `AGENTS.md` and the development rules from
`C:\Users\22734\Desktop\PROJECTS\AAAAA\AGENTS.md`.

- `frontend-player` and `backend-player` communicate only through the contracts
  in `CONTRACTS.md`.
- The player backend owns validation, team limits, transactions, and SQLite
  access. The frontend does not read the database or recreate business rules.
- Keep SQLite in WAL mode, bound request size/concurrency, and preserve the
  indexed lookups documented in `PERFORMANCE.md`.
- Keep mobile-first presentation tokens in `frontend-player/src/styles.css` and
  expose loading, empty, disabled, and error states for every request.
- Keep hand-maintained source files at or below 300 lines and run the project
  checks before completion: `npm run build`, `npm run lint`, `go test ./...`,
  and `go vet ./...`.
