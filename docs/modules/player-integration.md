# player-integration

## Purpose

Connect the operations desk to the independently deployed `mxd-player`
backend without sharing a database or process. The selected endpoint owns
player login, account data, teams, and team mutations.

## Ownership and invariants

- Only `super_admin` can inspect endpoint health or switch `local`/`remote`.
- A switch requires a healthy configured target and the exact confirmation
  text `SWITCH PLAYER SERVER`; the selected mode is persisted in SQLite.
- Account CSV import calls the active player service first. The support
  directory is replaced only after the player transaction succeeds.
- The player service receives a bearer service token from server configuration;
  it is never returned to the browser or stored in frontend state.
- The operations desk never opens the player SQLite database directly.

## Performance and failure behavior

Health checks are explicit and bounded. Account sync has one request and no
silent endpoint fallback, so a player outage cannot be reported as a successful
support upload. Team snapshots use the same active endpoint and are persisted
by `team-view` for bounded reads.

See `docs/contracts/player-integration.md` for the HTTP boundary.
