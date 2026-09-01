# MODULE.md

## Definition

A module is one business capability with a clear owner, stable module ID, and
small public surface. It is the unit for understanding, comparing, testing,
extending, extracting, and reimplementing functionality.

Examples: auth, user-profile, file-upload, payment, notification.

Do not create modules for generic technical categories alone.

## Module manifest

Every non-trivial module should have a short README.md (or equivalent) with:

~~~text
Module ID and purpose
In scope / out of scope
Owned data and invariants
Public commands, queries, types, or events
Contract IDs, inputs, outputs, and stable errors
Dependencies and external services
Configuration, migrations, and required assets
Tests
Extraction or migration notes, when relevant
~~~

The module registry in PROJECT.md is the concise cross-project index. The
module manifest is the local source of truth. Do not duplicate full details in
both places.

Use these headings for a consistent module manifest:

~~~text
# <module-id>
## Purpose
## Scope
## Ownership and invariants
## Public surface
## Dependencies
## Data, configuration, and assets
## Tests
## Migration notes
~~~

## Ownership

The module owns:

- business behavior and invariants;
- internal transformations and use cases;
- capability-specific infrastructure adapters;
- capability-specific UI;
- tests for its behavior.

Frontend and backend implementations may live in separate application trees,
but they remain parts of the same capability and use the same contract IDs.

## Public and internal code

Expose only what another module or application must use:

~~~text
module/
├── public/          stable interface and public types
├── application/     use cases, when needed
├── domain/          portable rules, when needed
├── infrastructure/  adapters, when needed
├── interface/       transport/UI boundary, when needed
└── tests/
~~~

This is a conceptual layout, not a requirement to create every directory.
Internal files may change without coordinating every consumer. Public changes
are contract changes and must be reviewed with their consumers.

## Dependencies and redundancy

- Keep dependencies directed and explicit.
- Do not depend on another module's database tables or internal classes.
- Put replaceable vendors and persistence behind ports/adapters when needed.
- Keep project-specific wiring at the application boundary.
- Keep one owner for each business rule and data definition.
- Promote code to shared/ only when it is generic and already needed by at
  least two modules.

Boundary mapping code may repeat a field shape, but it must not silently create
another authoritative rule.

## Portable feature rule

When a feature may be reused, keep these parts identifiable together:

~~~text
feature behavior
public contract and examples
business rules
ports and adapters
frontend/backend integration
data migrations and configuration
tests and required assets
~~~

Separate reusable core behavior from project-specific authentication, branding,
routing, storage, and deployment choices. Classify each dependency as portable,
replaceable, or project-specific before extraction.

## Splitting a module

Split by a meaningful change of responsibility, ownership, or lifecycle. Do not
split merely to reduce a function count or to satisfy a template. A module that
contains unrelated capabilities should become several modules with explicit
public interfaces.
