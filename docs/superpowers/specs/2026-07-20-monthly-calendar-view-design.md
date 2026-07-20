# Monthly View — Design Spec

**Date:** 2026-07-20
**Feature:** A Buffer-style month calendar as a third tab on the Queue screen.
**Ticket:** STU-670.

## Goal

Give the single user a month-at-a-glance overview of scheduled LinkedIn posts,
as a new **"Monthly View"** tab alongside the existing Upcoming / Drafts tabs on
the Queue screen. It reuses posts already loaded in the client — no new API.

## Non-goals (explicit, easy follow-ups)

- A Week-view toggle (Buffer has one). Month only for v1.
- Channel filters (we are LinkedIn-only, so there is nothing to filter).
- A per-day detail popover (the "+N more" label is non-interactive in v1).
- Server-side per-month fetching / pagination (single-user, tiny volume — YAGNI).

## Approach

Approach A (chosen): a **pure grid helper** plus a **presentational
`MonthCalendar` component**, navigating client-side over the posts the Queue
screen already holds. Date math with `date-fns` / `@date-fns/tz`; no calendar
library (rejected: heavy bundle, off-DS styling, a11y not ours). No new endpoint
(rejected: unnecessary for a single user).

## Architecture & units

### 1. `src/lib/calendar.ts` — pure, TDD

The correctness core. Builds the grid skeleton and buckets posts onto the right
**Europe/Stockholm** civil day.

```ts
import type { Post } from './types'

export interface DayCell {
  dayKey: string        // 'YYYY-MM-DD' civil day (Stockholm)
  dayOfMonth: number    // 1..31, for display
  inCurrentMonth: boolean
  isToday: boolean
  isPast: boolean       // civil day strictly before today (Stockholm)
  posts: Post[]         // posts whose Stockholm scheduled day == dayKey, time asc
}

export interface MonthGrid {
  year: number
  month: number         // 0..11
  weeks: DayCell[][]    // exactly 6 weeks x 7 days, Monday-first
}

/** Stockholm civil day key ('YYYY-MM-DD') for a UTC instant. */
export function stockholmDayKey(iso: string, timeZone: string): string

/** Stockholm 'HH:MM' (24h) for a UTC instant — for chip labels. */
export function stockholmTime(iso: string, timeZone: string): string

export function buildMonthGrid(
  year: number,
  month: number,                                   // 0..11
  posts: Post[],
  opts: { now: Date; timeZone: string },
): MonthGrid

/**
 * The UTC instant for rescheduling `post` onto Stockholm civil day
 * `targetDayKey` ('YYYY-MM-DD') while KEEPING its current Stockholm time of day.
 * DST-correct (uses @date-fns/tz `TZDate`, so the same wall-clock time on a
 * different date maps to the right offset). Falls back to 09:00 if the post has
 * no `scheduledAt`.
 */
export function rescheduleIso(post: Post, targetDayKey: string, timeZone: string): string
```

**Grid skeleton** uses UTC-based civil arithmetic (timezone-independent integer
calendar — the standard trick, immune to the test runner's local TZ and DST):

- `first = new Date(Date.UTC(year, month, 1))`; weekday `w = first.getUTCDay()`
  (0=Sun..6=Sat) → Monday-first index `lead = (w + 6) % 7`.
- 42 cells: for `i` in `0..41`, `d = new Date(Date.UTC(year, month, 1 - lead + i))`;
  read `getUTCFullYear/Month/Date`; `dayKey` = zero-padded `YYYY-MM-DD`.
- `inCurrentMonth = d.getUTCMonth() === month`.
- `todayKey = stockholmDayKey(opts.now.toISOString(), timeZone)`; ISO date
  strings compare lexicographically, so `isToday = dayKey === todayKey`,
  `isPast = dayKey < todayKey`.

**Post placement:** only posts with `scheduledAt != null` (drafts have no date, so
they never appear). Bucket by `stockholmDayKey(post.scheduledAt, timeZone)`; sort
each cell's posts by `scheduledAt` ascending. Posts falling outside the visible 42
days are simply not shown (they belong to another month).

`stockholmDayKey` / `stockholmTime` use `Intl.DateTimeFormat('sv-SE', { timeZone,
… }).formatToParts(new Date(iso))` — consistent with the app's existing sv-SE /
`TIMEZONE` formatting.

### 2. `src/components/MonthCalendar.tsx` — presentational

Owns the **displayed-month** state (prev/next/today) internally and renders the
grid. The **selection** actions (clicking a post, adding on a day) are lifted to
callbacks so the component stays easily testable; the Queue screen wires them to
navigation.

```ts
export interface MonthCalendarProps {
  posts: Post[]
  now?: Date                                   // default: new Date(); injected in tests
  timeZone?: string                            // default: TIMEZONE
  onSelectPost(post: Post): void               // chip click
  onSelectDay(dayKey: string): void            // empty future-day ＋ click
  onReschedule(post: Post, targetDayKey: string): void  // drag chip → drop on a day
}
```

- Local state: `{ year, month }`, initialised from `now` (Stockholm). Nav:
  **‹ Prev**, **Today**, **Next ›** buttons update it. Title shows e.g.
  "September 2026" (sv-SE month + year).
- Renders a `<table>`:
  - `<caption class="sr-only">` naming the month.
  - `<thead>` one row of `<th scope="col">` weekday names (Mon..Sun), each with a
    visible short label and an sr-only full name.
  - `<tbody>` 6 `<tr>`, 7 `<td>` each. A cell shows its `dayOfMonth`
    (muted when `!inCurrentMonth`, ring/emphasis when `isToday`) and its stacked
    post chips.
- **Chip**: a `<button>` per post — visible content is `stockholmTime` + a status
  dot + a small thumbnail (first image, if any). Accessible name:
  `"{Edit|Open published post} — {weekday} {day} {month} {HH:MM}: {body preview}"`
  (body preview ≈ first 40 chars). `onClick → onSelectPost(post)`. Status dot
  color: queued/pinned neutral, published green (`bg-green-500`), failed/missed
  red (`bg-destructive`). A pinned post also shows a 📌 marker.
- **Overflow**: show up to 3 chips per day; if more, a final non-interactive
  muted `"+N more"` label. (A per-day detail popover is a noted v2 follow-up; a
  single user rarely has >3 posts on one day, so v1 keeps it simple and avoids a
  dead-end control.) Cap keeps cells from ballooning.
- **Add-on-day affordance**: each **today-or-future** cell carries one small
  dedicated `<button>` (e.g. a "＋" in the cell corner, `aria-label="Add a post on
  {weekday} {day} {month}"`) → `onSelectDay(dayKey)`. It is a **sibling** of the
  chip buttons, never a wrapper around them — no nested interactive elements
  (the same rule we applied to draggable PostCards). **Past** days have no add
  button (you cannot pin to the past — the composer enforces future-only) and are
  rendered visibly muted.
- **a11y:** an `aria-live="polite"` region announces the month when it changes.
  Everything actionable is a native `<button>`, so keyboard + screen-reader work
  for free. (Arrow-key roving-grid navigation is a deliberate v2 nicety; standard
  Tab order is sufficient and accessible for v1.)

**Drag-to-reschedule.** Reuses **dnd-kit** (already a dependency, already used for
the queue reorder) for pointer dragging.

- A single `DndContext` wraps the grid. **Draggable** = chips whose post status is
  `queued | failed | missed` (via `useDraggable`). **Published** chips are not
  draggable (already went out); drafts aren't on the calendar. **Droppable** =
  every **today-or-future** day cell (via `useDroppable`); past cells are not drop
  targets.
- On drag end, if dropped over a valid future/today cell **and** the day actually
  changed, call `onReschedule(post, targetDayKey)`. Dropping on the same day, a
  past cell, or outside the grid is a no-op (chip snaps back).
- Sensor: `PointerSensor` with a small activation distance so a plain chip click
  still fires `onSelectPost`.
- **a11y of dragging (WCAG 2.2 SC 2.5.7):** the drag is an *enhancement*, not the
  only way to reschedule. The non-drag, single-pointer / keyboard alternative is
  the existing **click-a-chip → composer → change the pinned date** path. We do
  **not** ship brittle 2D-grid keyboard drag in v1 (dnd-kit's default keyboard
  coordinate stepping doesn't cross calendar cells cleanly and would hijack the
  chip's Enter/Space select). Keyboard and AT users reschedule via the composer.
- The reschedule itself (computing the new instant + calling the API) lives in the
  Queue screen's `onReschedule` handler, keeping `MonthCalendar` presentational.

### 3. `src/screens/QueueScreen.tsx` — wire the tab

- `tab` state: `'queue' | 'drafts' | 'month'`. Add a third tab button labelled
  **"Monthly View"** (no count badge). Existing Upcoming/Drafts tabs unchanged.
- When `tab === 'month'`, render `<MonthCalendar posts={posts} onSelectPost=…
  onSelectDay=… />` using the `posts` it already loads (which include
  published/failed/missed — `api.listPosts()` returns all statuses).
- Handlers:
  - `onSelectPost(post)`: if `post.status === 'published'` and `post.linkedinUrl`
    → `window.open(post.linkedinUrl, '_blank', 'noopener,noreferrer')`; else if
    the status is editable (`draft|queued|failed|missed`) →
    `navigate('/compose?edit=' + post.id)`; else no-op.
  - `onSelectDay(dayKey)`: `navigate('/compose?pin=' + dayKey)`.
  - `onReschedule(post, dayKey)`: `await api.updatePost(post.id, { action: 'pin',
    scheduledAt: rescheduleIso(post, dayKey, TIMEZONE) })`, then reload posts. The
    existing `PATCH` pin action pins the post to the new instant and, for a
    failed/missed post, resets it to `queued` (attempts 0, error cleared) — so
    dragging a failed post to a future day is a reschedule-and-requeue. If the
    server rejects it (e.g. the resulting instant is in the past — only possible
    when dropping on **today** with a time of day already gone), surface the
    existing error message and reload so the chip returns to its real position.

### 4. `src/screens/ComposerScreen.tsx` — accept `?pin=`

- Read `params.get('pin')` (a `'YYYY-MM-DD'`). When present **and** there is no
  `edit` id, initialise `pinAt` to `` `${pin}T09:00` `` (the `datetime-local`
  value format), pre-selecting the pin path. The user can adjust the time; the
  existing submit logic validates "future" and the button already gates on a
  present `pinAt`. Default time 09:00 is deliberate and editable (per-slot
  smart defaults are a future nicety).

## Data flow

`QueueScreen` → `api.listPosts()` (already happens) → `posts` state (all statuses)
→ passed to `MonthCalendar` → `buildMonthGrid` buckets them per Stockholm day →
chips render. Month nav is pure client state; no refetch. Clicking routes to the
composer (edit or pin) or opens LinkedIn.

## Error / edge handling

- **No posts in a month:** grid renders with empty cells; future days remain
  clickable-to-compose. No error state needed.
- **UTC↔Stockholm day shift:** handled by `stockholmDayKey` (e.g. a post at
  `22:30Z` in summer is `00:30` next day in Stockholm and lands on the next day).
- **DST months:** grid is civil-date math (no wall-clock instants), so spring/fall
  DST months still lay out as 42 correct civil days.
- **Published post without `linkedinUrl`** (e.g. a 409 dedup): chip click is a
  no-op rather than opening a broken tab.
- **Pin to today when it is already past 09:00:** the composer's future-only
  validation rejects it with the existing message; the user bumps the time. Past
  days aren't clickable, so this only affects "today".
- **Drag onto a past day / same day / outside the grid:** no-op — the chip snaps
  back (past cells aren't drop targets; an unchanged day does nothing).
- **Drag onto today with a past time of day:** the `PATCH` pin validation rejects
  it (future-only); the Queue screen surfaces the error and reloads, returning the
  chip to its real slot. Rare (only "today"), acceptable.
- **Dragging a non-draggable chip:** published chips (and any post without a
  `scheduledAt`) can't be picked up, so no invalid reschedule is possible.

## Testing (TDD)

**`src/lib/calendar.test.ts`** (pure — the Iron Law applies here):
- 42 cells (6×7) for a sample month; first column is Monday.
- Known layout: **Sep 2021** — 1 Sep 2021 is a Wednesday, so Monday-first row 1
  is Mon 30 Aug, Tue 31 Aug, Wed 1 Sep… (assert leading days + `inCurrentMonth`).
- `isToday` set when `now` is inside the month; `isPast` for earlier civil days.
- Post placement onto the correct Stockholm day; multiple posts sorted by time.
- **TZ shift:** `2026-07-20T22:30:00Z` → placed on `2026-07-21` (summer, UTC+2).
- Drafts (`scheduledAt: null`) never appear.

- **`rescheduleIso`** keeps the Stockholm time of day on a new date: a post at
  `2026-07-20T06:30:00Z` (08:30 Stockholm, summer) rescheduled to `2026-12-15`
  yields `2026-12-15T07:30:00Z` (08:30 Stockholm, winter/UTC+1) — the DST offset
  is recomputed for the target date, not copied. Null `scheduledAt` falls back to
  09:00 on the target day.

**`src/components/MonthCalendar.test.tsx`**:
- Renders 7 weekday column headers and the month/year title.
- Prev/Next/Today change the displayed title.
- A post chip appears in the correct cell with its Stockholm time.
- Clicking a chip calls `onSelectPost` with that post.
- Clicking a future empty day's ＋ calls `onSelectDay(dayKey)`; a past empty day
  has no add button.
- A queued/failed/missed chip is draggable; a published chip is not.
- Drag-end onto a different future day calls `onReschedule(post, dayKey)`; onto a
  past day / the same day / off-grid it is not called. (Driven through the
  component's drag-end handler, mirroring how the queue reorder is unit-tested.)
- Table exposes column headers (`role="columnheader"`).

**`src/screens/QueueScreen.test.tsx`** (extend):
- The "Monthly View" tab exists; activating it renders the calendar (weekday
  headers visible).
- `onSelectPost` routing: a published post with a `linkedinUrl` calls
  `window.open` (spy); an editable post navigates to `/compose?edit=…`.
- `onReschedule` calls `api.updatePost(id, { action: 'pin', scheduledAt })` with
  the `rescheduleIso` instant, then reloads.

**E2E `e2e/scheduler.spec.ts`** (+ axe):
- Open Queue → click "Monthly View" → calendar visible → **axe sweep clean**
  (WCAG 2.2 AA), keyboard reachable.
- Pointer drag-to-reschedule is verified with a **throwaway** Playwright spec
  (mouse-drag a chip to another day, assert the pin PATCH fires, screenshot the
  grid, then delete the spec) rather than a committed flaky drag test. The
  reschedule routing is unit-tested; the keyboard path is the composer edit flow.

## Files

**New:** `src/lib/calendar.ts`, `src/lib/calendar.test.ts`,
`src/components/MonthCalendar.tsx`, `src/components/MonthCalendar.test.tsx`.
**Modified:** `src/screens/QueueScreen.tsx` (+ test),
`src/screens/ComposerScreen.tsx` (+ test for `?pin=`), `e2e/scheduler.spec.ts`,
`README.md`, `changelog.md` (`[Unreleased]`).
**Reused (no new dep):** `@dnd-kit/core` for drag-to-reschedule (already used by
the queue reorder), `@date-fns/tz` for `rescheduleIso`.

## Global constraints

- Accessibility is non-negotiable: semantic `<table>`, real buttons, aria-labels,
  aria-live month announcements; the new tab is covered by the axe sweep. Pointer
  drag-to-reschedule is an enhancement whose keyboard / single-pointer alternative
  (WCAG 2.2 SC 2.5.7) is the click-a-chip → composer → edit-date path.
- Europe/Stockholm throughout; Monday-first week (matches app's sv-SE locale and
  Settings' Monday-first weekdays where weekday 0 = Monday).
- No new dependencies; no new API endpoint.
- Coverage ratchet must stay green; the pure `calendar.ts` carries the heaviest
  unit coverage.
