# server-catalog

## Purpose

Load and validate multiple explicitly configured TCP game servers.

## Scope

In scope: IDs, names, addresses, protocol version/map settings, limits,
request, map, and chat-response timeouts, and the explicit keyless-probe
feature flag. Out of scope:
credentials, role opaque values, session state, and network connections.

## Ownership and invariants

Enabled entries have a stable ID, a valid host:port address, a non-empty
protocol version, and a non-empty map ID. Invalid entries fail at startup.

## Public surface

`Load`, `Catalog.Get`, and `Catalog.List` expose validated server definitions.

## Dependencies

JSON configuration and Go `net` validation.

## Data, configuration, and assets

See `backend-auto-process/config/servers.json` for the first-run bootstrap. Once auto has a
database, the SQLite `server_catalog` record is authoritative and API CRUD
updates it transactionally with the catalog used by running sessions. The
catalog contains no account password, token, key, or opaque role credential.
`allow_keyless_probe` defaults to false and must be enabled per authorized
server before a fresh-connection diagnostic can run.

## Tests

Valid loading, defaults, duplicate IDs, invalid addresses, disabled entries,
and missing required values are tested.

## Migration notes

The JSON catalog remains a local bootstrap format. Add fields
backward-compatibly, keep server IDs stable when endpoints change, and use the
operator API for runtime changes so the database and in-memory catalog remain
consistent.

## Server quick command settings

Each persisted server record stores positive integer reference values for
`spawn_rate`, `exp_rate`, `exp_max`, `drop_rate`, `meso_rate`, and `domain_times`.
Defaults for older records remain `2`, `13`, `99999999`, `3`, `5`, and `2`.
`exp_max` is retained for wire/storage compatibility and means EXP duration in
minutes, not an experience cap. Existing saved values are not migrated or
overwritten by a UI label correction. The operator overview exposes the saved
configuration as a reference, not an authoritative game-server readback.
Server configuration updates persist through the SQLite catalog transaction;
sending a draft quick command through chat does not change this reference.
