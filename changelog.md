# Changelog

## [Unreleased]

### Added
- Composer: optional **first comment**, auto-posted right after the post publishes. Sent to
  Zernio as `platformSpecificData.firstComment` on the LinkedIn platform entry (omitted when
  blank). Best used for external links — LinkedIn suppresses posts that carry links in the
  body by ~40–50%, so the pattern is "…see the comments for links 👇" in the post with the
  URL in the first comment. Persisted via a new nullable `first_comment` column
  (migration `002_first_comment.sql`); capped at 1,250 characters (LinkedIn's comment
  limit). (STU-669)
- Queue: a **Monthly View** tab — a Buffer-style month calendar (Monday-first, Europe/
  Stockholm) of every dated post. Click a chip to edit it (or open a published post on
  LinkedIn); click ＋ on a future day to compose pinned there; **drag** a queued/failed/
  missed post to another day to reschedule it (keeps its time of day, DST-correct). Client-
  side over already-loaded posts — no new API. (STU-670) Dragging shows a grab cursor and a
  floating preview of the post, dims the source, and highlights the target day. (STU-671)

### Changed
- Queue: deleting a post now opens a design-system confirmation dialog (Cancel / Delete
  post) instead of the browser's native `confirm`. (STU-672)

## 0.1.0 — 2026-07-20 (pending first production deploy)

Initial build: single-user LinkedIn scheduler. Backend, all five frontend screens, and
the E2E/accessibility suite are complete and passing locally; Task 17 (provisioning +
first production deploy) has not run yet, so this version is not live.

- Buffer-style queue slots (Europe/Stockholm) with automatic date dealing and a
  per-post pin-to-exact-time override
- Composer: text posts up to 3,000 chars, multi-image attach with enforced alt text
  per image, add-to-queue / pin / save-draft actions
- Auto-publish via Zernio (`publishNow`) on a 5-minute Vercel Cron
  (`*/5 * * * *`, `POST /api/cron/publish`)
- Atomic claim per tick so overlapping ticks can't double-post
- Retry on failure (up to 3 attempts), missed-window guard (held as `missed` if a slot
  is more than 60 minutes late), stuck-publishing sweeper (10 minutes)
- Queue screen with drag *and* keyboard reorder, drafts tab, inline edit/delete
- History screen with live LinkedIn links for published posts and Retry for
  failed/missed posts
- Settings screen: weekly slot editor, Zernio connection status, logout
- Single-user auth: `APP_PASSWORD` login + signed httpOnly session cookie
- Vitest unit/component coverage (heaviest on `src/lib/queue.ts` slot-dealing logic,
  incl. DST transitions), Playwright E2E, axe WCAG 2.2 AA checks on every screen,
  coverage ratchet
