# Architecture

The backend is a standard-library Go application with capability-owned
packages. The dependency direction is:

```text
operator-api -> session-control -> game-session -> gameprotocol TCP adapter
                             \-> server-catalog
```

`game-session` owns the protocol state machine. A session never allows two
business operations to wait for unrelated server events at the same time,
because the observed protocol has no request identifier for chat or system
events. Multiple sessions and multiple configured servers run
concurrently at the control boundary.

The frontend is embedded static content and uses only `operator-api.v1`. It
does not know the TCP frame format or read credentials from server storage.

`auto-store` is the authority for the persisted server catalog, encrypted game
account credentials, operator state, and redacted request audit log. The JSON
catalog is only a first-run bootstrap. A separate game-support-ops deployment
uses the HTTP contract and service token; no database or Go package is shared
across the process boundary.
