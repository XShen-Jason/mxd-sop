# DEVELOPMENT.md

Use this document for normal feature work and maintenance. It defines shared
guardrails without prescribing a framework-specific workflow.

## Before editing

Identify:

~~~text
owning module and stable module ID
affected contract IDs
existing implementation that can be reused
dependencies and side effects
relevant tests and documentation
~~~

Read only the affected module and contracts unless a boundary change requires
more context.

## Add or extend a feature

- Keep the feature traceable across frontend, backend, infrastructure, and tests.
- Update the public contract before relying on new boundary behavior.
- Put authoritative business rules in the owning module, not in controllers,
  pages, or shared UI components.
- Keep project-specific integration separate from reusable feature behavior.
- Add only the layers and abstractions required by the feature.
- Review PERFORMANCE.md when adding requests, queries, polling, or external calls.
- Review UI.md when changing frontend presentation.

## Fix a bug

Reproduce the behavior, locate the owning module and violated rule, make the
smallest root-cause change, and add a regression test. Check adjacent behavior
when a contract or shared boundary changed.

## Reuse existing code

Search before creating a helper, service, component, repository, or adapter.
Reuse a module through its public interface. Do not copy internal files and
silently create a second implementation.

## Single source of truth

Each business rule, contract, data definition, and design token has one owner.
Boundary mapping and client-side UX validation may mirror data, but must not
become a second authoritative rule.

## Data and external services

- Database schema changes belong to the backend and require a migration.
- Frontend code must not depend on database structure.
- Third-party SDK calls, queues, storage, and providers belong in adapters when
  business behavior should remain portable.
- Keep configuration explicit and outside core business rules.

## Scope and readability

Modify existing code before adding duplicates. Application source files must
follow the AGENTS.md size budget; split an over-limit file before completion.
Keep functions focused and names aligned with actual responsibility. Do not
combine unrelated refactors with a feature or bug fix.

## Done

The changed behavior is tested, contracts and consumers agree, backend impact is
reviewed, module boundaries remain valid, documentation reflects new public
behavior, and no temporary, duplicate, or unrelated code remains.
