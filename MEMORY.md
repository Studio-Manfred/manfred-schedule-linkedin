# MEMORY — manfred-schedule-linkedin

Session log. Newest first. One entry per working session; record what shipped, what is
half-done, and the next pickup point. Convert relative dates to absolute.

## 2026-07-20 — v1 build · docs + memory (Task 18) · built & tested, deploy pending

- **Shipped:** the full v1 build per
  `docs/superpowers/specs/2026-07-20-linkedin-scheduler-design.md` — backend (`api/`:
  auth, posts CRUD, reorder, retry, slots, image upload, connection status, cron
  publish tick), all five frontend screens (Login, Queue, Composer, History,
  Settings), and the test suite (Vitest unit/component incl. heavy `src/lib/queue.ts`
  coverage, Playwright E2E, axe a11y sweeps, coverage ratchet). This session (Task 18):
  rewrote `README.md`, added `changelog.md` (0.1.0, pending-first-deploy), added
  `knowledge/zernio.md`, updated `knowledge/INDEX.md`.
- **Status:** **not yet deployed.** Task 17 (Zernio/Vercel/Neon/Blob provisioning +
  first production deploy) has not run. Nothing in this app is live; treat any
  "it's deployed" claim as wrong until that task actually executes.
- **Decisions:** publishing is delegated entirely to Zernio (`publishNow`, no
  Zernio-side scheduling) so our Neon DB stays the single source of truth; queue math
  lives in one pure, DB-free module (`src/lib/queue.ts`) shared by SPA preview and API
  authority; a retry re-deals a failed *pinned* post onto the queue (unpins it) rather
  than re-pinning a now-past time; `POST /api/posts` `action` defaults to `draft`.
- **Known follow-ups (not blockers for v1, worth picking up later):**
  - `src/App.tsx` has no unit test file — its routing/shell behaviour is covered only
    by the Playwright E2E suite, not Vitest.
  - The Queue screen's ARIA tabs (`role="tablist"`/`role="tab"` in
    `src/screens/QueueScreen.tsx`) are missing `aria-controls` and an associated
    `role="tabpanel"` — works today but isn't a fully wired ARIA tabs pattern.
  - `migrations/001_init.sql`'s `time_local` CHECK (`^[0-2][0-9]:[0-5][0-9]$`) is looser
    than the app's own time validation — e.g. `29:59` passes the DB regex. Not a live
    bug (app never sends such a value) but worth tightening at the DB layer eventually.
  - Multi-row repo writes — `saveSchedule`, `setPositions` (`api/_lib/posts-repo.ts`)
    and `replaceSlots` (`api/_lib/slots-repo.ts`) — loop plain `UPDATE`/`INSERT`
    statements per row rather than wrapping in a single DB transaction. Fine at
    single-user scale; a crash mid-loop could leave a partial write.
- **Cut from v1, explicit v2 candidates (see design spec "Non-goals"):**
  Studio Manfred company-page posting (personal profile only in v1), documents/PDF
  carousel posts, video, polls, in-app AI drafting/writing assistance, and analytics
  beyond "published, here's the LinkedIn link."
- **Next pickup:** run Task 17 — provision Zernio (connect LinkedIn, API key), Vercel
  project (Neon + Blob from Marketplace, all env vars from `.env.example`), grant the
  `manfred-design-system` Actions-access gotcha for this repo, then first deploy. After
  that, watch the first few real cron ticks before trusting the queue unattended.
