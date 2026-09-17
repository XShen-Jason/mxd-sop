# AGENTS.md

This repository is developed with Codex/AI. Keep the project understandable,
testable, portable, and organized by business capability.

## Rules

- The user request has priority, followed by this file and then project/module docs.
- Keep stable lowercase kebab-case project, module, and contract IDs in `docs/PROJECT.md`.
- Organize code by capability. A shared package is for generic code only.
- Keep one owner for each business rule, contract, and data definition.
- Frontend and backend communicate through explicit contracts, never internal files or database structure.
- Put replaceable TCP and persistence concerns behind interfaces/adapters.
- Keep functions focused and hand-maintained application source at or below 300 lines per file.
- Bound requests, frames, concurrent sessions, timeouts, retries, and in-memory event/state retention.
- Credentials and session secrets must be runtime-only and must not appear in logs, fixtures, or source.
- For bugs, reproduce and add a regression test. For features, test the complete vertical slice and each public module boundary.

## Documents

Read `docs/PROJECT.md`, the relevant document under `docs/modules/`, and the
relevant contract before changing a module. Update the project map when a
module, application, contract, command, or performance boundary changes.
