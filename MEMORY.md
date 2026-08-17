# MEMORY — manfred-schedule-linkedin

Session log. Newest first. One entry per working session; record what shipped, what is
half-done, and the next pickup point. Convert relative dates to absolute.

## 2026-08-18 — Neon Free compute quota exhausted → publish cron slowed to 30 min

- **Trigger:** Neon reported `100.16 / 100 CU-hrs` mid-month on ~zero real traffic.
- **Root cause (confirmed, not guessed):** the publish cron ran `*/5 * * * *` (every 5 min)
  in `vercel.json`. Neon Free auto-suspends only after **5 min idle**, and every tick fires
  two Postgres writes (`sweepStuck` + `claimDuePosts`, `api/_lib/publish-tick.ts`) that run
  even when nothing is due — so the compute never reached idle and stayed awake ~24/7
  (~182 CU-hrs/mo). No client-side polling exists; the cron was the sole scheduled DB-toucher.
  Neon's HTTP driver (`neon()` in `api/_lib/db.ts`) is one-shot per query, so this is purely a
  wake-from-query problem, not connection pooling. Free plan can't lower the 5-min suspend
  delay (paid feature), so cron cadence is the only lever.
- **Change made (local, uncommitted):** `vercel.json` cron `*/5` → `*/30 * * * *`
  (~30 CU-hrs/mo, comfortably under quota; posts still publish inside the 60-min
  `MISSED_WINDOW_MINUTES`). User chose 30 min over 15 (~60) / hourly (~15, too tight vs the
  60-min window). Docs updated in the same change: `CHANGELOG.md` [Unreleased] › Fixed,
  `knowledge/ERRORS.md` (new 2026-08-18 entry, graduated cross-project). The article the user
  cited (hontran.dev) diagnosed the *cause* correctly but its `unstable_cache`/Upstash-Redis
  fixes are Next.js/Prisma-specific and don't apply to this Vite-SPA + `api/` stack.
- **Ticket:** STU-686 (High) — filed, In Progress. Branch `feat/STU-686-neon-cron-cadence`,
  conventional commit `fix(cron): …`, PR opened with `Closes STU-686`.
- **Next pickup:** **review + squash-merge the STU-686 PR**, which triggers the Vercel prod
  deploy — the cron cadence only actually changes once the new `vercel.json` is live. Then
  watch the Neon compute graph flip from flat-active to a sawtooth that drops to suspended
  between ticks. This month's quota is already spent and resets next billing cycle — the DB
  comes back on its own; the fix prevents recurrence.

## 2026-07-20 — live in prod · feature wave STU-669..672 (v0.2.0)

- **Status: LIVE in production** at https://manfred-schedule-linkedin.vercel.app. The
  "not yet deployed" warning in the older entry below is superseded — provisioning +
  first deploy happened, and a real post published to LinkedIn.
- **Shipped this session (four PRs, each ticket → branch → TDD → CI → squash-merge →
  Vercel prod deploy):**
  - **STU-669 — first comment.** Optional per-post `firstComment` (DB column
    `first_comment`, migration `002`), sent to Zernio as
    `platforms[0].platformSpecificData.firstComment`, omitted when blank, ≤1250 chars.
    Point of it: LinkedIn suppresses in-body links ~40–50%, so links go in an
    auto-posted first comment ("see comments for links"). Ran `npm run migrate` against
    prod Neon before merge.
  - **STU-670 — Monthly View.** Third Queue tab: a month calendar (Monday-first,
    Europe/Stockholm) of every dated post. Pure `src/lib/calendar.ts`
    (`buildMonthGrid` / `stockholmDayKey` / `stockholmTime` / `rescheduleIso`) +
    presentational `src/components/MonthCalendar.tsx` (dnd-kit). Click chip → edit /
    open-on-LinkedIn; click ＋ future day → composer `?pin=YYYY-MM-DD`; drag
    queued/failed/missed chip → pin to new day keeping its time-of-day. Client-side over
    already-loaded posts, no new API.
  - **STU-671 — drag feedback.** Grab/grabbing cursor, dnd-kit `DragOverlay` floating
    preview, dimmed source, highlighted target cell.
  - **STU-672 — delete dialog.** Replaced `window.confirm` with the DS `Dialog`
    (`Button variant="destructive"`), one controlled dialog driven by `pendingDelete`.
- **Decisions:** drag a11y is pointer-only by design — the non-drag alternative
  (WCAG 2.2 SC 2.5.7) is click-chip → composer → edit-date; no brittle 2D-grid keyboard
  drag. All calendar touch targets ≥24px (SC 2.5.8, caught by the axe sweep). Kept
  everything client-side over the existing pin API — no new endpoints or deps.
- **Gotchas hit (see knowledge/ERRORS.md):** first PR from this repo 403'd in CI on the
  DS package until Actions-access was granted; skipping `npm run coverage:check` locally
  let a branch-coverage dip reach CI (always run it before pushing); Playwright reuses an
  existing preview server (`reuseExistingServer`) so kill stale ones before a throwaway;
  `getByRole('button', {name:/delete/i})` matched a card whose body contained "delete" —
  use `{name:'Delete', exact:true}`.
- **Next pickup:** open follow-ups from the specs' non-goals — Monthly View **Week toggle**
  and **per-day detail popover**; optionally show post body text on calendar chips (today
  they show time + status dot only). Older known follow-ups (App.tsx unit test, ARIA
  tabs `aria-controls`, DB `time_local` CHECK, non-transactional multi-row writes) still
  stand.

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
