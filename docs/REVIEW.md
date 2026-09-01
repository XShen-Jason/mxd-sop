# REVIEW.md

Use this checklist before merging a change, extracting a feature, or declaring
a migration complete.

## Project consistency

- Are Project ID, Module IDs, and Contract IDs present and unchanged?
- Is PROJECT.md updated without duplicating detailed module or contract text?
- Can the same capability be located and compared in another project?

## Scope and ownership

- Does the change belong to the stated module?
- Is the public surface small and explicit?
- Are internal files hidden from other modules?
- Were unrelated modules and refactors left untouched?
- Is each authoritative rule, schema, and token owned in one place?

## Architecture

- Is dependency direction valid?
- Are frontend and backend independent and connected only by contracts?
- Are persistence and external providers isolated where portability requires it?
- Were layers added only for a concrete responsibility or boundary?
- Are there hidden globals, database coupling, or framework-specific business
  rules?

## Contracts and behavior

- Do producers, consumers, schemas, errors, and authentication agree?
- Are nullability, time, numeric precision, limits, retries, and idempotency
  explicit where relevant?
- Is the change backward-compatible or versioned?

## Performance and UI

- Does backend work remain bounded and within the project's recorded target?
- Did the frontend add duplicate requests, uncontrolled polling, or oversized
  payloads?
- Are shared UI tokens and primitives reused instead of duplicated styles?

## Maintainability

- Are application source files within the AGENTS.md line budget?
- Can an AI find the owning file without reading the whole repository?
- Can the module be understood from its manifest, public interface, and tests?
- Are functions focused, with no duplicate or speculative abstraction?

## Verification

- Does changed behavior have appropriate tests?
- Does a bug fix have a regression test?
- Do frontend/backend boundary tests exist when both sides changed?
- Do start, test, lint/format, and build checks pass when applicable?

## Migration readiness

For extraction or rewrite, verify that the module manifest, stable IDs,
contracts, tests, data mappings, configuration, assets, performance targets,
and dependency classifications are available. Every intentional behavior
difference must be documented.

## Decision

Accept only when the change is correct, contract-compatible, architecturally
valid, within the file budget, tested, understandable in context, and free of
unnecessary duplication or complexity.
