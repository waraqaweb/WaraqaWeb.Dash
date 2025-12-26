# Frontend source structure

This React app is built from `frontend/` and deployed under the `/dashboard/` URL prefix.

## What “pages” means here

In this repo, **“page” can mean two different things**:

- **Route-level pages**: components mounted directly by React Router (for example `src/pages/admin/*`, `src/pages/library/*`).
- **Dashboard internal views**: screens rendered _inside_ a single `Dashboard` shell (even though they live under `src/pages/dashboard/*`).

## Dashboard routing model (important)

- The `/dashboard/*` route space mounts **one** layout/shell: `src/pages/dashboard/Dashboard.jsx`.
- `Dashboard.jsx` determines the active view from the URL segment (e.g. `/dashboard/teachers`) and renders the matching internal view component.

This means most dashboard screens are **internal views**, not independently mounted route-level “pages”.

## Where dashboard code lives

- `src/pages/dashboard/Dashboard.jsx`

  - The dashboard shell: sidebar + header + shared providers.
  - Reads the current URL under `/dashboard/*` and swaps which view is shown.

- `src/pages/dashboard/*`

  - Dashboard **internal views** (e.g. home, teachers, invoices, settings).
  - These are rendered by the dashboard shell; they are not separate top-level route pages.

- `src/components/dashboard/*`

  - Dashboard-specific components used by the internal views (modals, widgets, helpers).
  - Keeping these in `components/` helps avoid confusion between “a reusable component” and “a dashboard view”.

- `src/components/ui/*`, `src/components/layout/*`
  - Shared UI primitives and layout building blocks.

## Tests

- `src/__tests__/` contains UI/unit tests.
- There is no dedicated `npm test` script in `frontend/package.json` today.
