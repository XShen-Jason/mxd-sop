# MIGRATION.md

Use this document when moving a capability to another project or
reimplementing it in another language or framework.

## What must remain stable

Preserve, in this order of importance:

~~~text
observable behavior
module ID and ownership
public Contract IDs, schemas, and errors
business rules and data semantics
performance expectations
tests and acceptance cases
~~~

Replace implementation details, framework code, infrastructure, and
project-specific wiring unless a deliberate behavior change is documented.

## Select a migration unit

Prefer a complete capability or vertical slice. Do not move an isolated page,
controller, or utility if its behavior depends on hidden code elsewhere.

## Migration package

Before moving the code, collect:

~~~text
module manifest
public contracts, schemas, examples, and stable errors
portable business rules
ports/interfaces and adapter list
frontend/backend integration points
data migrations or mapping rules
configuration, assets, and permissions
tests, fixtures, performance targets, and known limitations
~~~

Classify every dependency as portable, replaceable, or project-specific. There
must be no unclassified dependency.

## Cross-project mapping

Map source and target projects by stable Project ID, Module ID, and Contract ID.
Physical paths and language-specific names may differ, but each mapping must be
recorded in the target PROJECT.md or module manifest.

## Migration sequence

1. Freeze source behavior with contract and regression tests.
2. Map inputs, outputs, errors, side effects, data semantics, performance
   expectations, and dependencies.
3. Recreate the public contracts and tests in the target project/language.
4. Implement portable rules independently of the target framework.
5. Implement target-specific adapters and application wiring.
6. Run the same behavior and boundary cases; resolve every difference explicitly.
7. Document intentionally changed behavior and remove obsolete source wiring.

Do not translate files mechanically before the contract and dependency map are
clear. A migration is complete only when the target has no hidden source
dependencies, stays within its file budget, and its tests demonstrate equivalent
behavior.
