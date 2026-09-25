# session-control

## Purpose

Coordinate independent game sessions concurrently while enforcing a bounded
resource budget.

## Scope

In scope: session IDs, server lookup, dial/login startup, lifecycle operations,
concurrency limits, bounded keyless probes, runtime role-opaque source wiring,
and shutdown. Out of scope: TCP message construction and HTTP serialization.

## Ownership and invariants

- A session is created only for a catalog entry and non-empty runtime credentials.
- Failed starts release their reserved capacity and close their TCP client.
- Session IDs are opaque to clients and are not reused during one process run.
- Stop and shutdown remove session handles and close their transport.

## Public surface

`Manager.Start`, `List`, `Get`, `Select`, `Enter`, `Chat`, `ProtocolState`,
`ChatWithoutKey`, `ProbeChatWithoutLogin`, `Stop`, and `Close`.

## Dependencies

`server-catalog`, `game-session`, and a replaceable `gameprotocol.Dialer`.

## Data, configuration, and assets

Only session metadata and redacted state are returned by normal manager
snapshots. The explicit protocol-state method is diagnostic-only. Credentials
are passed to login and discarded by the session afterward.

## Tests

The module is covered through injected dialers for capacity, startup failure,
operation delegation, keyless-probe routing, and cleanup behavior.

## Migration notes

The manager can be reused by another frontend or CLI without changing the TCP
module.

## Account login and automation

The managed account `enabled` flag controls login intent and watcher reconnect.
`automation_enabled` controls automatic execution eligibility independently.
Start/stop only change login intent; toggling automation preserves the session.
Manual chat requires login; strict automation chat additionally rechecks the
automation flag under the account lock for each command. Delayed asynchronous
login jobs re-read login intent under that lock and cannot undo a later logout.

Account changes that affect connection credentials/identity restart a logged-in
account; automation-only or display-name changes do not restart it.
