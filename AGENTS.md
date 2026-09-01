# AGENTS.md

## Purpose

This repository is developed with Codex/AI. Keep every project easy to
understand, compare, extend, extract, and reimplement in another language or
framework.

This file contains rules that always apply. Read only the additional documents
needed for the current task.

This project stores its project, module, contract, and workflow documents under
docs/. AGENTS.md remains at the repository root so coding agents can discover
these rules automatically.

## Rule priority

Resolve conflicts in this order:

1. The user's current requirement.
2. This file.
3. The selected project documents.
4. The owning module's local documentation.
5. Language and framework conventions.

Record deliberate exceptions in the relevant project or module document.

## Document combinations

~~~text
New project:       AGENTS + PROJECT + INIT + ARCHITECTURE + MODULE + CONTRACTS
Feature work:      AGENTS + PROJECT + DEVELOPMENT + MODULE + CONTRACTS
Backend work:      AGENTS + PROJECT + DEVELOPMENT + PERFORMANCE + CONTRACTS
Frontend work:     AGENTS + PROJECT + DEVELOPMENT + UI + MODULE
Bug fix:           AGENTS + PROJECT + DEVELOPMENT + REVIEW
Reuse/extraction:  AGENTS + PROJECT + MODULE + MIGRATION + REVIEW
Language rewrite:  AGENTS + PROJECT + ARCHITECTURE + CONTRACTS + MIGRATION + REVIEW
Final review:      AGENTS + PROJECT + REVIEW
~~~

## Core rules

### One shared project model

Every project uses the same concepts and stable IDs for projects, modules, and
contracts. Physical paths and language naming may follow local conventions, but
one capability must map to one module ID across projects and rewrites. Keep the
canonical map in docs/PROJECT.md for this project.

### Organize by capability

Organize code by business capability, not by global technical folders such as
controllers/, services/, or utils/. A shared folder is for generic code only.

### Treat a feature as a portable unit

A reusable feature is a complete capability, not a copied file. Keep its
behavior, public contract, tests, configuration, data changes, assets, and
integration points identifiable together. Separate portable core behavior from
project-specific wiring.

### Keep one source of truth

Each business rule, contract, data definition, and design token has one owner.
Do not duplicate authoritative logic in multiple modules or applications.
Boundary translations and client-side UX validation are allowed only when they
are explicitly derived from the owner.

"No redundancy" means no unnecessary duplicate authority; small boundary
translations, generated output, and tests are not treated as business-rule
duplicates.

### Keep boundaries explicit

- Frontend and backend are independent applications.
- They communicate through explicit contracts, never database structure or
  implementation files.
- A module exposes a small public interface; consumers never import internals.
- Replaceable persistence and external services use adapters when they would
  otherwise leak into business rules.

### Backend-first performance

Backend correctness and predictable resource use are the default priority.
Frontend changes must not add uncontrolled requests, oversized payloads, or
unbounded polling. Use docs/PERFORMANCE.md for boundary-level decisions.

### Grow complexity only when needed

Start with the smallest structure that works. Add layers only for a concrete
responsibility, dependency, or test boundary. Do not create empty folders.

## File and context limits

For application source files, the default budget is:

~~~text
<= 300 physical lines: normal
301-400 lines: split during the change or record a documented exception
> 400 lines: split before completion
~~~

Count physical lines in hand-maintained application source. Do not satisfy the
budget by minifying code or hiding logic in a large generated file.

Generated files, vendored code, lockfiles, and deliberately data-only files may
be exempt. Mark exemptions and do not edit generated output as source.

Keep functions focused (prefer <= 50 physical lines). Split by responsibility,
not merely to game the limit. A file or function that is hard for an AI to
understand is already a reason to split it.

Automate the size check when the project toolchain permits; otherwise verify it
during review.

## Change discipline

Before editing, identify the owning module, affected contract, dependencies, and
existing tests. Inspect the relevant context; do not invent parallel files or
abstractions because context is missing. After editing, verify changed behavior
and check boundaries and unrelated modules.

For a bug, reproduce it and add a regression test. For a feature, keep UI, API,
application logic, infrastructure, and tests traceable to the same module.

## Completion standard

A change is complete only when it is correct, contract-compatible,
architecturally valid, tested at the appropriate level, within the file budget,
understandable without the whole repository, and free of unnecessary
duplication or complexity.
