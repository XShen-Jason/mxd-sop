# player-directory

## Purpose

Provide a small, authenticated account directory for customer support. Agents
search a server/account/QQ/character mapping and copy one complete message to a
player. Super administrators can replace one server's directory from its
exported CSV file at a time.

## Ownership

- Backend authority: `backend/src/modules/player-directory`.
- Frontend consumer: `frontend/src/modules/player-directory`.
- Production persistence: the `player_directory` SQLite table plus the active
  `mxd-player` account-import adapter.
- Test adapter: the JSON repository selected by `createApp` test configuration.
- The player service is the runtime authority for login and team operations.
  The operations desk keeps a bounded searchable copy for customer support; no
  CSV snapshot is written by either service during an HTTP upload.

The directory never reads the player database directly. The two services
communicate through the versioned internal HTTP contracts only.

## Invariants

- Search is available to every authenticated role.
- Import is available only to `super_admin`; the active player service accepts
  the validated upload in a transaction before the support directory replaces
  only the selected server. Player teams, sessions, and accounts are not
  deleted by synchronization.
- A row contains a server ID, character ID, user ID, game account, and numeric
  binding QQ. Invalid rows never enter the repository.
- Results are grouped by account identity and expose all character IDs for that
  identity.
- Search requests and responses are bounded and ordered by user ID; the frontend
  debounces input, cancels obsolete requests, and uses previous/next cursor
  pagination.

See `docs/contracts/player-directory.md` for the public boundary.
