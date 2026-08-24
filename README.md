# ⛪ Church Attendance Tracker

A full-stack attendance system for churches. The **main admin** manages members,
services, users, reports and settings; **ushers** get a focused screen to record
Present / Absent / Excused during a live service in just a few taps.

| Layer | Technology |
|---|---|
| Frontend | React 18 · React Router 6 · Vite · hand-rolled CSS design system |
| Backend | Node.js · Express 4 · REST API |
| Database | PostgreSQL (parameterised queries, SQL migrations, seed script) |
| Auth | bcryptjs password hashing · JWT access token (15 min) + rotating refresh token (7 days) in HttpOnly cookies |
| Tests | Jest + Supertest (auth, RBAC, members, services, attendance, users) |

---

## Quick start

### 0. Prerequisites

- Node.js 18+
- **PostgreSQL 13+** running locally (create nothing manually — the scripts do it)
- If PostgreSQL is missing:
  - Windows: install from <https://www.postgresql.org/download/windows/>
  - or `docker run --name cat-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`

### 1. Install

```bash
npm run install:all        # installs server/, client/ and the root runner
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
```

Defaults expect `postgres/postgres@localhost:5432`. Adjust `DATABASE_URL`,
`DATABASE_URL_TEST` and the JWT secrets if needed.

### 3. Migrate + seed

```bash
npm run migrate            # creates tables (tracked in _migrations)
npm run seed               # demo admin, ushers, 28 members, 10 weekly services,
                           # deterministic attendance, follow-ups, settings
```

### 4. Run

```bash
npm run dev                # API on http://localhost:4000 + web on http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so cookies just work.
For production: `npm run build` then `npm start` — Express serves `client/dist`.

### Accounts — no defaults anywhere

There is deliberately **no public sign-up**, and **no password is hardcoded** in
this codebase — accounts exist only in your database.

- **Local demo data** (`npm run seed`): reads `SEED_ADMIN_EMAIL`,
  `SEED_ADMIN_PASSWORD`, `SEED_USHER_EMAIL`, `SEED_USHER_PASSWORD` from
  `server/.env` (template in `.env.example`) and refuses to run when missing.
- **Production**: the first admin is created automatically from the
  `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars on the first request after deploy —
  but **only while the users table is empty**. Ushers are created by that admin
  inside the app (one-time temporary passwords).
- Changing `ADMIN_PASSWORD` in Vercel later does **not** update an existing
  account. To rotate: in Neon's SQL Editor run
  `DELETE FROM users WHERE email = 'the-old-email';` then redeploy — the
  bootstrap re-creates the admin from the current env values.

### Tests

```bash
npm test                   # auto-creates church_attendance_test DB, migrates, runs Jest
```
---

## Features

### Admin
- **Overview dashboard** – latest service numbers, 4-service average, active members,
  open follow-ups, 12-service trend chart, recent services, latest records,
  high-priority follow-up list.
- **Attendance screen** – service selector, search, group & status filters,
  Present/Absent/Excused controls, notes, save button, marked counter,
  last-updated time, and **who recorded each entry**.
- **Members** – full CRUD, activate/deactivate, per-member history page with
  totals, consecutive-absence streaks, group & contact info, follow-up plans.
- **Services** – create/edit, upcoming/past tabs, headcount, per-service roster view.
- **Reports** – totals, trends, by service/group/usher, repeat absentees,
  active-vs-inactive, CSV export for attendance and members.
- **User management** – create usher/admin accounts, one-time temporary passwords,
  reset passwords, deactivate/reactivate, last login, records created per usher.
- **Settings** – church name, usher correction toggle + window, contact visibility,
  groups and locations CRUD.

### Usher (restricted by the server, not just hidden in the UI)
- Sign in with admin-issued credentials.
- Pick today's service → search/filter members → tap **P / A / E** → optional note
  → **Save attendance**. Nothing else is reachable: no members CRUD, no reports,
  no settings, no other users. Contact details are hidden unless the admin allows them.

## Security model

- Passwords hashed with bcrypt (cost 10; 4 in tests). Plaintext is never stored or returned.
- Login rate-limited (10 attempts / 15 min / IP+email) with account-enumeration-safe errors.
- Access JWT (15 min) + refresh JWT (7 days) in **HttpOnly, SameSite=Lax** cookies;
  refresh tokens are rotated and stored as SHA-256 hashes so they can be revoked.
- Logout, deactivation and password reset revoke sessions immediately.
- `authenticate` middleware re-loads the user on every request (deactivated = cut off).
- `requireAdmin` guards every admin-only route server-side; ushers receive `403`.
- All SQL uses parameterised queries; unique constraint prevents duplicate
  member/service attendance even under concurrent writes (upsert semantics).
- Audit trail: `recorded_by_user_id`, `updated_by_user_id`, `recorded_at`, `updated_at`
  on every attendance row; `created_by` on users/services/follow-ups.
- Ushers may correct **only their own** records, only while the admin-enabled window
  (default 30 min) is open.

## API overview (`/api`)

| Area | Endpoints | Access |
|---|---|---|
| Health | `GET /health` | public |
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` | public / signed-in |
| Users | `GET·POST /users`, `PUT /users/:id`, `PATCH /users/:id/status`, `POST /users/:id/reset-password`, `GET /users/:id/attendance-records` | admin |
| Members | `GET·POST /members`, `GET·PUT /members/:id`, `PATCH /members/:id/status`, `GET /members/:id/attendance` | admin |
| Services | `GET /services`, `GET /services/:id` | admin + usher |
| Services | `POST /services`, `PUT /services/:id`, `GET /services/:id/attendance` | admin |
| Attendance | `GET /attendance/roster/:serviceId`, `POST /attendance` | admin + usher |
| Attendance | `PUT /attendance/:id` | admin (or own record within usher window) |
| Attendance | `GET /attendance`, `GET /attendance/:id`, `DELETE /attendance/:id` | admin |
| Groups/Locations | `GET …` shared · `POST·PUT·DELETE …` admin |
| Follow-ups | `/followups` CRUD | admin |
| Reports | `GET /reports/dashboard`, `GET /reports/summary` | admin |
| Settings | `GET /settings/public` shared · `GET·PUT /settings` admin |

Validation errors return `400 { message, errors:[{field,message}] }`; authorization
failures return clear `401`/`403` messages.

## Project structure

```
server/
  src/
    config/     env.js db.js
    middleware/ auth.js (authenticate, requireAdmin) error.js
    routes/     auth users members services attendance groups locations followups reports settings index
    services/   stats.js (streak recompute) settings.js
    utils/      errors validate tokens passwords
  migrations/   001_init.sql
  scripts/      migrate.js seed.js
  tests/        global-setup helpers auth rbac members services attendance users
client/
  src/
    api/          fetch wrapper w/ silent refresh
    auth/         context + route guards
    components/   ui/ (forms display feedback Table Modal SearchInput) layout/ charts/
    hooks/        useFetch useDebounce useRoster
    pages/        login, denied, 404, admin/* (8 pages), usher/* (2 pages)
    styles.css    design tokens + components + responsive rules
```

## Design notes

- Palette: white surfaces, blue primary (`#1d4ed8` family), yellow accent (`#f59e0b`),
  deep navy sidebar — per the final colour directive (white/blue/yellow).
- Status colours: green Present, red Absent, blue Excused, neutral Inactive.
- Tables collapse into labelled cards on small screens; forms are fully labelled
  with `aria-invalid`/`aria-describedby`, dialogs trap focus and close on Esc;
  reduced-motion preferences are respected.

## Assumptions & limitations

- The sign-in page shows **no demo credentials** — nothing about accounts is hardcoded client-side.
- `consecutive_absences` counts leading consecutive `absent` marks; `excused` pauses
  the streak without punishing, `present` resets it.
- CSV export is generated client-side from paginated API data.
- SameSite=Lax cookies + JSON-only APIs are the CSRF mitigation strategy; add a
  token header if you embed the API behind a different origin.
---

## 🚀 Deploying to Vercel

Recommended topology: **one Vercel project** that serves the React build as static
files and runs the Express API as a Serverless Function behind `/api/*`.
Same-origin means cookies and CORS work exactly like local development.

The repo is already wired for this: `api/index.js` (serverless entry),
`vercel.json` (build + rewrites incl. SPA fallback), and root `package.json`
carries the server dependencies so Vercel bundles them.

### 1 · Provision PostgreSQL (one-time)

Vercel does not include a database, so create one first —
[Neon](https://neon.tech) has a free tier and works great:

1. Sign up → **New Project** → copy the **pooled connection string**
   (`postgres://…?sslmode=require`).
2. Supabase / Railway / Render Postgres work equally well; any TCP-reachable
   Postgres 13+ is fine. TLS is auto-detected from `sslmode=` in the URL.

### 2 · Database setup — automatic (no terminal needed)

The app **self-bootstraps**: on its first request it applies pending migrations automatically and, if you set ADMIN_EMAIL + ADMIN_PASSWORD environment variables and no users exist yet, creates that admin for you (password change forced at first login). Nothing to run by hand.

Prefer doing it manually instead? Run these locally against the cloud database:

```powershell
$env:DATABASE_URL = "postgres://user:pass@host/db?sslmode=require"
npm run migrate
npm run create:admin -- "Pastor Kwesi Mensah" "admin@copagonaahanta.app" "ChangeMe-123"
```

`create:admin` upserts a single admin (no demo data). Prefer sample data to
explore first? Use `npm run seed` instead, then reset that password later.

### 3 · Import the repo on Vercel

1. Push the project to GitHub (`.gitignore` already excludes `.env`, `.vercel/`).
2. <https://vercel.com/new> → import the repository.
3. Framework Preset **Other** — build/output settings come from `vercel.json`
   (builds `client/`, serves `client/dist`, routes `/api/*` to the function).
4. Deploy — it will fail-safe until env vars exist; add them now:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Neon/Supabase connection string |
| `JWT_ACCESS_SECRET` | long random string — `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | different long random string |
| `COOKIE_SECURE` | `true` |
| `BCRYPT_ROUNDS` | `10` |

5. Redeploy → open `https://<your-app>.vercel.app`, sign in as the admin,
   change the temp password, create usher accounts under **Users**.

### Alternative: split hosting

Frontend on Vercel + always-on API on Render/Railway/Fly also works. Point the
frontend proxy at nothing (use absolute API URL by serving client from the API
or adding a reverse proxy) and set on the **API host**:

```
CORS_ORIGIN=https://<your-app>.vercel.app
COOKIE_SECURE=true
COOKIE_SAMESITE=none     # required for cross-site cookies
```

### Serverless notes & limits

- The in-memory login rate limiter is per-instance (best-effort on serverless).
- Each function instance keeps its own small pg pool (max 10) — use Neon pooled
  connections to stay under connection limits.
- Migrations never run automatically on deploy; run them manually per step 2.
