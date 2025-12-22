# Marketing Site (Phase 4)

Next.js App Router build-out for the public marketing surface.

## Prerequisites

- Node 18+
- Backend server running (`cd backend && npm install && npm run dev`)
- `.env` file with `NEXT_PUBLIC_API_BASE_URL` pointing at the Express API (defaults to `http://localhost:5000/api`).
- If the marketing site and dashboard run on different origins in your environment (e.g. ports 4000 + 3000), set `NEXT_PUBLIC_DASHBOARD_URL` (or legacy `NEXT_PUBLIC_DASHBOARD_BASE_URL`) to the dashboard origin (e.g. `http://localhost:3000`).

## Getting Started

```bash
cd frontend/marketing-site
npm install
npm run dev -- --port 4000
```

Then open http://localhost:4000 to browse the marketing pages while the dashboard continues to use port 3000.

## Available Pages

- `/` – hero block fed by site settings plus featured course snapshots.
- `/courses`, `/pricing`, `/teachers`, `/blog`, `/contact` – placeholder routes already wired so navigation works while deeper templates are built.

## Notes

- All fetches hit the existing `/api/marketing` endpoints, so content mirrors whatever admins configure in the dashboard.
- The landing builder now exposes `/api/marketing/landing-pages/:slug`; use `getLandingPage('home')` from `src/lib/marketingClient.ts` to hydrate future dynamic layouts.
- Tailwind is configured; add shared components under `src/components/` as new sections roll out.
