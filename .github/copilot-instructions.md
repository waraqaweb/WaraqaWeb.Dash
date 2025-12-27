# Copilot instructions (Waraqa)

## Big picture

- **Backend**: Node/Express + Mongoose API in [backend/server.js](backend/server.js). Routes live in [backend/routes/](backend/routes/) and mount under `/api/*`.
- **Frontend**: React (Vite) dashboard app in [frontend/](frontend/) deployed under the **`/dashboard/`** URL prefix. Production build outputs to `frontend/build/` (CRA-compatible) via [frontend/vite.config.js](frontend/vite.config.js).
- **Reverse proxy**: Nginx routes `/api/*` and `/socket.io/*` to the backend and everything else to the frontend container (see [deploy/nginx/default.http.conf.template](deploy/nginx/default.http.conf.template) and [deploy/nginx/default.https.conf.template](deploy/nginx/default.https.conf.template)).
- **Realtime**: Socket.IO is initialized in [backend/server.js](backend/server.js) and clients join rooms named by **role** and **user id** (see `join-room` in [frontend/src/contexts/AuthContext.jsx](frontend/src/contexts/AuthContext.jsx)).

## Local dev workflows

- **Frontend**: `npm --prefix frontend start` (Vite on `:3000`).
- **Backend**: `npm --prefix backend run dev` (nodemon, defaults to `:5000`, needs Mongo).
- **Docker (prod-like)**: `docker compose up -d --build` using [docker-compose.yml](docker-compose.yml) and env values from [.env.example](.env.example).
- **Deploy**: GitHub Actions SSH deploy is in [.github/workflows/deploy-droplet.yml](.github/workflows/deploy-droplet.yml) (resets to `origin/main`, then `docker compose up -d --build`).

## Critical conventions (don’t break these)

- **Base path**: production frontend assets and routes assume `/dashboard/` (see `homepage` in [frontend/package.json](frontend/package.json) and `base` in [frontend/vite.config.js](frontend/vite.config.js)).
- **JSX-in-`.js`**: Vite pre-transform allows JSX in `.js` files (plugin in [frontend/vite.config.js](frontend/vite.config.js)). Don’t “fix” JSX-by-renaming files unless necessary.
- **API base resolution**: frontend requests go through the shared Axios instance in [frontend/src/api/axios.js](frontend/src/api/axios.js). Prefer updating that single place instead of hardcoding URLs.
- **Env vars**:
  - Frontend build-time: `REACT_APP_API_URL`, `REACT_APP_SOCKET_URL` (see [.env.example](.env.example)).
  - Backend runtime: `FRONTEND_URL` controls CORS allow-list (comma-separated origins supported) and `JWT_SECRET` is required in production (see [backend/server.js](backend/server.js)).

## Backend patterns

- **Auth**: Most protected routes use `requireAuth`/`authenticateToken` from [backend/middleware/auth.js](backend/middleware/auth.js). Role checks use `requireRole` helpers (`requireAdmin`, `requireTeacherOrAdmin`, etc.).
- **Error shapes**: auth/register uses `express-validator` and returns `{ message: "Validation failed", errors, fieldErrors }` (see [backend/routes/auth.js](backend/routes/auth.js)). Preserve this shape when extending validations.
- **Data modeling**: `User` is the central model (see [backend/models/User.js](backend/models/User.js)); guardians embed students as sub-documents while many other resources are separate collections under [backend/models/](backend/models/).

## Frontend patterns

- **Routing model**: `/dashboard/*` mounts one shell, then swaps internal views based on the last URL segment (see [frontend/src/pages/dashboard/Dashboard.jsx](frontend/src/pages/dashboard/Dashboard.jsx) and [frontend/src/STRUCTURE.md](frontend/src/STRUCTURE.md)). Prefer adding new dashboard screens as internal views, not new top-level routes.
- **Auth state + sockets**: token is stored in `localStorage` and managed by `AuthContext`; socket connects once and emits `join-room` for role and user id (see [frontend/src/contexts/AuthContext.jsx](frontend/src/contexts/AuthContext.jsx)).
- **Styling**: Tailwind uses CSS variable theme tokens (e.g. `bg-background`, `text-foreground`) defined in [frontend/tailwind.config.js](frontend/tailwind.config.js). Avoid hardcoding new hex colors in components.
