# manfred-schedule-linkedin — Design

**Date:** 2026-07-20
**Status:** Approved pending user review
**Author:** Jens Wedin + Claude (brainstorming session)

## Overview

A personal, single-user Buffer-style scheduler for LinkedIn. Jens composes text + image posts, drops them into a recurring queue (e.g. Tue/Thu 08:30) or pins them to an exact time, and the app auto-publishes to his personal LinkedIn profile via Zernio. Posts are written elsewhere (Claude skills); this app is purely a scheduler.

## Goals

- Compose posts (text up to 3,000 chars, plus images) and queue them.
- Buffer-style queue slots with automatic date assignment, plus per-post pin-to-exact-time override.
- Reliable auto-publish at the scheduled time with no laptop open.
- Keep the Manfred WoW intact: CI, Playwright E2E, axe checks, coverage ratchet, design system, Linear-prefixed branches.

## Non-goals (v1)

- Multi-user accounts, teams, billing.
- Posting to the Studio Manfred company page (personal profile only).
- Other networks than LinkedIn.
- AI writing assistance in-app.
- Documents/PDF carousel posts, videos, polls.
- Analytics beyond "published, here's the link".

## Architecture

Stamped from the `Studio-Manfred/manfred-bootstrap` template (Vite + React + TypeScript SPA starter with WoW baked in), deployed on Vercel (Pro).

Four moving parts:

1. **SPA** (`src/`) — Queue, Composer, History, Settings screens. Built with the `@studio-manfred` design system. Talks only to our own API.
2. **API** (`api/`) — Vercel Functions (Node runtime):
   - `POST /api/auth/login`, `POST /api/auth/logout`
   - `GET /api/posts`, `POST /api/posts`, `PATCH /api/posts/:id`, `DELETE /api/posts/:id`
   - `POST /api/posts/reorder` — new queue order for non-pinned posts
   - `POST /api/posts/:id/retry` — re-attempt a failed/missed post
   - `GET /api/slots`, `PUT /api/slots` — weekly schedule editor
   - `POST /api/images` — upload image to Vercel Blob, returns URL
   - `GET /api/connection` — Zernio account status (connected LinkedIn account name)
   - `POST /api/cron/publish` — cron-only publish tick (guarded by `CRON_SECRET`)
3. **Neon Postgres** (Vercel Marketplace) — source of truth for posts and slots.
4. **Vercel Blob** — image storage from compose time until (and after) publish.

**Publishing is delegated to Zernio** (`https://zernio.com/api/v1`): API-key auth, no OAuth tokens in our system. Jens connects his LinkedIn account to Zernio once (their hosted OAuth flow); Zernio maintains that connection. Our cron calls Zernio `createPost` with `publishNow: true` at the scheduled moment — **we do not use Zernio's own scheduling**, so our DB stays the single source of truth and queue reordering is a pure DB operation.

The Zernio call sits behind a small `publisher` interface in the API layer so a direct LinkedIn API implementation can be swapped in later without touching queue logic.

**The tick:** Vercel Cron, every 5 minutes (`*/5 * * * *`), configured in `vercel.json`/`vercel.ts`, calling `POST /api/cron/publish` with `CRON_SECRET`.

## Data model

```sql
posts (
  id            uuid primary key,
  body          text not null,           -- ≤ 3000 chars, enforced in app
  images        jsonb not null default '[]',  -- [{ url, alt }]
  status        text not null,           -- draft|queued|publishing|published|failed|missed
  pinned        boolean not null default false,
  position      integer,                 -- queue order among non-pinned queued posts
  scheduled_at  timestamptz,             -- null for drafts; always set for queued
  zernio_post_id text,
  linkedin_url  text,                    -- platformPostUrl from Zernio after publish
  error         text,
  attempts      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
)

schedule_slots (
  id       serial primary key,
  weekday  integer not null,   -- 0 = Monday … 6 = Sunday
  time_local time not null     -- interpreted in Europe/Stockholm
)
```

Timezone is fixed to `Europe/Stockholm` (a constant, not a setting).

## Queue mechanics

Invariant: **every queued post always has a concrete `scheduled_at`.**

- Slot dealing: non-pinned queued posts, ordered by `position`, are dealt onto the next free slot occurrences (slot occurrences already taken by pinned posts are skipped).
- Add to queue → takes the first free slot; the composer shows the resulting date before confirming.
- Reorder / delete / slot-schedule change → recompute `scheduled_at` for all non-pinned queued posts.
- Pinned posts keep their explicit `scheduled_at` and are excluded from dealing.
- All slot math lives in one pure module, `src/lib/queue.ts`, shared by SPA (preview) and API (authority). No I/O in this module.
- The cron never knows about slots — it only reads `scheduled_at`.

## Publish flow (cron tick)

1. `SELECT` posts with `status = 'queued' AND scheduled_at <= now()`.
2. For each, atomically claim: `UPDATE posts SET status='publishing', attempts = attempts + 1 WHERE id = $1 AND status = 'queued' RETURNING *` — overlapping ticks cannot double-post.
3. **Missed-window guard:** if `scheduled_at` is more than 60 minutes in the past, set `status = 'missed'` instead of publishing (held for manual decision).
4. Call Zernio `POST /posts` with `publishNow: true`, the LinkedIn `accountId`, body text, and image references.
5. On success → `status='published'`, store `zernio_post_id` + `linkedin_url`. On failure → back to `queued` if `attempts < 3` (retried next tick), else `status='failed'` with Zernio's error message.
6. **Sweeper:** any post stuck in `publishing` for > 10 minutes → `failed` (with note). One failed post never blocks the rest of the queue.

## Screens

All built from the Manfred design system; WCAG 2.2 AA per WoW.

- **Queue (home)** — upcoming posts in publish order with computed date/time and pin badges. Reorder via drag **and** keyboard (move up/down buttons). Inline edit/delete. Drafts as a tab on this screen. Empty state links to composer.
- **Composer** — textarea with 3,000-char counter, multi-image attach with previews and an alt-text field per image, actions: *Add to queue* (shows target slot first), *Pin to date & time*, *Save draft*.
- **History** — published posts (with live LinkedIn link) and failed/missed posts with error message and *Retry*.
- **Settings** — weekly slot editor (weekday + time rows), Zernio connection status (connected LinkedIn account shown by name), logout.

## Auth & security

- Single-user gate: `APP_PASSWORD` env var checked at login; on success a signed httpOnly session cookie (secret: `SESSION_SECRET`). Every API route except login and cron requires it. Wrong password → generic error + basic rate limiting.
- Cron endpoint requires `Authorization: Bearer ${CRON_SECRET}`.
- `ZERNIO_API_KEY` lives server-side only; never sent to the browser.
- Vercel Blob URLs are unguessable; images contain nothing secret (they get published to LinkedIn anyway).

### Environment variables

| Var | Purpose |
|---|---|
| `APP_PASSWORD` | single-user login |
| `SESSION_SECRET` | cookie signing |
| `CRON_SECRET` | cron endpoint guard |
| `ZERNIO_API_KEY` | Zernio API auth |
| `ZERNIO_ACCOUNT_ID` | connected LinkedIn account id at Zernio |
| `DATABASE_URL` | Neon Postgres |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |

## Error handling summary

| Failure | Behaviour |
|---|---|
| Zernio/LinkedIn rejects publish | retry next 2 ticks; after 3 attempts → `failed` in History with Retry |
| Overlapping cron ticks | atomic claim prevents double-posting |
| Post stuck `publishing` > 10 min | sweeper marks `failed` |
| Slot time missed by > 60 min (outage) | `missed`, held for manual decision |
| Session expired | redirect to login, no data loss |

## Testing

TDD throughout (WoW).

- **Unit (vitest):** heaviest coverage on `src/lib/queue.ts` — slot dealing, reorder, pinned-skip, slot-schedule changes, and DST transitions in Europe/Stockholm. Time injected, never `Date.now()` in logic.
- **API handler tests:** mocked Zernio client (no test ever posts to LinkedIn) and mocked/ephemeral DB. Cover the atomic claim, retry counting, missed-window guard, and auth guards.
- **E2E (Playwright):** compose → add to queue → reorder → pin flows against a mocked API, including one keyboard-only reorder run; axe checks on every screen.
- Starter's coverage ratchet stays on.

## Prerequisites & setup notes

1. **Zernio:** sign up (first 2 connected accounts free), create profile, connect Jens's LinkedIn via their OAuth flow, create API key, note the LinkedIn `accountId`.
2. **Bootstrap:** the target directory already exists (with this spec committed), so the template's `new` mode (which requires a non-existent dir) can't run directly — stamp the starter into a temp dir and merge, or use the script's `overlay` mode plus a manual copy of `starter/`. Decide in the implementation plan.
3. **Provisioning:** GitHub repo (Studio-Manfred, private), Vercel project (Pro account; add Neon + Blob from Marketplace), Linear team prefix STU per WoW.
4. New DS-consuming repos 403 in CI until granted Actions access on the `manfred-design-system` package (one-time, UI-only — known gotcha).

## Open items (resolve during implementation, none block the design)

- Exact Zernio media parameter: whether images are passed as public URLs (Vercel Blob URLs) in `createPost` or uploaded to a Zernio media endpoint first — confirm against `docs.zernio.com/guides/media-uploads`.
- Whether Zernio forwards per-image alt text to LinkedIn; if not, alt text is still stored on our side and the limitation is noted in the UI.
