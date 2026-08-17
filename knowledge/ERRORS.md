# Errors — manfred-schedule-linkedin

Project-local error log.

- **Deterministic errors** (bad schema, wrong type, missing field) → conclude immediately,
  fix, link the conclusion into a category file.
- **Infrastructure errors** (timeout, rate limit, network) → log only; no conclusion until
  a pattern emerges.

Format:

```markdown
## YYYY-MM-DD — short title

- **Symptom:**
- **Cause:**
- **Fix / conclusion:**
- **Graduated to:** knowledge/<category> or my-process/docs/knowledge/ (when recurring)
```

---

## 2026-08-18 — coverage ratchet fails on unrelated PRs (time-dependent branch coverage)

- **Symptom:** `npm run coverage:check` failed CI on a **docs/config-only** PR — `branches 84.98%`
  vs baseline `85.63%` (−0.65pp, over the 0.5pp tolerance) — with zero source or test changes.
  Reproduced on `main`; meanwhile `statements`/`lines` had *risen* to 91.64% (the fingerprint of
  nondeterministic, not regressed, coverage).
- **Cause:** coverage was **time-dependent**. `src/components/MonthCalendar.tsx` (`now ?? new Date()`)
  and `src/screens/ComposerScreen.tsx` (`dealSchedule({ now: new Date() })`) fall back to the real
  clock, and the tests exercising them (`QueueScreen.test`, `ComposerScreen.test`) didn't pin it —
  there was no global fake clock in `test/setup.ts`. The baseline was captured in July; as the wall
  clock rolled into August the calendar's "current month" moved and past/future branches flipped,
  drifting branch coverage below tolerance. An innocent PR (STU-686) took the blame.
- **Fix / conclusion:** freeze the suite clock in `test/setup.ts` —
  `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime('2026-07-15T09:00:00.000Z')` in
  `beforeAll`, `vi.useRealTimers()` in `afterAll`. Fake **only** `Date` so real timers keep
  user-event / Testing-Library async working (and keep their fake-timer detection off). Coverage is
  now identical run-to-run and date-to-date (verified twice: branches 85.34%, within tolerance — no
  baseline change needed). Rule: a coverage ratchet is only sound if the suite clock is frozen; any
  `new Date()`/`Date.now()` in covered code makes the gate drift with the calendar. (STU-687)
- **Graduated to:** cross-project — any repo pairing a coverage ratchet with date-dependent code must
  freeze the test clock, or the gate flakes as time passes.

## 2026-08-18 — Neon Free compute quota (100 CU-hrs) exhausted on ~zero traffic

- **Symptom:** Neon reported compute usage `100.16 / 100 CU-hrs` mid-month despite the app
  being essentially unused. Neon Free meters **compute-hours** (time the compute is awake),
  not requests/rows — a 0.25 CU compute pinned awake 24/7 burns ~182.5 CU-hrs/month.
- **Cause:** `vercel.json` ran the publish cron on `*/5 * * * *` (every 5 min). Neon
  auto-suspends (scale-to-zero) only after **5 minutes idle**, and every cron tick issues two
  Postgres **writes** (`sweepStuck` + `claimDuePosts` in `api/_lib/publish-tick.ts`, both
  `UPDATE`s that run even when nothing is due — writes can't be cached and always wake the
  compute). A 5-minute cadence against a 5-minute idle threshold means the compute never
  reaches idle → ~100% uptime → quota blown by mid-month regardless of visitor count. The
  Free plan's 5-minute scale-to-zero delay is **not** configurable (paid feature), so cron
  cadence is the only lever.
- **Fix / conclusion:** widen the cron interval. Lowered to `*/30 * * * *` (~30 CU-hrs/month),
  which still publishes well inside the 60-minute `MISSED_WINDOW_MINUTES`. Rule of thumb on a
  serverless/scale-to-zero DB: **nothing may touch the DB on a schedule more often than the
  suspend threshold** (here 5 min) or the compute never sleeps. Diagnosis credit: the
  query-pattern framing in hontran.dev/blog/neon-database-hitting-limit-low-traffic (its own
  `unstable_cache`/Redis fixes are Next.js/Prisma-specific and don't apply to this Vite-SPA +
  `api/` shape).
- **Graduated to:** cross-project gotcha for any Vercel-cron + Neon-Free (or any scale-to-zero
  DB) project — the cron interval must exceed the DB's auto-suspend delay.

## 2026-07-20 — Vercel serverless functions crash with ERR_MODULE_NOT_FOUND

- **Symptom:** SPA loads (200) but every `/api/*` function returns 500
  `FUNCTION_INVOCATION_FAILED`. Runtime log: `Error [ERR_MODULE_NOT_FOUND]: Cannot find
  module '/var/task/api/_lib/http' imported from /var/task/api/cron/publish.js`. All local
  gates (tsc, vitest, Vite build, ESLint, Playwright) were green.
- **Cause:** `package.json` has `"type": "module"`, so Vercel emits the functions as ESM.
  Node's ESM loader requires **explicit file extensions** on relative imports, but the code
  used extensionless imports (`from '../_lib/http'`). Every local tool resolves these because
  all tsconfigs use `moduleResolution: "bundler"` and Vite/vitest use esbuild — so the bug is
  invisible until it runs on Vercel's plain Node ESM runtime, which does not bundle these
  shared `api/_lib/*` files.
- **Fix / conclusion:** add `.js` extensions to every relative import in the files Vercel runs
  (`api/**/*.ts` non-test + the `src/lib/*` modules they import). `.js` specifiers resolve
  correctly under `bundler` resolution too, so tsc/vitest/Vite stay green. This is a
  ship-with-the-stack gotcha for any Vite-SPA-plus-`api/`-functions project on Vercel.
- **Graduated to:** applies to every project using this SPA + serverless-functions shape.

## 2026-07-20 — SPA catch-all rewrite shadows dynamic API routes (405 on PATCH/DELETE)

- **Symptom:** static API routes work (`GET/POST /api/posts`, `/api/slots`, `/api/auth/*`),
  but `PATCH`/`DELETE /api/posts/:id` and `POST /api/posts/:id/retry` return **405** with an
  empty (non-JSON) body. In the UI: "request failed (405)" when editing, pinning, deleting, or
  retrying. Tell-tale: `GET /api/posts/<anything>` returns **200 (SPA HTML)** instead of the
  handler's own response.
- **Cause:** `vercel.json` had `"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]`.
  Vercel resolves **static** function routes in the filesystem phase (before rewrites) but
  **dynamic** routes (`/api/posts/[id]`) *after* rewrites — so the catch-all grabbed
  `/api/posts/<uuid>` and served `index.html` (a static asset that only allows GET/HEAD → 405
  for PATCH/DELETE). Only dynamic routes were affected, which is why create/list worked.
- **Fix / conclusion:** exclude `/api/` from the SPA fallback with a negative lookahead:
  `"source": "/((?!api/).*)"`. Any Vite-SPA-plus-`api/`-functions project on Vercel needs this;
  the naive `/(.*)` catch-all silently breaks every dynamic API route.
- **Graduated to:** ship-with-the-stack gotcha for SPA + `api/` functions on Vercel.

## 2026-07-20 — first PR from a new DS-consuming repo 403s in CI

- **Symptom:** the repo's first GitHub Actions run failed at `npm ci` with
  `403 Forbidden - GET https://npm.pkg.github.com/download/@studio-manfred/manfred-design-system/...`
  `permission_denied: read_package`. Local installs and Vercel builds were fine (Vercel
  uses its own token).
- **Cause:** the private DS package is a GitHub Packages npm package. A *different* repo's
  Actions token (`GITHUB_TOKEN`, even with `permissions: packages: read`) can only pull it
  once that repo is added to the package's **Manage Actions access** allow-list. The repo
  workflow was already correct; the grant simply hadn't been made for this repo.
- **Fix / conclusion:** org admin → the `manfred-design-system` package → Package settings →
  Manage Actions access → add this repo with **Read**, then re-run. One-time per repo.
- **Graduated to:** already a cross-project fact in auto-memory (`new-repo-ds-ci-access`).

## 2026-07-20 — testing/tooling gotchas (drag + dialog feature wave)

- **Coverage ratchet is a CI gate — run it locally.** Skipping `npm run coverage:check`
  before pushing let a branch-coverage dip (new dnd-kit `DragOverlay` code) fail CI.
  Recovered by exporting + unit-testing the presentational overlay. Always run
  `npm run test:coverage && npm run coverage:check` (and `AXE_ENFORCE=1 npm run test:e2e`)
  before pushing.
- **Playwright reuses a running preview server.** `playwright.config.ts` sets
  `reuseExistingServer: !CI`, so a throwaway/E2E run can silently serve a *stale* build
  from an earlier invocation (dialog code "missing"). Kill lingering `vite preview`
  processes (port 4173) before a fresh throwaway, or confirm `dist/` contains the new code.
- **`getByRole('button', { name: /delete/i })` matches by substring.** A post card whose
  body was "A post I might delete" made the card's own activator button match `/delete/i`,
  so `.first()` clicked the card, not the Delete action. Use `{ name: 'Delete', exact: true }`
  (and scope with `within(card)`), or avoid the matched word in fixture text.

## Seeded stack gotchas (ship with the starter — not incidents in this repo)

These were hit downstream (manfred-workshops, 2026-07-13) and will recur in any project
on this stack. Kept here so they are found *before* they cost debugging time again.

### TanStack Query v5 — `mutationFn` leaks a phantom 2nd argument

- **Symptom:** `expect(spy).toHaveBeenCalledWith(id)` fails — the spy received a second,
  unexpected object argument; APIs with an optional 2nd parameter can misbehave.
- **Cause:** v5 calls `mutationFn(variables, context)`. Passing a single-arg API function
  directly (`mutationFn: api.deleteThing`) forwards the context object as argument 2.
- **Fix / conclusion:** always wrap: `mutationFn: (id) => api.deleteThing(id)`.

### PGlite + parallel Vitest — intermittent hook timeouts in full runs

- **Symptom:** db test files all pass in isolation, but full runs intermittently blow the
  15s hook timeout.
- **Cause:** many Vitest workers each booting their own PGlite instance contend on startup.
- **Fix / conclusion:** if a PGlite test harness lands in this repo, mitigate up front:
  cap workers/pool for db suites, raise `hookTimeout`, or share a template database.
