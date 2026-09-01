# UI.md

Use this document when a project has a frontend.

## Goal

Create a clear, attractive interface with a small, reusable styling surface.
Visual quality should come from consistent tokens, hierarchy, spacing,
typography, and states rather than repeated custom CSS or heavy effects.

## Rules

- Use one design-token source for colors, spacing, type, radii, and elevation.
- Build repeated controls from shared UI primitives.
- Keep capability-specific composition inside its module.
- Keep custom styles local, minimal, and named for their responsibility.
- Do not duplicate visual constants or component behavior across pages.
- Provide loading, empty, error, disabled, and responsive states where relevant.
- Keep frontend presentation and client state separate from authoritative backend
  rules.
- Reuse the project's existing UI system before introducing a new primitive.

When no design system exists, create only the smallest token and primitive set
needed by the first real screens. Record the shared source of truth in the
project or frontend documentation.

Implementation note: `frontend/src/styles.css` remains a compact legacy stylesheet
at just over the 300-line source budget; newly added role/login rules live in
`frontend/src/styles-roles.css` so further growth can be split by responsibility.
