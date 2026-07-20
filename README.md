# manfred-schedule-linkedin

A personal, single-user Buffer-style scheduler for LinkedIn. Jens composes text + image
posts, drops them into a recurring queue (e.g. Tue/Thu 08:30 Europe/Stockholm) or pins
them to an exact time, and the app auto-publishes to his LinkedIn profile with no laptop
open. Posts are written elsewhere (Claude skills) — this app only schedules and publishes.

> **Status:** built and tested (backend, 5 frontend screens, E2E + accessibility). Not
> yet deployed — first production deploy is a pending follow-up. See `changelog.md`.

## Architecture

Four moving parts, in a straight line:

```
SPA (src/)  →  api/ (Vercel Functions)  →  Neon Postgres + Vercel Blob
                       ↑
              Vercel Cron (*/5 * * * *)
                       ↓
                    Zernio API  →  LinkedIn
```

1. **SPA** (`src/`) — Queue, Composer, History, Settings screens, built with the
   `@studio-manfred` design system. Talks only to our own `api/`.
2. **`api/`** — Vercel Functions (Node runtime) for auth, posts CRUD, reorder, retry,
   slots, image upload, connection status, and the cron-only publish tick.
3. **Neon Postgres** — source of truth for posts and the weekly slot schedule.
4. **Vercel Blob** — durable image storage from compose time onward.
5. **Vercel Cron** — every 5 minutes, calls `POST /api/cron/publish` (guarded by
   `CRON_SECRET`) to claim and publish anything due.
6. **Zernio** (`https://zernio.com/api/v1`) — holds the actual LinkedIn OAuth connection
   and does the publishing. Our cron calls Zernio's `createPost` with `publishNow: true`
   at the scheduled moment — we do **not** use Zernio's own scheduling, so our DB stays
   the single source of truth and queue reordering is a pure DB operation. See
   `knowledge/zernio.md` for the API details (auth, idempotency, media flow).

Queue mechanics (slot dealing, pin-to-exact-time, reorder) live in one pure module,
`src/lib/queue.ts`, shared by the SPA (preview) and the API (authority) — no I/O in that
module. Full design rationale: `docs/superpowers/specs/2026-07-20-linkedin-scheduler-design.md`.

## Local dev

```bash
# one-time: a GitHub token with read:packages, for the private @studio-manfred design system
export GITHUB_TOKEN=$(gh auth token)   # or a classic PAT with read:packages
npm install

# once the Vercel project is provisioned (Neon + Blob + env vars set there):
vercel env pull .env.local

npm run migrate     # applies migrations/*.sql against DATABASE_URL
npm run dev         # or: vercel dev, to run api/ locally alongside the SPA
```

## Test commands

| Command | What it runs |
| --- | --- |
| `npm run test:run` | Vitest unit/component suite, once |
| `npm run test:e2e` | Playwright E2E (builds + previews first), incl. axe a11y sweeps |
| `npm run typecheck:api` | `tsc -p api` — typechecks the Vercel Functions separately from the SPA |
| `npm run coverage:check` | coverage ratchet gate (fails if coverage drops below the recorded floor) |
| `npm run test` | Vitest, watch mode |
| `npm run test:coverage` | Vitest with coverage report |
| `npm run typecheck` | `tsc -b --noEmit` for the SPA |
| `npm run lint` | ESLint (flat config, incl. `jsx-a11y`) |
| `npm run build` | typecheck + production build |
| `AXE_ENFORCE=1 npm run test:e2e` | makes the axe sweep merge-blocking |

## Environment variables

Copy `.env.example` to `.env.local` (or `vercel env pull .env.local` once provisioned):

| Var | Purpose |
| --- | --- |
| `APP_PASSWORD` | Single-user login password, checked at `/api/auth/login`. |
| `SESSION_SECRET` | 32+ random bytes used to sign the httpOnly session cookie. |
| `CRON_SECRET` | Guards `/api/cron/publish`; Vercel sends it automatically when set in project env. |
| `ZERNIO_API_KEY` | Zernio API auth (Settings → API Keys at zernio.com). Server-side only, never sent to the browser. |
| `ZERNIO_ACCOUNT_ID` | Zernio SocialAccount id of the connected LinkedIn account (`GET /api/v1/accounts`). |
| `DATABASE_URL` | Neon Postgres connection string (Vercel Marketplace integration provides this). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write token (provided by the Blob store integration). |

## Deployment

Deploys automatically on push to `main` via the Vercel-GitHub integration (no manual
deploy step). Vercel Cron is configured in `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/publish", "schedule": "*/5 * * * *" }] }
```

Prerequisites before the first deploy: Zernio account connected to Jens's LinkedIn +
API key issued; Vercel project with Neon and Blob added from the Marketplace; all env
vars above set in the Vercel project; new DS-consuming repos 403 in CI until granted
Actions access on the `manfred-design-system` GitHub package (one-time, UI-only gotcha —
see `docs/superpowers/specs/2026-07-20-linkedin-scheduler-design.md`, Prerequisites & setup notes).

## Operational notes

- **Zernio holds the LinkedIn connection**, not us. If publishes start failing with auth
  errors, reconnect the LinkedIn account in the Zernio dashboard — nothing to fix in this
  app's code or env vars.
- **Missed posts:** if a queued post's `scheduled_at` is more than 60 minutes in the past
  when a tick finally reaches it (e.g. after an outage), it's marked `missed` instead of
  published, and held for a manual decision (retry or edit) rather than auto-firing late.
- **Retries:** a failed publish attempt goes back to `queued` for up to 3 total attempts;
  after that it's marked `failed` with Zernio's error message, visible in History with a
  *Retry* action.
- **Stuck-publishing sweep:** any post stuck in `publishing` for more than 10 minutes
  (e.g. a crashed tick) is marked `failed` by the next tick's sweeper, so one bad post
  never blocks the rest of the queue.
- **Zernio idempotency:** every publish call sends `x-request-id: <post uuid>`; a `409`
  response means Zernio's 24h content-hash dedup already published identical content —
  treated as success.
- **First comment:** a post can carry an optional first comment that Zernio auto-posts
  immediately after publishing (`platformSpecificData.firstComment`). Put external links
  here — LinkedIn suppresses posts with links in the body by ~40–50%. Blank means no
  comment; the field is capped at 1,250 characters.
- **Monthly View:** the Queue screen has a month-calendar tab (Monday-first, Europe/
  Stockholm) showing every dated post. Click a chip to edit it (published posts open on
  LinkedIn); click ＋ on a future day to compose a post pinned there; drag a queued/failed/
  missed post to another day to reschedule it (keeps its time of day). Keyboard/AT users
  reschedule via the chip → composer → edit-date path (WCAG 2.2 SC 2.5.7). It reads the
  posts already loaded on the Queue screen — no extra API calls.

## Where the way-of-working lives

- `AGENTS.md` / `CLAUDE.md` — how agents (and people) work in this repo.
- `MEMORY.md` — the session log.
- `knowledge/` — the project flywheel (`INDEX.md`, `ERRORS.md`, `zernio.md`, `ui-patterns.md`).
- `changelog.md` — release history.
