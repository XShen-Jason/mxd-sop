# Development

The normal implementation path is:

1. Build and test `gameprotocol` frame/message behavior.
2. Test each `gamesession` operation against a local framed TCP fixture.
3. Test session limits and lifecycle through `sessioncontrol`.
4. Test HTTP contract behavior with `httptest`.
5. From `frontend-auto-process/`, run `npm run lint`, `npm test`, and `npm run build` so
   the Vite bundle is emitted into `backend-auto-process/internal/operatorapi/assets/`.
6. From `backend-auto-process/`, run `gofmt`, `go test ./...`, `go vet ./...`, and
   `go build ./...`.

Real server checks are manual and require runtime credentials and authorization
for the configured endpoint. Captured credentials and raw captured frames are
never used as test fixtures.

The operator process scans the `datacj` directory beside the configured server
catalog for successful role-selection evidence. Use
`--role-opaque-pcap-path` to point at another capture file or directory;
extracted values remain runtime-only. A role-specific match is preferred, with
one unambiguous value for the same server (or across the bounded capture set
when the endpoint has no local evidence) used for a role not present in the
captures.
