# LinkedIn Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal, single-user Buffer-style LinkedIn scheduler: compose text+image posts, queue them onto recurring weekly slots (with pin-to-exact-time override), auto-publish via Zernio on a 5-minute Vercel Cron tick.

**Architecture:** Vite React SPA (from manfred-bootstrap starter) + Vercel Functions in `api/` + Neon Postgres (source of truth) + Vercel Blob (durable image store). Publishing goes through a swappable `Publisher` interface whose only implementation calls Zernio with `publishNow: true`; our cron and DB own all scheduling. Queue-slot math is one pure shared module used by both SPA (previews) and API (authority).

**Tech Stack:** React 19, Vite 6, TypeScript 5.7, Tailwind 4, `@studio-manfred/manfred-design-system`, vitest 3, Playwright + axe, `@neondatabase/serverless`, `@vercel/blob`, `date-fns` + `@date-fns/tz`, `react-router-dom`, `@dnd-kit/sortable`.

**Spec:** `docs/superpowers/specs/2026-07-20-linkedin-scheduler-design.md` — read it first. Zernio API reference is vendored at `docs/llms-full.txt` (2.9 MB — search it, never read it whole).

## Global Constraints

- Timezone is fixed: `Europe/Stockholm`. Weekday convention everywhere: **0 = Monday … 6 = Sunday** (ISO, NOT JS `getDay()`).
- Post body ≤ **3000** chars; ≤ **20** images per post; every image requires alt text (may be empty string only if user explicitly marks decorative — UI enforces non-empty by default).
- Post statuses: `draft | queued | publishing | published | failed | missed`. Every `queued` post always has a concrete `scheduled_at`.
- Max **3** publish attempts; missed-window guard at **60 minutes**; stuck-`publishing` sweeper at **10 minutes**.
- No `Date.now()` / `new Date()` inside domain logic — time is always injected as a parameter.
- Secrets (`ZERNIO_API_KEY` etc.) are server-side only; never imported from `src/`, never committed.
- WCAG 2.2 AA: semantic HTML, keyboard operability for everything (including queue reorder), visible focus, axe checks must pass.
- Design system components: verify props via the `manfred-ds` MCP (`list-all-documentation` → `get-documentation`) before use — never guess props. Where the DS lacks a component, use semantic HTML styled with Tailwind tokens.
- TDD: every logic module gets its failing test first. Conventional commits. Run `npm run test:run && npm run lint && npm run typecheck` before every commit (after Task 1 makes them available).
- Package installs need `GITHUB_TOKEN` with `read:packages` exported (`export GITHUB_TOKEN=$(gh auth token)`).
- Solo greenfield build: commits go directly to `main` until first production deploy (conscious WoW deviation; Linear tickets start post-v1).

---

### Task 1: Scaffold from manfred-bootstrap

The repo currently contains only `docs/` and git history. The template's `new` mode requires a non-existent target dir, so stamp into a temp dir and copy over.

**Files:**
- Create: entire starter tree (`package.json`, `src/`, `e2e/`, `test/`, `vite.config.ts`, `vercel.json`, `.github/`, `.npmrc`, configs) copied from the template
- Preserve: existing `docs/` and `.git/`

- [ ] **Step 1: Stamp the template into a temp dir**

```bash
git clone --depth 1 https://github.com/Studio-Manfred/manfred-bootstrap /tmp/manfred-bootstrap-tpl
node /tmp/manfred-bootstrap-tpl/scripts/bootstrap.mjs new --name manfred-schedule-linkedin --prefix STU --dir /tmp/msl-stamp
```

Expected: script reports files copied and placeholders (`{{PROJECT_NAME}}`) replaced. If the script prompts, re-run with `--yes` if supported (check `node .../bootstrap.mjs --help`).

- [ ] **Step 2: Copy into this repo, keeping our docs and git history**

```bash
rsync -a --exclude .git /tmp/msl-stamp/ /Users/jens.wedin/Sandbox/Code/manfred-schedule-linkedin/
cd /Users/jens.wedin/Sandbox/Code/manfred-schedule-linkedin
git status --short | head -30
```

Expected: new files untracked; `docs/superpowers/` unchanged. If the stamp produced its own `MEMORY.md`/`CHANGELOG.md`, keep the stamped versions (ours don't exist yet).

- [ ] **Step 3: Install and verify the starter is green**

```bash
export GITHUB_TOKEN=$(gh auth token)
npm install
npm run test:run && npm run lint && npm run build
```

Expected: install succeeds (if `@studio-manfred/manfred-design-system` 403s, the token lacks `read:packages` — fix before continuing), starter's example tests pass, build completes.

- [ ] **Step 4: Commit and create the GitHub repo**

```bash
git add -A
git commit -m "chore: scaffold from manfred-bootstrap starter"
gh repo create Studio-Manfred/manfred-schedule-linkedin --private --source=. --push
```

Expected: repo exists at `Studio-Manfred/manfred-schedule-linkedin`, `main` pushed. CI will fail on the DS package until Task 16 grants Actions access — that's the known gotcha, ignore for now.

---

### Task 2: Backend dependencies & project config

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `vercel.json` (cron)
- Create: `api/tsconfig.json`
- Create: `.env.example`

- [ ] **Step 1: Install dependencies**

```bash
npm install @neondatabase/serverless @vercel/blob date-fns @date-fns/tz react-router-dom @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install -D @vercel/node
```

- [ ] **Step 2: Add the cron to `vercel.json`**

Replace the file contents with (the SPA rewrite stays — Vercel matches filesystem/functions before rewrites, so `/api/*` is unaffected):

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "crons": [{ "path": "/api/cron/publish", "schedule": "*/5 * * * *" }]
}
```

- [ ] **Step 3: Create `api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts", "../src/lib/**/*.ts"]
}
```

`moduleResolution: Bundler` matches how Vercel bundles functions and lets `api/` import the shared `src/lib` modules with extensionless relative paths.

- [ ] **Step 4: Add typecheck script for api/**

In `package.json` scripts, add:

```json
"typecheck:api": "tsc -p api"
```

And open `.github/workflows/` — in the workflow file that runs `npm run typecheck` (or `lint`/`test`), add a step `run: npm run typecheck:api` right after it, same job.

- [ ] **Step 5: Create `.env.example`**

```bash
# Single-user login password
APP_PASSWORD=
# 32+ random bytes, e.g. `openssl rand -base64 32`
SESSION_SECRET=
# Guard for /api/cron/publish; Vercel sends it automatically when set in project env
CRON_SECRET=
# Zernio (https://zernio.com → Settings → API Keys)
ZERNIO_API_KEY=
# Zernio SocialAccount id of the connected LinkedIn account (GET /api/v1/accounts)
ZERNIO_ACCOUNT_ID=
# Neon Postgres (Vercel Marketplace integration provides this)
DATABASE_URL=
# Vercel Blob (provided by Blob store integration)
BLOB_READ_WRITE_TOKEN=
```

Confirm `.gitignore` covers `.env*` (starter should already; add `.env*.local` and `.env` lines if missing).

- [ ] **Step 6: Verify and commit**

```bash
npm run build && npm run lint
git add -A
git commit -m "chore: add backend deps, cron config, api tsconfig, env template"
```

---

### Task 3: Shared domain types + queue-slot math (TDD)

The heart of the app. Pure functions, time injected, no I/O.

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/queue.ts`
- Test: `src/lib/queue.test.ts`

**Interfaces:**
- Produces (used by nearly every later task):
  - `TIMEZONE = 'Europe/Stockholm'`, `MAX_BODY_LENGTH = 3000`, `MAX_IMAGES = 20`
  - `type PostStatus`, `interface PostImage { url: string; alt: string }`, `interface Post`, `interface Slot { id: number; weekday: number; timeLocal: string }`
  - `slotOccurrences(slots: Slot[], after: Date, count: number): Date[]`
  - `dealSchedule(args: { slots: Slot[]; queuedIds: string[]; pinnedTimes: Date[]; now: Date }): Map<string, Date>`

- [ ] **Step 1: Write `src/lib/types.ts`** (no test needed — types and constants only)

```ts
export const TIMEZONE = 'Europe/Stockholm'
export const MAX_BODY_LENGTH = 3000
export const MAX_IMAGES = 20
export const MAX_ATTEMPTS = 3
export const MISSED_WINDOW_MINUTES = 60
export const STUCK_PUBLISHING_MINUTES = 10

export type PostStatus =
  | 'draft'
  | 'queued'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'missed'

export interface PostImage {
  url: string
  alt: string
}

export interface Post {
  id: string
  body: string
  images: PostImage[]
  status: PostStatus
  pinned: boolean
  position: number | null
  scheduledAt: string | null
  zernioPostId: string | null
  linkedinUrl: string | null
  error: string | null
  attempts: number
  createdAt: string
  updatedAt: string
}

/** weekday: 0 = Monday … 6 = Sunday (ISO). timeLocal: 'HH:MM' in Europe/Stockholm. */
export interface Slot {
  id: number
  weekday: number
  timeLocal: string
}
```

- [ ] **Step 2: Write the failing tests — `src/lib/queue.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { dealSchedule, slotOccurrences } from './queue'
import type { Slot } from './types'

const slot = (id: number, weekday: number, timeLocal: string): Slot => ({ id, weekday, timeLocal })

// Mon 2026-07-20 12:00 Stockholm (CEST, UTC+2)
const MON_NOON = new Date('2026-07-20T10:00:00Z')

describe('slotOccurrences', () => {
  it('generates upcoming occurrences in order for Tue/Thu 08:30 slots', () => {
    const occs = slotOccurrences([slot(1, 1, '08:30'), slot(2, 3, '08:30')], MON_NOON, 3)
    expect(occs.map((d) => d.toISOString())).toEqual([
      '2026-07-21T06:30:00.000Z', // Tue 08:30 CEST
      '2026-07-23T06:30:00.000Z', // Thu 08:30 CEST
      '2026-07-28T06:30:00.000Z', // next Tue
    ])
  })

  it('skips a slot time already in the past today', () => {
    // Tue 09:00 Stockholm — today's 08:30 Tue slot has passed
    const tueMorning = new Date('2026-07-21T07:00:00Z')
    const occs = slotOccurrences([slot(1, 1, '08:30')], tueMorning, 1)
    expect(occs[0]?.toISOString()).toBe('2026-07-28T06:30:00.000Z')
  })

  it('keeps 08:30 local time across the October DST transition', () => {
    // Thu 2026-10-22; DST ends Sun 2026-10-25 in Europe/Stockholm
    const now = new Date('2026-10-22T12:00:00Z')
    const occs = slotOccurrences([slot(1, 4, '08:30'), slot(2, 1, '08:30')], now, 2)
    expect(occs.map((d) => d.toISOString())).toEqual([
      '2026-10-23T06:30:00.000Z', // Fri 08:30 CEST (UTC+2)
      '2026-10-27T07:30:00.000Z', // Tue 08:30 CET (UTC+1)
    ])
  })

  it('returns empty when no slots are configured', () => {
    expect(slotOccurrences([], MON_NOON, 5)).toEqual([])
  })
})

describe('dealSchedule', () => {
  const tueThu = [slot(1, 1, '08:30'), slot(2, 3, '08:30')]

  it('deals queued posts onto the next free slots in order', () => {
    const result = dealSchedule({ slots: tueThu, queuedIds: ['a', 'b'], pinnedTimes: [], now: MON_NOON })
    expect(result.get('a')?.toISOString()).toBe('2026-07-21T06:30:00.000Z')
    expect(result.get('b')?.toISOString()).toBe('2026-07-23T06:30:00.000Z')
  })

  it('skips slot occurrences taken by pinned posts', () => {
    const pinned = new Date('2026-07-21T06:30:00Z') // occupies Tue slot
    const result = dealSchedule({ slots: tueThu, queuedIds: ['a'], pinnedTimes: [pinned], now: MON_NOON })
    expect(result.get('a')?.toISOString()).toBe('2026-07-23T06:30:00.000Z')
  })

  it('returns an empty map when no slots are configured', () => {
    const result = dealSchedule({ slots: [], queuedIds: ['a'], pinnedTimes: [], now: MON_NOON })
    expect(result.size).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/queue.test.ts`
Expected: FAIL — `queue.ts` does not exist.

- [ ] **Step 4: Implement `src/lib/queue.ts`**

```ts
import { TZDate } from '@date-fns/tz'
import { TIMEZONE, type Slot } from './types'

/** ISO weekday (0 = Monday … 6 = Sunday) of a TZDate. */
function isoWeekday(d: TZDate): number {
  return (d.getDay() + 6) % 7
}

/**
 * Upcoming UTC instants of the weekly slots strictly after `after`, sorted,
 * at most `count`. DST-safe: slots are wall-clock times in Europe/Stockholm.
 */
export function slotOccurrences(slots: Slot[], after: Date, count: number): Date[] {
  if (slots.length === 0 || count === 0) return []
  const out: Date[] = []
  const start = new TZDate(after, TIMEZONE)
  // Worst case one slot/week: scan enough days to find `count` occurrences.
  const maxDays = count * 7 + 7
  for (let offset = 0; offset <= maxDays && out.length < count * 2; offset++) {
    const day = new TZDate(start.getFullYear(), start.getMonth(), start.getDate() + offset, TIMEZONE)
    const todays = slots
      .filter((s) => s.weekday === isoWeekday(day))
      .sort((a, b) => a.timeLocal.localeCompare(b.timeLocal))
    for (const s of todays) {
      const [hh = 0, mm = 0] = s.timeLocal.split(':').map(Number)
      const occ = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, TIMEZONE)
      if (occ.getTime() > after.getTime()) out.push(new Date(occ.getTime()))
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, count)
}

/**
 * Deal queued (non-pinned) posts, in queue order, onto the next free slot
 * occurrences. Occurrences exactly matching a pinned post's time are skipped.
 * Returns postId -> UTC instant. Empty map when no slots are configured.
 */
export function dealSchedule(args: {
  slots: Slot[]
  queuedIds: string[]
  pinnedTimes: Date[]
  now: Date
}): Map<string, Date> {
  const { slots, queuedIds, pinnedTimes, now } = args
  const result = new Map<string, Date>()
  if (slots.length === 0 || queuedIds.length === 0) return result
  const taken = new Set(pinnedTimes.map((t) => t.getTime()))
  const occs = slotOccurrences(slots, now, queuedIds.length + pinnedTimes.length)
  let i = 0
  for (const id of queuedIds) {
    while (i < occs.length && taken.has(occs[i]!.getTime())) i++
    const occ = occs[i]
    if (!occ) break
    result.set(id, occ)
    i++
  }
  return result
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/queue.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/queue.ts src/lib/queue.test.ts
git commit -m "feat: shared domain types and DST-safe queue slot math"
```

---

### Task 4: Database schema, migration runner, repositories

Thin SQL layer — no unit tests here by design: all branching logic lives in the pure modules (Tasks 3, 7, 8, 10) which are tested with fakes; these repos are exercised for real against Neon in Task 16's verification.

**Files:**
- Create: `migrations/001_init.sql`
- Create: `scripts/migrate.mjs`
- Create: `api/_lib/db.ts`
- Create: `api/_lib/posts-repo.ts`
- Create: `api/_lib/slots-repo.ts`

**Interfaces:**
- Produces:
  - `posts-repo`: `listPosts(statuses?: PostStatus[]): Promise<Post[]>`, `getPost(id): Promise<Post | null>`, `insertPost(p: NewPost): Promise<Post>`, `updatePost(id, patch: Partial<PostPatch>): Promise<Post | null>`, `deletePost(id): Promise<void>`, `listQueuedUnpinnedIds(): Promise<string[]>`, `listPinnedFutureTimes(now: Date): Promise<Date[]>`, `saveSchedule(entries: { id: string; scheduledAt: Date }[]): Promise<void>`, `setPositions(orderedIds: string[]): Promise<void>`, `claimDuePosts(now: Date): Promise<Post[]>`, `requeue(id, error): Promise<void>`, `markPublished(id, zernioPostId, linkedinUrl): Promise<void>`, `markFailed(id, error): Promise<void>`, `markMissed(id): Promise<void>`, `sweepStuck(cutoff: Date): Promise<number>`, `nextPosition(): Promise<number>`
  - `slots-repo`: `listSlots(): Promise<Slot[]>`, `replaceSlots(slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]>`

- [ ] **Step 1: Write `migrations/001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body          text NOT NULL,
  images        jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL CHECK (status IN ('draft','queued','publishing','published','failed','missed')),
  pinned        boolean NOT NULL DEFAULT false,
  position      integer,
  scheduled_at  timestamptz,
  zernio_post_id text,
  linkedin_url  text,
  error         text,
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_due_idx ON posts (status, scheduled_at);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id         serial PRIMARY KEY,
  weekday    integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  time_local text NOT NULL CHECK (time_local ~ '^[0-2][0-9]:[0-5][0-9]$')
);
```

- [ ] **Step 2: Write `scripts/migrate.mjs`**

```js
#!/usr/bin/env node
import { neon } from '@neondatabase/serverless'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}
const sql = neon(url)

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
)`

const dir = path.join(import.meta.dirname, '..', 'migrations')
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

for (const file of files) {
  const done = await sql`SELECT 1 FROM schema_migrations WHERE name = ${file}`
  if (done.length > 0) {
    console.log(`skip  ${file}`)
    continue
  }
  const body = await readFile(path.join(dir, file), 'utf8')
  // neon() runs one statement per call — split on ';' at line ends
  for (const stmt of body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await sql.query(stmt)
  }
  await sql`INSERT INTO schema_migrations (name) VALUES (${file})`
  console.log(`apply ${file}`)
}
console.log('migrations complete')
```

Add to `package.json` scripts: `"migrate": "node scripts/migrate.mjs"`.

- [ ] **Step 3: Write `api/_lib/db.ts`**

```ts
import { neon } from '@neondatabase/serverless'

let _sql: ReturnType<typeof neon> | null = null

export function sql(): ReturnType<typeof neon> {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    _sql = neon(url)
  }
  return _sql
}
```

- [ ] **Step 4: Write `api/_lib/posts-repo.ts`**

```ts
import type { Post, PostImage, PostStatus } from '../../src/lib/types'
import { sql } from './db'

export interface NewPost {
  body: string
  images: PostImage[]
  status: 'draft' | 'queued'
  pinned: boolean
  position: number | null
  scheduledAt: Date | null
}

export interface PostPatch {
  body: string
  images: PostImage[]
  status: PostStatus
  pinned: boolean
  position: number | null
  scheduledAt: Date | null
  attempts: number
  error: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToPost(r: any): Post {
  return {
    id: r.id,
    body: r.body,
    images: r.images as PostImage[],
    status: r.status as PostStatus,
    pinned: r.pinned,
    position: r.position,
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    zernioPostId: r.zernio_post_id,
    linkedinUrl: r.linkedin_url,
    error: r.error,
    attempts: r.attempts,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

export async function listPosts(statuses?: PostStatus[]): Promise<Post[]> {
  const rows = statuses
    ? await sql()`SELECT * FROM posts WHERE status = ANY(${statuses}) ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
    : await sql()`SELECT * FROM posts ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
  return (rows as any[]).map(rowToPost)
}

export async function getPost(id: string): Promise<Post | null> {
  const rows = (await sql()`SELECT * FROM posts WHERE id = ${id}`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function insertPost(p: NewPost): Promise<Post> {
  const rows = (await sql()`
    INSERT INTO posts (body, images, status, pinned, position, scheduled_at)
    VALUES (${p.body}, ${JSON.stringify(p.images)}::jsonb, ${p.status}, ${p.pinned}, ${p.position}, ${p.scheduledAt})
    RETURNING *`) as any[]
  return rowToPost(rows[0])
}

export async function updatePost(id: string, patch: Partial<PostPatch>): Promise<Post | null> {
  const cur = await getPost(id)
  if (!cur) return null
  const next = {
    body: patch.body ?? cur.body,
    images: patch.images ?? cur.images,
    status: patch.status ?? cur.status,
    pinned: patch.pinned ?? cur.pinned,
    position: patch.position !== undefined ? patch.position : cur.position,
    scheduledAt:
      patch.scheduledAt !== undefined
        ? patch.scheduledAt
        : cur.scheduledAt
          ? new Date(cur.scheduledAt)
          : null,
    attempts: patch.attempts ?? cur.attempts,
    error: patch.error !== undefined ? patch.error : cur.error,
  }
  const rows = (await sql()`
    UPDATE posts SET body = ${next.body}, images = ${JSON.stringify(next.images)}::jsonb,
      status = ${next.status}, pinned = ${next.pinned}, position = ${next.position},
      scheduled_at = ${next.scheduledAt}, attempts = ${next.attempts}, error = ${next.error},
      updated_at = now()
    WHERE id = ${id} RETURNING *`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function deletePost(id: string): Promise<void> {
  await sql()`DELETE FROM posts WHERE id = ${id}`
}

export async function listQueuedUnpinnedIds(): Promise<string[]> {
  const rows = (await sql()`
    SELECT id FROM posts WHERE status = 'queued' AND pinned = false
    ORDER BY position ASC NULLS LAST, created_at ASC`) as any[]
  return rows.map((r) => r.id)
}

export async function listPinnedFutureTimes(now: Date): Promise<Date[]> {
  const rows = (await sql()`
    SELECT scheduled_at FROM posts
    WHERE status = 'queued' AND pinned = true AND scheduled_at > ${now}`) as any[]
  return rows.map((r) => new Date(r.scheduled_at))
}

export async function saveSchedule(entries: { id: string; scheduledAt: Date }[]): Promise<void> {
  for (const e of entries) {
    await sql()`UPDATE posts SET scheduled_at = ${e.scheduledAt}, updated_at = now() WHERE id = ${e.id}`
  }
}

export async function setPositions(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await sql()`UPDATE posts SET position = ${i}, updated_at = now() WHERE id = ${orderedIds[i]}`
  }
}

export async function nextPosition(): Promise<number> {
  const rows = (await sql()`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM posts
    WHERE status = 'queued' AND pinned = false`) as any[]
  return rows[0].next
}

export async function claimDuePosts(now: Date): Promise<Post[]> {
  const rows = (await sql()`
    UPDATE posts SET status = 'publishing', attempts = attempts + 1, updated_at = now()
    WHERE status = 'queued' AND scheduled_at <= ${now}
    RETURNING *`) as any[]
  return rows.map(rowToPost)
}

export async function requeue(id: string, error: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'queued', error = ${error}, updated_at = now() WHERE id = ${id}`
}

export async function markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void> {
  await sql()`UPDATE posts SET status = 'published', zernio_post_id = ${zernioPostId},
    linkedin_url = ${linkedinUrl}, error = NULL, updated_at = now() WHERE id = ${id}`
}

export async function markFailed(id: string, error: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'failed', error = ${error}, updated_at = now() WHERE id = ${id}`
}

export async function markMissed(id: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'missed', updated_at = now() WHERE id = ${id}`
}

export async function sweepStuck(cutoff: Date): Promise<number> {
  const rows = (await sql()`
    UPDATE posts SET status = 'failed', error = 'stuck in publishing (swept)', updated_at = now()
    WHERE status = 'publishing' AND updated_at < ${cutoff}
    RETURNING id`) as any[]
  return rows.length
}
```

- [ ] **Step 5: Write `api/_lib/slots-repo.ts`**

```ts
import type { Slot } from '../../src/lib/types'
import { sql } from './db'

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listSlots(): Promise<Slot[]> {
  const rows = (await sql()`SELECT id, weekday, time_local FROM schedule_slots ORDER BY weekday, time_local`) as any[]
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, timeLocal: r.time_local }))
}

export async function replaceSlots(slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]> {
  await sql()`DELETE FROM schedule_slots`
  for (const s of slots) {
    await sql()`INSERT INTO schedule_slots (weekday, time_local) VALUES (${s.weekday}, ${s.timeLocal})`
  }
  return listSlots()
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck:api
git add migrations scripts/migrate.mjs api package.json
git commit -m "feat: db schema, migration runner, post/slot repositories"
```

---

### Task 5: Session auth + login/logout/me endpoints (TDD)

**Files:**
- Create: `api/_lib/session.ts`
- Test: `api/_lib/session.test.ts`
- Create: `api/_lib/http.ts`
- Create: `api/auth/login.ts`, `api/auth/logout.ts`, `api/auth/me.ts`

**Interfaces:**
- Produces:
  - `createSession(secret: string, now?: number): string`, `verifySession(secret: string, token: string | undefined, now?: number): boolean`, `checkPassword(supplied: string, expected: string): boolean`
  - `http.ts`: `readCookie(req, name): string | undefined`, `requireAuth(req, res): boolean` (sends 401 and returns false when unauthenticated), `sendJson(res, status, data)`, `methodIs(req, res, ...methods): boolean`
- HTTP contract (client, Task 11, relies on these): `POST /api/auth/login {password}` → 204 + `Set-Cookie session=…` | 401; `POST /api/auth/logout` → 204 clears cookie; `GET /api/auth/me` → 204 | 401.

- [ ] **Step 1: Write failing tests — `api/_lib/session.test.ts`**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkPassword, createSession, verifySession } from './session'

const SECRET = 'test-secret'

describe('session', () => {
  it('round-trips a valid token', () => {
    const t = createSession(SECRET, 1_000_000)
    expect(verifySession(SECRET, t, 1_000_000)).toBe(true)
  })

  it('rejects a tampered token', () => {
    const t = createSession(SECRET, 1_000_000)
    expect(verifySession(SECRET, t + 'x', 1_000_000)).toBe(false)
    expect(verifySession('other-secret', t, 1_000_000)).toBe(false)
  })

  it('rejects an expired token (30 days)', () => {
    const t = createSession(SECRET, 0)
    expect(verifySession(SECRET, t, 31 * 86_400_000)).toBe(false)
  })

  it('rejects garbage and undefined', () => {
    expect(verifySession(SECRET, undefined)).toBe(false)
    expect(verifySession(SECRET, 'nope')).toBe(false)
  })
})

describe('checkPassword', () => {
  it('accepts exact match, rejects everything else without throwing on length mismatch', () => {
    expect(checkPassword('hunter2', 'hunter2')).toBe(true)
    expect(checkPassword('hunter', 'hunter2')).toBe(false)
    expect(checkPassword('', 'hunter2')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run api/_lib/session.test.ts`
Expected: FAIL — module not found.

Note: if vitest doesn't pick up files under `api/`, open `vitest.config.ts` and ensure `include` covers both (`['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts']`).

- [ ] **Step 3: Implement `api/_lib/session.ts`**

```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const THIRTY_DAYS_MS = 30 * 86_400_000

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSession(secret: string, now: number = Date.now()): string {
  const exp = now + THIRTY_DAYS_MS
  return `${exp}.${sign(secret, String(exp))}`
}

export function verifySession(secret: string, token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false
  const [exp, mac] = token.split('.')
  if (!exp || !mac) return false
  const a = Buffer.from(mac)
  const b = Buffer.from(sign(secret, exp))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  return Number(exp) > now
}

/** Constant-time password compare (hashes both sides to equalize length). */
export function checkPassword(supplied: string, expected: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(supplied), h(expected))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/_lib/session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write `api/_lib/http.ts`** (thin plumbing — covered indirectly by endpoint use + E2E)

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifySession } from './session'

export function readCookie(req: VercelRequest, name: string): string | undefined {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

export function sendJson(res: VercelResponse, status: number, data: unknown): void {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(data))
}

/** Sends 401 and returns false when the session cookie is missing/invalid. */
export function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.SESSION_SECRET
  if (!secret || !verifySession(secret, readCookie(req, 'session'))) {
    sendJson(res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}

/** Sends 405 and returns false when the method doesn't match. */
export function methodIs(req: VercelRequest, res: VercelResponse, ...methods: string[]): boolean {
  if (methods.includes(req.method ?? '')) return true
  res.setHeader('Allow', methods.join(', '))
  sendJson(res, 405, { error: 'method not allowed' })
  return false
}

export const SESSION_COOKIE = (token: string) =>
  `session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax; Secure`

export const CLEAR_COOKIE = 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure'
```

- [ ] **Step 6: Write the three endpoints**

`api/auth/login.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, sendJson, SESSION_COOKIE } from '../_lib/http'
import { checkPassword, createSession } from '../_lib/session'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  const expected = process.env.APP_PASSWORD
  const secret = process.env.SESSION_SECRET
  if (!expected || !secret) return sendJson(res, 500, { error: 'server not configured' })
  const supplied = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!checkPassword(supplied, expected)) {
    await delay(500) // blunt brute-force damper for a single-user app
    return sendJson(res, 401, { error: 'wrong password' })
  }
  res.setHeader('Set-Cookie', SESSION_COOKIE(createSession(secret)))
  res.status(204).end()
}
```

`api/auth/logout.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CLEAR_COOKIE, methodIs } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  res.setHeader('Set-Cookie', CLEAR_COOKIE)
  res.status(204).end()
}
```

`api/auth/me.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  if (!requireAuth(req, res)) return
  res.status(204).end()
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck:api && npx vitest run api
git add api vitest.config.ts
git commit -m "feat: signed-cookie session auth with login/logout/me endpoints"
```

---

### Task 6: Zernio publisher (TDD)

**Files:**
- Create: `api/_lib/publisher.ts`
- Test: `api/_lib/publisher.test.ts`

**Interfaces:**
- Produces:
  - `interface PublishInput { requestId: string; body: string; images: { url: string; alt: string; contentType: string }[] }`
  - `type PublishResult = { ok: true; zernioPostId: string; linkedinUrl: string | null } | { ok: false; retryable: boolean; error: string }`
  - `interface Publisher { publish(input: PublishInput): Promise<PublishResult> }`
  - `class ZernioPublisher implements Publisher` — `new ZernioPublisher({ apiKey, accountId, fetchImpl?, baseUrl? })`

- [ ] **Step 1: Write failing tests — `api/_lib/publisher.test.ts`**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ZernioPublisher } from './publisher'

function makeFetch(routes: Record<string, (url: string, init?: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [prefix, respond] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return respond(url, init)
    }
    throw new Error(`unmatched fetch: ${url}`)
  }) as unknown as typeof fetch
}

const BASE = 'https://zernio.test/api/v1'
const opts = { apiKey: 'sk_test', accountId: 'acc_1', baseUrl: BASE }
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

describe('ZernioPublisher', () => {
  it('publishes a text post with publishNow and x-request-id', async () => {
    const fetchImpl = makeFetch({
      [`${BASE}/posts`]: (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.publishNow).toBe(true)
        expect(body.content).toBe('hello')
        expect(body.platforms).toEqual([{ platform: 'linkedin', accountId: 'acc_1' }])
        expect(new Headers(init?.headers).get('x-request-id')).toBe('post-uuid-1')
        return json(201, { post: { _id: 'zp_1', platforms: [{ platform: 'linkedin', platformPostUrl: 'https://linkedin.com/x' }] } })
      },
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({ requestId: 'post-uuid-1', body: 'hello', images: [] })
    expect(result).toEqual({ ok: true, zernioPostId: 'zp_1', linkedinUrl: 'https://linkedin.com/x' })
  })

  it('uploads images via presign before posting and passes altText', async () => {
    const calls: string[] = []
    const fetchImpl = makeFetch({
      [`${BASE}/media/presign`]: () => {
        calls.push('presign')
        return json(200, { uploadUrl: 'https://storage.test/put1', publicUrl: 'https://media.test/img1.png' })
      },
      'https://storage.test/put1': (_url, init) => {
        calls.push('upload')
        expect(init?.method).toBe('PUT')
        return new Response(null, { status: 200 })
      },
      'https://blob.test/img1.png': () => {
        calls.push('download')
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      },
      [`${BASE}/posts`]: (_url, init) => {
        calls.push('post')
        const body = JSON.parse(String(init?.body))
        expect(body.mediaItems).toEqual([{ url: 'https://media.test/img1.png', type: 'image', altText: 'a chart' }])
        return json(201, { post: { _id: 'zp_2', platforms: [] } })
      },
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({
      requestId: 'r2',
      body: 'with image',
      images: [{ url: 'https://blob.test/img1.png', alt: 'a chart', contentType: 'image/png' }],
    })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['presign', 'download', 'upload', 'post'])
  })

  it('treats 409 content-hash dedup as success', async () => {
    const fetchImpl = makeFetch({
      [`${BASE}/posts`]: () => json(409, { error: 'duplicate', existingPostId: 'zp_dup' }),
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({ requestId: 'r3', body: 'dup', images: [] })
    expect(result).toEqual({ ok: true, zernioPostId: 'zp_dup', linkedinUrl: null })
  })

  it('marks 5xx and network errors retryable, 4xx not retryable', async () => {
    const pub500 = new ZernioPublisher({
      ...opts,
      fetchImpl: makeFetch({ [`${BASE}/posts`]: () => json(500, { error: 'boom' }) }),
    })
    expect(await pub500.publish({ requestId: 'r4', body: 'x', images: [] })).toMatchObject({ ok: false, retryable: true })

    const pub400 = new ZernioPublisher({
      ...opts,
      fetchImpl: makeFetch({ [`${BASE}/posts`]: () => json(400, { error: 'bad content' }) }),
    })
    expect(await pub400.publish({ requestId: 'r5', body: 'x', images: [] })).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining('bad content') })

    const pubNet = new ZernioPublisher({
      ...opts,
      fetchImpl: (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch,
    })
    expect(await pubNet.publish({ requestId: 'r6', body: 'x', images: [] })).toMatchObject({ ok: false, retryable: true })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run api/_lib/publisher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api/_lib/publisher.ts`**

```ts
export interface PublishInput {
  requestId: string
  body: string
  images: { url: string; alt: string; contentType: string }[]
}

export type PublishResult =
  | { ok: true; zernioPostId: string; linkedinUrl: string | null }
  | { ok: false; retryable: boolean; error: string }

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>
}

interface ZernioOpts {
  apiKey: string
  accountId: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export class ZernioPublisher implements Publisher {
  private fetch: typeof fetch
  private base: string
  constructor(private opts: ZernioOpts) {
    this.fetch = opts.fetchImpl ?? fetch
    this.base = opts.baseUrl ?? 'https://zernio.com/api/v1'
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json', ...extra }
  }

  /** Blob URL -> Zernio temp storage publicUrl (presign, download, PUT). */
  private async uploadImage(img: PublishInput['images'][number]): Promise<string> {
    const presignRes = await this.fetch(`${this.base}/media/presign`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ filename: img.url.split('/').pop() ?? 'image', contentType: img.contentType }),
    })
    if (!presignRes.ok) throw new Error(`presign failed: ${presignRes.status}`)
    const { uploadUrl, publicUrl } = (await presignRes.json()) as { uploadUrl: string; publicUrl: string }
    const blob = await this.fetch(img.url)
    if (!blob.ok) throw new Error(`image download failed: ${blob.status}`)
    const put = await this.fetch(uploadUrl, {
      method: 'PUT',
      body: await blob.arrayBuffer(),
      headers: { 'Content-Type': img.contentType },
    })
    if (!put.ok) throw new Error(`image upload failed: ${put.status}`)
    return publicUrl
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const mediaItems = []
      for (const img of input.images) {
        mediaItems.push({ url: await this.uploadImage(img), type: 'image', altText: img.alt })
      }
      const res = await this.fetch(`${this.base}/posts`, {
        method: 'POST',
        headers: this.headers({ 'x-request-id': input.requestId }),
        body: JSON.stringify({
          content: input.body,
          ...(mediaItems.length > 0 ? { mediaItems } : {}),
          publishNow: true,
          platforms: [{ platform: 'linkedin', accountId: this.opts.accountId }],
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status === 409) {
        // Content-hash dedup: identical content already went out within 24h.
        return { ok: true, zernioPostId: String(data.existingPostId ?? 'unknown'), linkedinUrl: null }
      }
      if (res.ok) {
        const post = data.post as { _id?: string; existingPost?: unknown; platforms?: { platform: string; platformPostUrl?: string }[] } | undefined
        const li = post?.platforms?.find((p) => p.platform === 'linkedin')
        return { ok: true, zernioPostId: post?._id ?? 'unknown', linkedinUrl: li?.platformPostUrl ?? null }
      }
      const message = typeof data.error === 'string' ? data.error : `zernio ${res.status}`
      return { ok: false, retryable: res.status >= 500, error: message }
    } catch (e) {
      return { ok: false, retryable: true, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/_lib/publisher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/publisher.ts api/_lib/publisher.test.ts
git commit -m "feat: Zernio publisher with presign uploads, idempotency and 409-as-success"
```

---

### Task 7: Reschedule module (TDD)

Recomputes `scheduled_at` for all queued non-pinned posts. Called after every mutation (create/edit/delete/reorder/slot change).

**Files:**
- Create: `api/_lib/reschedule.ts`
- Test: `api/_lib/reschedule.test.ts`

**Interfaces:**
- Produces: `recomputeQueue(deps: RescheduleDeps): Promise<void>` where

```ts
interface RescheduleDeps {
  listSlots(): Promise<Slot[]>
  listQueuedUnpinnedIds(): Promise<string[]>
  listPinnedFutureTimes(now: Date): Promise<Date[]>
  saveSchedule(entries: { id: string; scheduledAt: Date }[]): Promise<void>
  now(): Date
}
```

- [ ] **Step 1: Write failing test — `api/_lib/reschedule.test.ts`**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { recomputeQueue } from './reschedule'
import type { Slot } from '../../src/lib/types'

const tueThu: Slot[] = [
  { id: 1, weekday: 1, timeLocal: '08:30' },
  { id: 2, weekday: 3, timeLocal: '08:30' },
]
const MON_NOON = new Date('2026-07-20T10:00:00Z')

function makeDeps(overrides: Partial<Parameters<typeof recomputeQueue>[0]> = {}) {
  return {
    listSlots: async () => tueThu,
    listQueuedUnpinnedIds: async () => ['a', 'b'],
    listPinnedFutureTimes: async () => [],
    saveSchedule: vi.fn(async () => {}),
    now: () => MON_NOON,
    ...overrides,
  }
}

describe('recomputeQueue', () => {
  it('deals queued posts onto slots and saves', async () => {
    const deps = makeDeps()
    await recomputeQueue(deps)
    expect(deps.saveSchedule).toHaveBeenCalledWith([
      { id: 'a', scheduledAt: new Date('2026-07-21T06:30:00Z') },
      { id: 'b', scheduledAt: new Date('2026-07-23T06:30:00Z') },
    ])
  })

  it('skips pinned-occupied occurrences', async () => {
    const deps = makeDeps({
      listQueuedUnpinnedIds: async () => ['a'],
      listPinnedFutureTimes: async () => [new Date('2026-07-21T06:30:00Z')],
    })
    await recomputeQueue(deps)
    expect(deps.saveSchedule).toHaveBeenCalledWith([{ id: 'a', scheduledAt: new Date('2026-07-23T06:30:00Z') }])
  })

  it('saves nothing when there are no slots', async () => {
    const deps = makeDeps({ listSlots: async () => [] })
    await recomputeQueue(deps)
    expect(deps.saveSchedule).toHaveBeenCalledWith([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run api/_lib/reschedule.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `api/_lib/reschedule.ts`**

```ts
import { dealSchedule } from '../../src/lib/queue'
import type { Slot } from '../../src/lib/types'

export interface RescheduleDeps {
  listSlots(): Promise<Slot[]>
  listQueuedUnpinnedIds(): Promise<string[]>
  listPinnedFutureTimes(now: Date): Promise<Date[]>
  saveSchedule(entries: { id: string; scheduledAt: Date }[]): Promise<void>
  now(): Date
}

export async function recomputeQueue(deps: RescheduleDeps): Promise<void> {
  const now = deps.now()
  const [slots, queuedIds, pinnedTimes] = await Promise.all([
    deps.listSlots(),
    deps.listQueuedUnpinnedIds(),
    deps.listPinnedFutureTimes(now),
  ])
  const dealt = dealSchedule({ slots, queuedIds, pinnedTimes, now })
  await deps.saveSchedule([...dealt.entries()].map(([id, scheduledAt]) => ({ id, scheduledAt })))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/_lib/reschedule.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Create the wired default deps — append to `api/_lib/reschedule.ts`**

```ts
import * as postsRepo from './posts-repo'
import * as slotsRepo from './slots-repo'

/** Production wiring — call after any queue mutation. */
export function recomputeQueueLive(): Promise<void> {
  return recomputeQueue({
    listSlots: slotsRepo.listSlots,
    listQueuedUnpinnedIds: postsRepo.listQueuedUnpinnedIds,
    listPinnedFutureTimes: postsRepo.listPinnedFutureTimes,
    saveSchedule: postsRepo.saveSchedule,
    now: () => new Date(),
  })
}
```

(Move the two `import`s to the top of the file.)

- [ ] **Step 6: Commit**

```bash
npm run typecheck:api
git add api/_lib/reschedule.ts api/_lib/reschedule.test.ts
git commit -m "feat: queue reschedule module"
```

---

### Task 8: Post validation + posts endpoints (TDD on validation)

**Files:**
- Create: `api/_lib/validate.ts`
- Test: `api/_lib/validate.test.ts`
- Create: `api/posts/index.ts`, `api/posts/[id].ts`, `api/posts/reorder.ts`, `api/posts/[id]/retry.ts`

**Interfaces:**
- Produces: `validatePostInput(input: unknown): { ok: true; value: ValidPostInput } | { ok: false; error: string }` where `ValidPostInput = { body: string; images: PostImage[] }`
- HTTP contract (client, Task 11, relies on these):
  - `GET /api/posts` → `{ posts: Post[] }` (all statuses; client filters)
  - `POST /api/posts` body `{ body, images, action: 'draft' | 'queue' | 'pin', scheduledAt? }` → 201 `{ post: Post }`; 422 `{ error }` on validation failure or `action:'queue'` with no slots configured; `pin` requires future `scheduledAt`
  - `PATCH /api/posts/:id` body `{ body?, images?, action?: 'draft' | 'queue' | 'pin', scheduledAt? }` → `{ post: Post }` | 404. Only `draft/queued/failed/missed` posts are editable; editing to `queue`/`pin` sets status `queued`.
  - `DELETE /api/posts/:id` → 204
  - `POST /api/posts/reorder` body `{ orderedIds: string[] }` → `{ posts: Post[] }`
  - `POST /api/posts/:id/retry` → `{ post: Post }` — allowed from `failed`/`missed`; resets attempts/error, unpins, appends to queue end

- [ ] **Step 1: Write failing tests — `api/_lib/validate.test.ts`**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validatePostInput } from './validate'

describe('validatePostInput', () => {
  it('accepts a valid text post', () => {
    const r = validatePostInput({ body: 'hello', images: [] })
    expect(r).toEqual({ ok: true, value: { body: 'hello', images: [] } })
  })

  it('rejects empty body and over-limit body', () => {
    expect(validatePostInput({ body: '', images: [] }).ok).toBe(false)
    expect(validatePostInput({ body: 'x'.repeat(3001), images: [] }).ok).toBe(false)
    expect(validatePostInput({ body: 'x'.repeat(3000), images: [] }).ok).toBe(true)
  })

  it('rejects more than 20 images and images without url or alt field', () => {
    const img = { url: 'https://blob.test/a.png', alt: 'desc' }
    expect(validatePostInput({ body: 'x', images: Array(21).fill(img) }).ok).toBe(false)
    expect(validatePostInput({ body: 'x', images: Array(20).fill(img) }).ok).toBe(true)
    expect(validatePostInput({ body: 'x', images: [{ url: 'https://a' }] }).ok).toBe(false)
    expect(validatePostInput({ body: 'x', images: [{ alt: 'no url' }] }).ok).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(validatePostInput(null).ok).toBe(false)
    expect(validatePostInput('str').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run api/_lib/validate.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `api/_lib/validate.ts`**

```ts
import { MAX_BODY_LENGTH, MAX_IMAGES, type PostImage } from '../../src/lib/types'

export interface ValidPostInput {
  body: string
  images: PostImage[]
}

export function validatePostInput(
  input: unknown,
): { ok: true; value: ValidPostInput } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'invalid payload' }
  const { body, images } = input as { body?: unknown; images?: unknown }
  if (typeof body !== 'string' || body.trim().length === 0) return { ok: false, error: 'post text is required' }
  if (body.length > MAX_BODY_LENGTH) return { ok: false, error: `post text exceeds ${MAX_BODY_LENGTH} characters` }
  if (!Array.isArray(images)) return { ok: false, error: 'images must be an array' }
  if (images.length > MAX_IMAGES) return { ok: false, error: `at most ${MAX_IMAGES} images` }
  for (const img of images) {
    if (typeof img !== 'object' || img === null) return { ok: false, error: 'invalid image entry' }
    const { url, alt } = img as { url?: unknown; alt?: unknown }
    if (typeof url !== 'string' || url.length === 0) return { ok: false, error: 'image url is required' }
    if (typeof alt !== 'string') return { ok: false, error: 'image alt text is required' }
  }
  return { ok: true, value: { body, images: images as PostImage[] } }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/_lib/validate.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Write `api/posts/index.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../_lib/http'
import { validatePostInput } from '../_lib/validate'
import { recomputeQueueLive } from '../_lib/reschedule'
import * as posts from '../_lib/posts-repo'
import * as slots from '../_lib/slots-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'POST')) return
  if (!requireAuth(req, res)) return

  if (req.method === 'GET') {
    return sendJson(res, 200, { posts: await posts.listPosts() })
  }

  const valid = validatePostInput(req.body)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })
  const action = req.body?.action as 'draft' | 'queue' | 'pin' | undefined

  if (action === 'pin') {
    const at = new Date(req.body?.scheduledAt ?? NaN)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
      return sendJson(res, 422, { error: 'pin requires a future scheduledAt' })
    const post = await posts.insertPost({ ...valid.value, status: 'queued', pinned: true, position: null, scheduledAt: at })
    await recomputeQueueLive() // pinned post may displace dealt slots
    return sendJson(res, 201, { post: (await posts.getPost(post.id)) ?? post })
  }

  if (action === 'queue') {
    if ((await slots.listSlots()).length === 0)
      return sendJson(res, 422, { error: 'no posting slots configured — add slots in Settings or pin a time' })
    const position = await posts.nextPosition()
    const post = await posts.insertPost({ ...valid.value, status: 'queued', pinned: false, position, scheduledAt: null })
    await recomputeQueueLive()
    return sendJson(res, 201, { post: (await posts.getPost(post.id)) ?? post })
  }

  const post = await posts.insertPost({ ...valid.value, status: 'draft', pinned: false, position: null, scheduledAt: null })
  return sendJson(res, 201, { post })
}
```

- [ ] **Step 6: Write `api/posts/[id].ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../_lib/http'
import { validatePostInput } from '../_lib/validate'
import { recomputeQueueLive } from '../_lib/reschedule'
import * as posts from '../_lib/posts-repo'

const EDITABLE = new Set(['draft', 'queued', 'failed', 'missed'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'PATCH', 'DELETE')) return
  if (!requireAuth(req, res)) return
  const id = String(req.query.id)
  const existing = await posts.getPost(id)
  if (!existing) return sendJson(res, 404, { error: 'not found' })

  if (req.method === 'DELETE') {
    await posts.deletePost(id)
    await recomputeQueueLive()
    return res.status(204).end()
  }

  if (!EDITABLE.has(existing.status)) return sendJson(res, 409, { error: `cannot edit a ${existing.status} post` })

  const merged = { body: req.body?.body ?? existing.body, images: req.body?.images ?? existing.images }
  const valid = validatePostInput(merged)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })

  const action = req.body?.action as 'draft' | 'queue' | 'pin' | undefined
  let patch: Parameters<typeof posts.updatePost>[1] = { body: valid.value.body, images: valid.value.images }
  if (action === 'pin') {
    const at = new Date(req.body?.scheduledAt ?? NaN)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
      return sendJson(res, 422, { error: 'pin requires a future scheduledAt' })
    patch = { ...patch, status: 'queued', pinned: true, position: null, scheduledAt: at, attempts: 0, error: null }
  } else if (action === 'queue') {
    patch = {
      ...patch,
      status: 'queued',
      pinned: false,
      position: existing.status === 'queued' && !existing.pinned ? existing.position : await posts.nextPosition(),
      attempts: 0,
      error: null,
    }
  } else if (action === 'draft') {
    patch = { ...patch, status: 'draft', pinned: false, position: null, scheduledAt: null }
  }

  const updated = await posts.updatePost(id, patch)
  await recomputeQueueLive()
  return sendJson(res, 200, { post: (await posts.getPost(id)) ?? updated })
}
```

- [ ] **Step 7: Write `api/posts/reorder.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../_lib/http'
import { recomputeQueueLive } from '../_lib/reschedule'
import * as posts from '../_lib/posts-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  if (!requireAuth(req, res)) return
  const orderedIds = req.body?.orderedIds
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string'))
    return sendJson(res, 422, { error: 'orderedIds must be a string array' })
  await posts.setPositions(orderedIds)
  await recomputeQueueLive()
  return sendJson(res, 200, { posts: await posts.listPosts() })
}
```

- [ ] **Step 8: Write `api/posts/[id]/retry.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../../_lib/http'
import { recomputeQueueLive } from '../../_lib/reschedule'
import * as posts from '../../_lib/posts-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  if (!requireAuth(req, res)) return
  const id = String(req.query.id)
  const post = await posts.getPost(id)
  if (!post) return sendJson(res, 404, { error: 'not found' })
  if (post.status !== 'failed' && post.status !== 'missed')
    return sendJson(res, 409, { error: `cannot retry a ${post.status} post` })
  await posts.updatePost(id, {
    status: 'queued',
    pinned: false,
    position: await posts.nextPosition(),
    scheduledAt: null,
    attempts: 0,
    error: null,
  })
  await recomputeQueueLive()
  return sendJson(res, 200, { post: await posts.getPost(id) })
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck:api && npx vitest run api
git add api
git commit -m "feat: posts CRUD, reorder and retry endpoints with validation"
```

---

### Task 9: Slots, image-upload and connection endpoints

**Files:**
- Create: `api/slots.ts`, `api/images.ts`, `api/connection.ts`
- Test: extend `api/_lib/validate.test.ts` and `api/_lib/validate.ts` with slot validation

**Interfaces:**
- Produces HTTP contract:
  - `GET /api/slots` → `{ slots: Slot[] }`; `PUT /api/slots` body `{ slots: { weekday, timeLocal }[] }` → `{ slots: Slot[] }` (replaces all, recomputes queue)
  - `POST /api/images?filename=x.png` (raw binary body, `Content-Type` header) → 201 `{ url }`
  - `GET /api/connection` → `{ connected: boolean; accountName: string | null }`
- Produces: `validateSlots(input: unknown): { ok: true; value: { weekday: number; timeLocal: string }[] } | { ok: false; error: string }`

- [ ] **Step 1: Add failing slot-validation tests to `api/_lib/validate.test.ts`**

```ts
import { validateSlots } from './validate'

describe('validateSlots', () => {
  it('accepts valid slots', () => {
    expect(validateSlots([{ weekday: 0, timeLocal: '08:30' }, { weekday: 6, timeLocal: '23:59' }]).ok).toBe(true)
  })
  it('rejects bad weekday, bad time format, non-array', () => {
    expect(validateSlots([{ weekday: 7, timeLocal: '08:30' }]).ok).toBe(false)
    expect(validateSlots([{ weekday: -1, timeLocal: '08:30' }]).ok).toBe(false)
    expect(validateSlots([{ weekday: 1, timeLocal: '8:30' }]).ok).toBe(false)
    expect(validateSlots([{ weekday: 1, timeLocal: '25:00' }]).ok).toBe(false)
    expect(validateSlots('x').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement in `api/_lib/validate.ts`**

Run: `npx vitest run api/_lib/validate.test.ts` — Expected: FAIL (`validateSlots` not exported). Append:

```ts
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateSlots(
  input: unknown,
): { ok: true; value: { weekday: number; timeLocal: string }[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'slots must be an array' }
  for (const s of input) {
    const { weekday, timeLocal } = (s ?? {}) as { weekday?: unknown; timeLocal?: unknown }
    if (typeof weekday !== 'number' || weekday < 0 || weekday > 6 || !Number.isInteger(weekday))
      return { ok: false, error: 'weekday must be an integer 0 (Mon) … 6 (Sun)' }
    if (typeof timeLocal !== 'string' || !TIME_RE.test(timeLocal))
      return { ok: false, error: 'timeLocal must be HH:MM (24h)' }
  }
  return { ok: true, value: input as { weekday: number; timeLocal: string }[] }
}
```

Re-run: PASS.

- [ ] **Step 3: Write `api/slots.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from './_lib/http'
import { validateSlots } from './_lib/validate'
import { recomputeQueueLive } from './_lib/reschedule'
import * as slots from './_lib/slots-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'PUT')) return
  if (!requireAuth(req, res)) return
  if (req.method === 'GET') return sendJson(res, 200, { slots: await slots.listSlots() })
  const valid = validateSlots(req.body?.slots)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })
  const saved = await slots.replaceSlots(valid.value)
  await recomputeQueueLive()
  return sendJson(res, 200, { slots: saved })
}
```

- [ ] **Step 4: Write `api/images.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put } from '@vercel/blob'
import { methodIs, requireAuth, sendJson } from './_lib/http'

export const config = { api: { bodyParser: false } }

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  if (!requireAuth(req, res)) return
  const filename = String(req.query.filename ?? '')
  const contentType = req.headers['content-type'] ?? ''
  if (!filename) return sendJson(res, 422, { error: 'filename query param required' })
  if (!ALLOWED.has(contentType)) return sendJson(res, 422, { error: `unsupported image type: ${contentType}` })
  const blob = await put(`images/${Date.now()}-${filename}`, req, {
    access: 'public',
    contentType,
  })
  return sendJson(res, 201, { url: blob.url })
}
```

- [ ] **Step 5: Write `api/connection.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from './_lib/http'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  if (!requireAuth(req, res)) return
  const apiKey = process.env.ZERNIO_API_KEY
  const accountId = process.env.ZERNIO_ACCOUNT_ID
  if (!apiKey || !accountId) return sendJson(res, 200, { connected: false, accountName: null })
  try {
    const r = await fetch('https://zernio.com/api/v1/accounts', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!r.ok) return sendJson(res, 200, { connected: false, accountName: null })
    const data = (await r.json()) as { accounts?: { _id?: string; id?: string; platform?: string; name?: string; username?: string; displayName?: string }[] }
    const acct = (data.accounts ?? []).find((a) => (a._id ?? a.id) === accountId)
    return sendJson(res, 200, {
      connected: Boolean(acct),
      accountName: acct ? (acct.displayName ?? acct.name ?? acct.username ?? 'LinkedIn account') : null,
    })
  } catch {
    return sendJson(res, 200, { connected: false, accountName: null })
  }
}
```

(Response field names are read defensively; verify the exact list-accounts shape against `docs/llms-full.txt` — search "list accounts" — and adjust the destructuring if it differs.)

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck:api && npx vitest run api
git add api
git commit -m "feat: slots, image upload and Zernio connection endpoints"
```

---

### Task 10: Cron publish tick (TDD)

**Files:**
- Create: `api/_lib/publish-tick.ts`
- Test: `api/_lib/publish-tick.test.ts`
- Create: `api/cron/publish.ts`

**Interfaces:**
- Produces: `runPublishTick(deps: TickDeps): Promise<{ published: number; requeued: number; failed: number; missed: number; swept: number }>` where

```ts
interface TickDeps {
  now(): Date
  claimDuePosts(now: Date): Promise<Post[]>
  requeue(id: string, error: string): Promise<void>
  markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markMissed(id: string): Promise<void>
  sweepStuck(cutoff: Date): Promise<number>
  publisher: Publisher
}
```

- [ ] **Step 1: Write failing tests — `api/_lib/publish-tick.test.ts`**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runPublishTick } from './publish-tick'
import type { Post } from '../../src/lib/types'

const NOW = new Date('2026-07-21T06:31:00Z')

function post(overrides: Partial<Post>): Post {
  return {
    id: 'p1', body: 'hi', images: [], status: 'publishing', pinned: false, position: 0,
    scheduledAt: '2026-07-21T06:30:00.000Z', zernioPostId: null, linkedinUrl: null,
    error: null, attempts: 1, createdAt: '', updatedAt: '', ...overrides,
  }
}

function makeDeps(claimed: Post[], publishResult: Awaited<ReturnType<TickPublisher['publish']>>) {
  const publisher = { publish: vi.fn(async () => publishResult) }
  return {
    deps: {
      now: () => NOW,
      claimDuePosts: vi.fn(async () => claimed),
      requeue: vi.fn(async () => {}),
      markPublished: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markMissed: vi.fn(async () => {}),
      sweepStuck: vi.fn(async () => 0),
      publisher,
    },
    publisher,
  }
}
type TickPublisher = { publish: (i: unknown) => Promise<{ ok: true; zernioPostId: string; linkedinUrl: string | null } | { ok: false; retryable: boolean; error: string }> }

describe('runPublishTick', () => {
  it('publishes a due post and records the result', async () => {
    const { deps, publisher } = makeDeps([post({})], { ok: true, zernioPostId: 'z1', linkedinUrl: 'https://li/x' })
    const result = await runPublishTick(deps)
    expect(publisher.publish).toHaveBeenCalledWith({ requestId: 'p1', body: 'hi', images: [] })
    expect(deps.markPublished).toHaveBeenCalledWith('p1', 'z1', 'https://li/x')
    expect(result.published).toBe(1)
  })

  it('marks a post >60 min late as missed without publishing', async () => {
    const late = post({ scheduledAt: '2026-07-21T05:29:00.000Z' }) // 62 min late
    const { deps, publisher } = makeDeps([late], { ok: true, zernioPostId: 'z', linkedinUrl: null })
    const result = await runPublishTick(deps)
    expect(publisher.publish).not.toHaveBeenCalled()
    expect(deps.markMissed).toHaveBeenCalledWith('p1')
    expect(result.missed).toBe(1)
  })

  it('requeues a retryable failure below max attempts', async () => {
    const { deps } = makeDeps([post({ attempts: 2 })], { ok: false, retryable: true, error: 'zernio 500' })
    const result = await runPublishTick(deps)
    expect(deps.requeue).toHaveBeenCalledWith('p1', 'zernio 500')
    expect(result.requeued).toBe(1)
  })

  it('fails hard at max attempts or on non-retryable errors', async () => {
    const { deps } = makeDeps([post({ attempts: 3 })], { ok: false, retryable: true, error: 'zernio 500' })
    await runPublishTick(deps)
    expect(deps.markFailed).toHaveBeenCalledWith('p1', 'zernio 500')

    const { deps: deps2 } = makeDeps([post({ attempts: 1 })], { ok: false, retryable: false, error: 'bad content' })
    await runPublishTick(deps2)
    expect(deps2.markFailed).toHaveBeenCalledWith('p1', 'bad content')
  })

  it('sweeps stuck posts with a 10-minute cutoff', async () => {
    const { deps } = makeDeps([], { ok: true, zernioPostId: 'z', linkedinUrl: null })
    deps.sweepStuck = vi.fn(async () => 2)
    const result = await runPublishTick(deps)
    expect(deps.sweepStuck).toHaveBeenCalledWith(new Date('2026-07-21T06:21:00Z'))
    expect(result.swept).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run api/_lib/publish-tick.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `api/_lib/publish-tick.ts`**

```ts
import { MAX_ATTEMPTS, MISSED_WINDOW_MINUTES, STUCK_PUBLISHING_MINUTES, type Post } from '../../src/lib/types'
import type { Publisher } from './publisher'

export interface TickDeps {
  now(): Date
  claimDuePosts(now: Date): Promise<Post[]>
  requeue(id: string, error: string): Promise<void>
  markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markMissed(id: string): Promise<void>
  sweepStuck(cutoff: Date): Promise<number>
  publisher: Publisher
}

export interface TickResult {
  published: number
  requeued: number
  failed: number
  missed: number
  swept: number
}

export async function runPublishTick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now()
  const result: TickResult = { published: 0, requeued: 0, failed: 0, missed: 0, swept: 0 }

  result.swept = await deps.sweepStuck(new Date(now.getTime() - STUCK_PUBLISHING_MINUTES * 60_000))

  for (const post of await deps.claimDuePosts(now)) {
    const scheduled = post.scheduledAt ? new Date(post.scheduledAt) : now
    if (now.getTime() - scheduled.getTime() > MISSED_WINDOW_MINUTES * 60_000) {
      await deps.markMissed(post.id)
      result.missed++
      continue
    }
    const outcome = await deps.publisher.publish({
      requestId: post.id,
      body: post.body,
      images: post.images.map((i) => ({ url: i.url, alt: i.alt, contentType: guessContentType(i.url) })),
    })
    if (outcome.ok) {
      await deps.markPublished(post.id, outcome.zernioPostId, outcome.linkedinUrl)
      result.published++
    } else if (outcome.retryable && post.attempts < MAX_ATTEMPTS) {
      await deps.requeue(post.id, outcome.error)
      result.requeued++
    } else {
      await deps.markFailed(post.id, outcome.error)
      result.failed++
    }
  }
  return result
}

function guessContentType(url: string): string {
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) return 'image/jpeg'
  if (url.endsWith('.webp')) return 'image/webp'
  if (url.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/_lib/publish-tick.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Write `api/cron/publish.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendJson } from '../_lib/http'
import { runPublishTick } from '../_lib/publish-tick'
import { ZernioPublisher } from '../_lib/publisher'
import * as posts from '../_lib/posts-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return sendJson(res, 401, { error: 'unauthorized' })
  }
  const apiKey = process.env.ZERNIO_API_KEY
  const accountId = process.env.ZERNIO_ACCOUNT_ID
  if (!apiKey || !accountId) return sendJson(res, 500, { error: 'zernio not configured' })

  const result = await runPublishTick({
    now: () => new Date(),
    claimDuePosts: posts.claimDuePosts,
    requeue: posts.requeue,
    markPublished: posts.markPublished,
    markFailed: posts.markFailed,
    markMissed: posts.markMissed,
    sweepStuck: posts.sweepStuck,
    publisher: new ZernioPublisher({ apiKey, accountId }),
  })
  console.log('publish tick', JSON.stringify(result))
  return sendJson(res, 200, result)
}
```

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck:api && npx vitest run api
git add api
git commit -m "feat: cron publish tick with missed-window guard, retries and sweeper"
```

---

### Task 11: Frontend API client, app shell, login screen

**Files:**
- Create: `src/api/client.ts`
- Create: `src/screens/LoginScreen.tsx`
- Test: `src/screens/LoginScreen.test.tsx`
- Modify: `src/App.tsx` (full rewrite)
- Modify: `src/main.tsx` (add router)
- Delete: `src/components/Greeting.tsx`, `src/components/Greeting.test.tsx`

**Interfaces:**
- Produces `src/api/client.ts` (all screens use only this — no raw `fetch` in components):

```ts
api.login(password): Promise<void>            // throws ApiError on 401
api.logout(): Promise<void>
api.me(): Promise<boolean>
api.listPosts(): Promise<Post[]>
api.createPost(input: { body: string; images: PostImage[]; action: 'draft' | 'queue' | 'pin'; scheduledAt?: string }): Promise<Post>
api.updatePost(id, patch: { body?: string; images?: PostImage[]; action?: 'draft' | 'queue' | 'pin'; scheduledAt?: string }): Promise<Post>
api.deletePost(id): Promise<void>
api.reorder(orderedIds: string[]): Promise<Post[]>
api.retry(id): Promise<Post>
api.getSlots(): Promise<Slot[]>
api.putSlots(slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]>
api.uploadImage(file: File): Promise<string>  // returns Blob URL
api.getConnection(): Promise<{ connected: boolean; accountName: string | null }>
class ApiError extends Error { status: number }
```

- Routes: `/login`, `/` (queue), `/compose`, `/history`, `/settings`. Unauthenticated API calls (401) redirect to `/login`.

- [ ] **Step 1: Write `src/api/client.ts`**

```ts
import type { Post, PostImage, Slot } from '@/lib/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body && !(init.body instanceof File) ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    window.location.assign('/login')
    throw new ApiError(401, 'unauthorized')
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, data.error ?? `request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  async login(password: string): Promise<void> {
    await request<void>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
  },
  async logout(): Promise<void> {
    await request<void>('/api/auth/logout', { method: 'POST' })
  },
  async me(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/me')
      return res.ok
    } catch {
      return false
    }
  },
  async listPosts(): Promise<Post[]> {
    return (await request<{ posts: Post[] }>('/api/posts')).posts
  },
  async createPost(input: { body: string; images: PostImage[]; action: 'draft' | 'queue' | 'pin'; scheduledAt?: string }): Promise<Post> {
    return (await request<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify(input) })).post
  },
  async updatePost(id: string, patch: { body?: string; images?: PostImage[]; action?: 'draft' | 'queue' | 'pin'; scheduledAt?: string }): Promise<Post> {
    return (await request<{ post: Post }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).post
  },
  async deletePost(id: string): Promise<void> {
    await request<void>(`/api/posts/${id}`, { method: 'DELETE' })
  },
  async reorder(orderedIds: string[]): Promise<Post[]> {
    return (await request<{ posts: Post[] }>('/api/posts/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) })).posts
  },
  async retry(id: string): Promise<Post> {
    return (await request<{ post: Post }>(`/api/posts/${id}/retry`, { method: 'POST' })).post
  },
  async getSlots(): Promise<Slot[]> {
    return (await request<{ slots: Slot[] }>('/api/slots')).slots
  },
  async putSlots(slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]> {
    return (await request<{ slots: Slot[] }>('/api/slots', { method: 'PUT', body: JSON.stringify({ slots }) })).slots
  },
  async uploadImage(file: File): Promise<string> {
    const res = await fetch(`/api/images?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, data.error ?? 'upload failed')
    }
    return ((await res.json()) as { url: string }).url
  },
  async getConnection(): Promise<{ connected: boolean; accountName: string | null }> {
    return request('/api/connection')
  },
}
```

- [ ] **Step 2: Write failing test — `src/screens/LoginScreen.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LoginScreen } from './LoginScreen'
import { api, ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, login: vi.fn() } }
})

describe('LoginScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('submits the password and calls onSuccess', async () => {
    vi.mocked(api.login).mockResolvedValue()
    const onSuccess = vi.fn()
    render(<MemoryRouter><LoginScreen onSuccess={onSuccess} /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(api.login).toHaveBeenCalledWith('hunter2')
    expect(onSuccess).toHaveBeenCalled()
  })

  it('shows an error message on wrong password', async () => {
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, 'wrong password'))
    render(<MemoryRouter><LoginScreen onSuccess={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/password/i), 'nope')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong password/i)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/screens/LoginScreen.test.tsx` — Expected: FAIL.

- [ ] **Step 4: Implement `src/screens/LoginScreen.tsx`**

Check DS docs first (`manfred-ds` MCP: `list-all-documentation`, then Button/Input docs). Baseline implementation with semantic HTML (swap in DS `Input`/`Button` per their documented props):

```tsx
import { useState, type FormEvent } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api, ApiError } from '@/api/client'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Manfred Schedule</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" variant="brand" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/screens/LoginScreen.test.tsx` — Expected: PASS (2 tests).

- [ ] **Step 6: Rewrite `src/App.tsx` and `src/main.tsx`; delete Greeting**

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { LoginScreen } from '@/screens/LoginScreen'
import { QueueScreen } from '@/screens/QueueScreen'
import { ComposerScreen } from '@/screens/ComposerScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'

const NAV = [
  { to: '/', label: 'Queue' },
  { to: '/compose', label: 'Compose' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
]

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.me().then(setAuthed)
  }, [])

  if (authed === null) return <p className="p-8">Loading…</p>
  if (!authed)
    return (
      <LoginScreen
        onSuccess={() => {
          setAuthed(true)
          navigate('/')
        }}
      />
    )

  return (
    <div className="mx-auto min-h-dvh max-w-3xl p-4 sm:p-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="mb-8 flex items-center justify-between">
        <p className="font-semibold">Manfred Schedule</p>
        <nav aria-label="Main">
          <ul className="flex gap-4">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    isActive ? 'font-semibold underline underline-offset-4' : 'hover:underline'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<QueueScreen />} />
          <Route path="/compose" element={<ComposerScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/settings" element={<SettingsScreen onLogout={() => setAuthed(false)} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
```

Create placeholder screens so it compiles (each replaced in Tasks 12–15) — `src/screens/QueueScreen.tsx`, `src/screens/ComposerScreen.tsx`, `src/screens/HistoryScreen.tsx`, `src/screens/SettingsScreen.tsx`:

```tsx
export function QueueScreen() {
  return <h1 className="text-xl font-semibold">Queue</h1>
}
```

```tsx
export function ComposerScreen() {
  return <h1 className="text-xl font-semibold">Compose</h1>
}
```

```tsx
export function HistoryScreen() {
  return <h1 className="text-xl font-semibold">History</h1>
}
```

```tsx
export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  void onLogout
  return <h1 className="text-xl font-semibold">Settings</h1>
}
```

```bash
rm src/components/Greeting.tsx src/components/Greeting.test.tsx
```

- [ ] **Step 7: Verify and commit**

```bash
npm run test:run && npm run lint && npm run build
git add -A
git commit -m "feat: api client, routed app shell and login screen"
```

---

### Task 12: Composer screen

**Files:**
- Create: `src/components/ImageAttach.tsx`
- Rewrite: `src/screens/ComposerScreen.tsx`
- Test: `src/screens/ComposerScreen.test.tsx`

**Interfaces:**
- Consumes: `api.createPost`, `api.updatePost`, `api.getSlots`, `api.listPosts`, `api.uploadImage`; `slotOccurrences`, `dealSchedule` from `src/lib/queue`; `MAX_BODY_LENGTH`, `MAX_IMAGES` from `src/lib/types`
- Produces: route `/compose` (new post) and `/compose?edit=<id>` (edit draft/queued/failed/missed post — QueueScreen links here)

- [ ] **Step 1: Write failing tests — `src/screens/ComposerScreen.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ComposerScreen } from './ComposerScreen'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getSlots: vi.fn(),
      listPosts: vi.fn(),
      createPost: vi.fn(),
      uploadImage: vi.fn(),
    },
  }
})

const renderComposer = () =>
  render(
    <MemoryRouter initialEntries={['/compose']}>
      <ComposerScreen />
    </MemoryRouter>,
  )

describe('ComposerScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSlots).mockResolvedValue([{ id: 1, weekday: 1, timeLocal: '08:30' }])
    vi.mocked(api.listPosts).mockResolvedValue([])
  })

  it('shows remaining characters and blocks the queue action over the limit', async () => {
    renderComposer()
    const box = await screen.findByLabelText(/post text/i)
    await userEvent.type(box, 'hello')
    expect(screen.getByText(/2\s?995/)).toBeInTheDocument()
  })

  it('queues a post and shows the target slot before submitting', async () => {
    vi.mocked(api.createPost).mockResolvedValue({ id: 'p1' } as never)
    renderComposer()
    await userEvent.type(await screen.findByLabelText(/post text/i), 'my post')
    // preview of next free slot is visible on the queue button/nearby
    expect(await screen.findByText(/next slot/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    expect(api.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'my post', action: 'queue' }),
    )
  })

  it('disables Add to queue when no slots are configured', async () => {
    vi.mocked(api.getSlots).mockResolvedValue([])
    renderComposer()
    await userEvent.type(await screen.findByLabelText(/post text/i), 'my post')
    expect(screen.getByRole('button', { name: /add to queue/i })).toBeDisabled()
    expect(screen.getByText(/no posting slots configured/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/screens/ComposerScreen.test.tsx` — Expected: FAIL (placeholder has no form).

- [ ] **Step 3: Implement `src/components/ImageAttach.tsx`**

```tsx
import { useRef, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { MAX_IMAGES, type PostImage } from '@/lib/types'

interface Props {
  images: PostImage[]
  onChange: (images: PostImage[]) => void
}

export function ImageAttach({ images, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(files: FileList | null) {
    if (!files) return
    setUploading(true)
    setError(null)
    try {
      const uploaded: PostImage[] = []
      for (const file of Array.from(files).slice(0, MAX_IMAGES - images.length)) {
        uploaded.push({ url: await api.uploadImage(file), alt: '' })
      }
      onChange([...images, ...uploaded])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium">Images ({images.length}/{MAX_IMAGES})</legend>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        aria-label="Attach images"
        onChange={(e) => pick(e.target.files)}
        disabled={uploading || images.length >= MAX_IMAGES}
      />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <ul className="flex flex-col gap-3">
        {images.map((img, i) => (
          <li key={img.url} className="flex items-start gap-3">
            <img src={img.url} alt="" className="h-16 w-16 rounded object-cover" />
            <label className="flex grow flex-col gap-1">
              <span>Alt text (describe the image)</span>
              <input
                type="text"
                value={img.alt}
                required
                onChange={(e) =>
                  onChange(images.map((m, j) => (j === i ? { ...m, alt: e.target.value } : m)))
                }
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove image ${i + 1}`}
              onClick={() => onChange(images.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
```

(Verify the DS `Button` `variant="ghost"` exists via the manfred-ds MCP; fall back to a documented variant.)

- [ ] **Step 4: Implement `src/screens/ComposerScreen.tsx`**

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@studio-manfred/manfred-design-system'
import { api, ApiError } from '@/api/client'
import { dealSchedule } from '@/lib/queue'
import { MAX_BODY_LENGTH, TIMEZONE, type Post, type PostImage, type Slot } from '@/lib/types'

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function ComposerScreen() {
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const navigate = useNavigate()

  const [body, setBody] = useState('')
  const [images, setImages] = useState<PostImage[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [pinAt, setPinAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.getSlots(), api.listPosts()]).then(([s, p]) => {
      setSlots(s)
      setPosts(p)
      if (editId) {
        const post = p.find((x) => x.id === editId)
        if (post) {
          setBody(post.body)
          setImages(post.images)
        }
      }
    })
  }, [editId])

  const nextSlot = useMemo(() => {
    const queued = posts.filter((p) => p.status === 'queued' && !p.pinned && p.id !== editId).map((p) => p.id)
    const pinnedTimes = posts
      .filter((p) => p.status === 'queued' && p.pinned && p.scheduledAt)
      .map((p) => new Date(p.scheduledAt!))
    const dealt = dealSchedule({ slots, queuedIds: [...queued, 'new'], pinnedTimes, now: new Date() })
    return dealt.get('new') ?? null
  }, [slots, posts, editId])

  const remaining = MAX_BODY_LENGTH - body.length
  const altMissing = images.some((i) => i.alt.trim().length === 0)
  const invalid = body.trim().length === 0 || remaining < 0 || altMissing

  async function submit(action: 'draft' | 'queue' | 'pin', e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const input = {
        body,
        images,
        action,
        ...(action === 'pin' ? { scheduledAt: new Date(pinAt).toISOString() } : {}),
      }
      if (editId) await api.updatePost(editId, input)
      else await api.createPost(input)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => submit('queue', e)} className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{editId ? 'Edit post' : 'Compose'}</h1>
      <label className="flex flex-col gap-1">
        <span>Post text</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
        <span aria-live="polite" className={remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}>
          {remaining.toLocaleString('sv-SE')} characters left
        </span>
      </label>

      <ImageAttach images={images} onChange={setImages} />
      {altMissing && <p className="text-muted-foreground">Add alt text to every image before scheduling.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="brand" disabled={busy || invalid || slots.length === 0}>
          Add to queue
        </Button>
        {slots.length === 0 ? (
          <p className="text-muted-foreground">No posting slots configured — add slots in Settings or pin a time.</p>
        ) : (
          nextSlot && <p className="text-muted-foreground">Next slot: {fmt.format(nextSlot)}</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span>Pin to date &amp; time</span>
          <input
            type="datetime-local"
            value={pinAt}
            onChange={(e) => setPinAt(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <Button type="button" disabled={busy || invalid || !pinAt} onClick={() => submit('pin')}>
          Pin
        </Button>
        <Button type="button" variant="ghost" disabled={busy || body.trim().length === 0} onClick={() => submit('draft')}>
          Save draft
        </Button>
      </div>
    </form>
  )
}

import { ImageAttach } from '@/components/ImageAttach'
```

(Move the `ImageAttach` import to the top with the others.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/screens/ComposerScreen.test.tsx` — Expected: PASS (3 tests).

- [ ] **Step 6: Verify all and commit**

```bash
npm run test:run && npm run lint && npm run build
git add src
git commit -m "feat: composer with char counter, image alt enforcement and slot preview"
```

---

### Task 13: Queue screen (list, drafts tab, keyboard + drag reorder)

**Files:**
- Create: `src/components/PostCard.tsx`
- Rewrite: `src/screens/QueueScreen.tsx`
- Test: `src/screens/QueueScreen.test.tsx`

**Interfaces:**
- Consumes: `api.listPosts`, `api.reorder`, `api.deletePost`, `api.updatePost`
- Produces: `PostCard({ post, children? })` — shared card used by History too (Task 14)

- [ ] **Step 1: Write failing tests — `src/screens/QueueScreen.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueueScreen } from './QueueScreen'
import { api } from '@/api/client'
import type { Post } from '@/lib/types'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, listPosts: vi.fn(), reorder: vi.fn(), deletePost: vi.fn() } }
})

const queued = (id: string, position: number, extra: Partial<Post> = {}): Post => ({
  id, body: `post ${id}`, images: [], status: 'queued', pinned: false, position,
  scheduledAt: `2026-07-2${1 + position}T06:30:00.000Z`, zernioPostId: null, linkedinUrl: null,
  error: null, attempts: 0, createdAt: '', updatedAt: '', ...extra,
})

describe('QueueScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPosts).mockResolvedValue([
      queued('a', 0),
      queued('b', 1),
      queued('pin', 0, { pinned: true, position: null }),
      queued('d', 0, { status: 'draft', scheduledAt: null }),
    ])
  })

  it('renders queued posts in order with dates and a pinned badge', async () => {
    render(<MemoryRouter><QueueScreen /></MemoryRouter>)
    const items = await screen.findAllByRole('listitem')
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(/post a/)).toBeInTheDocument()
    expect(screen.getByText(/pinned/i)).toBeInTheDocument()
  })

  it('moves a post down via keyboard button and calls reorder', async () => {
    vi.mocked(api.reorder).mockResolvedValue([])
    render(<MemoryRouter><QueueScreen /></MemoryRouter>)
    await screen.findByText(/post a/)
    const first = screen.getAllByRole('listitem')[0]!
    await userEvent.click(within(first).getByRole('button', { name: /move down/i }))
    expect(api.reorder).toHaveBeenCalledWith(['b', 'a'])
  })

  it('shows drafts under the Drafts tab', async () => {
    render(<MemoryRouter><QueueScreen /></MemoryRouter>)
    await screen.findByText(/post a/)
    await userEvent.click(screen.getByRole('tab', { name: /drafts/i }))
    expect(screen.getByText(/post d/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/screens/QueueScreen.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `src/components/PostCard.tsx`**

```tsx
import type { ReactNode } from 'react'
import { TIMEZONE, type Post } from '@/lib/types'

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function PostCard({ post, children }: { post: Post; children?: ReactNode }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {post.scheduledAt && <time dateTime={post.scheduledAt}>{fmt.format(new Date(post.scheduledAt))}</time>}
        {post.pinned && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">Pinned</span>
        )}
        {post.images.length > 0 && <span>{post.images.length} image(s)</span>}
      </div>
      <p className="whitespace-pre-wrap">{post.body}</p>
      {post.error && <p className="text-destructive text-sm">{post.error}</p>}
      {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
    </article>
  )
}
```

- [ ] **Step 4: Implement `src/screens/QueueScreen.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { PostCard } from '@/components/PostCard'
import type { Post } from '@/lib/types'

function SortableItem({ post, onMove, onDelete, index, total }: {
  post: Post
  index: number
  total: number
  onMove: (id: string, dir: -1 | 1) => void
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: post.id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <PostCard post={post}>
        <button
          type="button"
          className="cursor-grab rounded border border-border px-2 py-1 text-sm"
          aria-label={`Drag to reorder: ${post.body.slice(0, 40)}`}
          {...attributes}
          {...listeners}
        >
          ⠿ Drag
        </button>
        <Button type="button" variant="ghost" disabled={index === 0} aria-label="Move up" onClick={() => onMove(post.id, -1)}>
          ↑ Move up
        </Button>
        <Button type="button" variant="ghost" disabled={index === total - 1} aria-label="Move down" onClick={() => onMove(post.id, 1)}>
          ↓ Move down
        </Button>
        <Button type="button" variant="ghost" asChild>
          <Link to={`/compose?edit=${post.id}`}>Edit</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDelete(post.id)}>
          Delete
        </Button>
      </PostCard>
    </li>
  )
}

export function QueueScreen() {
  const [posts, setPosts] = useState<Post[]>([])
  const [tab, setTab] = useState<'queue' | 'drafts'>('queue')

  const load = useCallback(() => api.listPosts().then(setPosts), [])
  useEffect(() => {
    void load()
  }, [load])

  const unpinned = posts
    .filter((p) => p.status === 'queued' && !p.pinned)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const pinned = posts.filter((p) => p.status === 'queued' && p.pinned)
  const drafts = posts.filter((p) => p.status === 'draft')
  const upcoming = [...unpinned, ...pinned].sort(
    (a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime(),
  )

  async function persistOrder(orderedIds: string[]) {
    setPosts(await api.reorder(orderedIds))
  }

  function move(id: string, dir: -1 | 1) {
    const ids = unpinned.map((p) => p.id)
    const from = ids.indexOf(id)
    const to = from + dir
    if (to < 0 || to >= ids.length) return
    void persistOrder(arrayMove(ids, from, to))
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = unpinned.map((p) => p.id)
    void persistOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this post?')) return
    await api.deletePost(id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Queue</h1>
        <Button variant="brand" asChild>
          <Link to="/compose">New post</Link>
        </Button>
      </div>

      <div role="tablist" aria-label="Queue sections" className="flex gap-2 border-b border-border">
        {(['queue', 'drafts'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={tab === t ? 'border-b-2 border-foreground px-3 py-2 font-medium' : 'px-3 py-2'}
          >
            {t === 'queue' ? `Upcoming (${upcoming.length})` : `Drafts (${drafts.length})`}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        upcoming.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing queued. <Link to="/compose" className="underline">Write your first post</Link>.
          </p>
        ) : (
          <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={unpinned.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-3">
                {upcoming.map((p) =>
                  p.pinned ? (
                    <li key={p.id}>
                      <PostCard post={p}>
                        <Button type="button" variant="ghost" asChild>
                          <Link to={`/compose?edit=${p.id}`}>Edit</Link>
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => remove(p.id)}>
                          Delete
                        </Button>
                      </PostCard>
                    </li>
                  ) : (
                    <SortableItem
                      key={p.id}
                      post={p}
                      index={unpinned.findIndex((u) => u.id === p.id)}
                      total={unpinned.length}
                      onMove={move}
                      onDelete={remove}
                    />
                  ),
                )}
              </ul>
            </SortableContext>
          </DndContext>
        )
      )}

      {tab === 'drafts' && (
        <ul className="flex flex-col gap-3">
          {drafts.map((p) => (
            <li key={p.id}>
              <PostCard post={p}>
                <Button type="button" variant="ghost" asChild>
                  <Link to={`/compose?edit=${p.id}`}>Edit</Link>
                </Button>
                <Button type="button" variant="ghost" onClick={() => remove(p.id)}>
                  Delete
                </Button>
              </PostCard>
            </li>
          ))}
          {drafts.length === 0 && <p className="text-muted-foreground">No drafts.</p>}
        </ul>
      )}
    </div>
  )
}
```

(If the DS `Button` lacks `asChild`, wrap `Link` styling manually — check the DS docs.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/screens/QueueScreen.test.tsx` — Expected: PASS (3 tests).

- [ ] **Step 6: Verify all and commit**

```bash
npm run test:run && npm run lint && npm run build
git add src
git commit -m "feat: queue screen with drag and keyboard reorder, drafts tab"
```

---

### Task 14: History screen

**Files:**
- Rewrite: `src/screens/HistoryScreen.tsx`
- Test: `src/screens/HistoryScreen.test.tsx`

**Interfaces:**
- Consumes: `api.listPosts`, `api.retry`, `PostCard`

- [ ] **Step 1: Write failing tests — `src/screens/HistoryScreen.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HistoryScreen } from './HistoryScreen'
import { api } from '@/api/client'
import type { Post } from '@/lib/types'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, listPosts: vi.fn(), retry: vi.fn() } }
})

const base: Post = {
  id: 'x', body: '', images: [], status: 'published', pinned: false, position: null,
  scheduledAt: '2026-07-14T06:30:00.000Z', zernioPostId: 'z1', linkedinUrl: null,
  error: null, attempts: 1, createdAt: '', updatedAt: '',
}

describe('HistoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPosts).mockResolvedValue([
      { ...base, id: 'ok', body: 'went out', linkedinUrl: 'https://linkedin.com/feed/1' },
      { ...base, id: 'bad', body: 'broke', status: 'failed', error: 'zernio 500' },
    ])
  })

  it('shows published posts with the LinkedIn link and failed posts with the error', async () => {
    render(<MemoryRouter><HistoryScreen /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: /view on linkedin/i })).toHaveAttribute(
      'href',
      'https://linkedin.com/feed/1',
    )
    expect(screen.getByText(/zernio 500/)).toBeInTheDocument()
  })

  it('retries a failed post', async () => {
    vi.mocked(api.retry).mockResolvedValue({ ...base, id: 'bad', status: 'queued' })
    render(<MemoryRouter><HistoryScreen /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }))
    expect(api.retry).toHaveBeenCalledWith('bad')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/screens/HistoryScreen.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `src/screens/HistoryScreen.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { PostCard } from '@/components/PostCard'
import type { Post } from '@/lib/types'

export function HistoryScreen() {
  const [posts, setPosts] = useState<Post[]>([])
  const load = useCallback(() => api.listPosts().then(setPosts), [])
  useEffect(() => {
    void load()
  }, [load])

  const done = posts
    .filter((p) => ['published', 'failed', 'missed'].includes(p.status))
    .sort((a, b) => new Date(b.scheduledAt ?? b.updatedAt).getTime() - new Date(a.scheduledAt ?? a.updatedAt).getTime())

  async function retry(id: string) {
    await api.retry(id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">History</h1>
      {done.length === 0 && <p className="text-muted-foreground">Nothing published yet.</p>}
      <ul className="flex flex-col gap-3">
        {done.map((p) => (
          <li key={p.id}>
            <PostCard post={p}>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium capitalize">
                {p.status}
              </span>
              {p.status === 'published' &&
                (p.linkedinUrl ? (
                  <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="underline">
                    View on LinkedIn
                  </a>
                ) : (
                  <span className="text-muted-foreground text-sm">Published via Zernio (no direct link returned)</span>
                ))}
              {(p.status === 'failed' || p.status === 'missed') && (
                <Button type="button" variant="ghost" onClick={() => retry(p.id)}>
                  Retry
                </Button>
              )}
            </PostCard>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass, then commit**

```bash
npx vitest run src/screens/HistoryScreen.test.tsx
npm run test:run && npm run lint
git add src
git commit -m "feat: history screen with LinkedIn links and retry"
```

---

### Task 15: Settings screen (slot editor, connection, logout)

**Files:**
- Rewrite: `src/screens/SettingsScreen.tsx`
- Test: `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `api.getSlots`, `api.putSlots`, `api.getConnection`, `api.logout`

- [ ] **Step 1: Write failing tests — `src/screens/SettingsScreen.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsScreen } from './SettingsScreen'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: { ...mod.api, getSlots: vi.fn(), putSlots: vi.fn(), getConnection: vi.fn(), logout: vi.fn() },
  }
})

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSlots).mockResolvedValue([{ id: 1, weekday: 1, timeLocal: '08:30' }])
    vi.mocked(api.getConnection).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
  })

  it('lists slots and the connected account', async () => {
    render(<SettingsScreen onLogout={vi.fn()} />)
    expect(await screen.findByDisplayValue('08:30')).toBeInTheDocument()
    expect(screen.getByText(/jens wedin/i)).toBeInTheDocument()
  })

  it('adds a slot and saves the full set', async () => {
    vi.mocked(api.putSlots).mockResolvedValue([])
    render(<SettingsScreen onLogout={vi.fn()} />)
    await screen.findByDisplayValue('08:30')
    await userEvent.click(screen.getByRole('button', { name: /add slot/i }))
    await userEvent.click(screen.getByRole('button', { name: /save schedule/i }))
    expect(api.putSlots).toHaveBeenCalledWith([
      { weekday: 1, timeLocal: '08:30' },
      { weekday: 0, timeLocal: '09:00' },
    ])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/screens/SettingsScreen.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `src/screens/SettingsScreen.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface SlotRow {
  weekday: number
  timeLocal: string
}

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const [rows, setRows] = useState<SlotRow[]>([])
  const [connection, setConnection] = useState<{ connected: boolean; accountName: string | null } | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSlots().then((slots) => setRows(slots.map(({ weekday, timeLocal }) => ({ weekday, timeLocal }))))
    api.getConnection().then(setConnection)
  }, [])

  function update(i: number, patch: Partial<SlotRow>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setSaved(false)
  }

  async function save() {
    setError(null)
    try {
      await api.putSlots(rows)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    }
  }

  async function logout() {
    await api.logout()
    onLogout()
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section aria-labelledby="schedule-h" className="flex flex-col gap-3">
        <h2 id="schedule-h" className="font-medium">Posting schedule (Europe/Stockholm)</h2>
        <ul className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={i} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`wd-${i}`}>Weekday</label>
              <select
                id={`wd-${i}`}
                value={row.weekday}
                onChange={(e) => update(i, { weekday: Number(e.target.value) })}
                className="rounded-md border border-input bg-background px-3 py-2"
              >
                {WEEKDAYS.map((d, wd) => (
                  <option key={wd} value={wd}>{d}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`t-${i}`}>Time</label>
              <input
                id={`t-${i}`}
                type="time"
                value={row.timeLocal}
                onChange={(e) => update(i, { timeLocal: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
              <Button type="button" variant="ghost" aria-label={`Remove slot ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <Button type="button" variant="ghost" onClick={() => setRows([...rows, { weekday: 0, timeLocal: '09:00' }])}>
            Add slot
          </Button>
          <Button type="button" variant="brand" onClick={save}>
            Save schedule
          </Button>
        </div>
        <p aria-live="polite">{saved ? 'Schedule saved. Queue times recomputed.' : ''}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </section>

      <section aria-labelledby="conn-h" className="flex flex-col gap-2">
        <h2 id="conn-h" className="font-medium">LinkedIn connection</h2>
        {connection === null ? (
          <p className="text-muted-foreground">Checking…</p>
        ) : connection.connected ? (
          <p>
            Connected via Zernio as <strong>{connection.accountName}</strong>
          </p>
        ) : (
          <p className="text-destructive">
            Not connected. Connect LinkedIn in the{' '}
            <a href="https://zernio.com" target="_blank" rel="noreferrer" className="underline">Zernio dashboard</a>{' '}
            and check ZERNIO_API_KEY / ZERNIO_ACCOUNT_ID env vars.
          </p>
        )}
      </section>

      <section aria-labelledby="sess-h" className="flex flex-col gap-2">
        <h2 id="sess-h" className="font-medium">Session</h2>
        <div>
          <Button type="button" variant="ghost" onClick={logout}>Log out</Button>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass, then commit**

```bash
npx vitest run src/screens/SettingsScreen.test.tsx
npm run test:run && npm run lint && npm run build
git add src
git commit -m "feat: settings with slot editor, connection status and logout"
```

---

### Task 16: E2E flows + axe accessibility checks

**Files:**
- Create: `e2e/scheduler.spec.ts`
- Inspect first: existing `e2e/` starter specs — follow their axe pattern and Playwright config (baseURL, webServer). Delete the starter's example spec if it tests the removed Greeting.

E2E runs against the SPA with **all `/api/*` routes mocked** via `page.route` — no backend needed in CI.

- [ ] **Step 1: Write `e2e/scheduler.spec.ts`**

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

interface MockPost {
  id: string
  body: string
  images: { url: string; alt: string }[]
  status: string
  pinned: boolean
  position: number | null
  scheduledAt: string | null
  zernioPostId: string | null
  linkedinUrl: string | null
  error: string | null
  attempts: number
  createdAt: string
  updatedAt: string
}

function post(id: string, body: string, extra: Partial<MockPost> = {}): MockPost {
  return {
    id, body, images: [], status: 'queued', pinned: false, position: 0,
    scheduledAt: '2026-07-21T06:30:00.000Z', zernioPostId: null, linkedinUrl: null,
    error: null, attempts: 0, createdAt: '', updatedAt: '', ...extra,
  }
}

/** In-memory API double shared by all routes of one test. */
async function mockApi(page: Page, initial: MockPost[] = []) {
  const state = { posts: [...initial], slots: [{ id: 1, weekday: 1, timeLocal: '08:30' }] }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/api/auth/me') return route.fulfill({ status: 204 })
    if (path === '/api/auth/login') return route.fulfill({ status: 204 })
    if (path === '/api/auth/logout') return route.fulfill({ status: 204 })
    if (path === '/api/slots') return json(200, { slots: state.slots })
    if (path === '/api/connection') return json(200, { connected: true, accountName: 'Jens Wedin' })
    if (path === '/api/posts' && method === 'GET') return json(200, { posts: state.posts })
    if (path === '/api/posts' && method === 'POST') {
      const body = route.request().postDataJSON() as { body: string; action: string; scheduledAt?: string }
      const p = post(`p${state.posts.length + 1}`, body.body, {
        status: body.action === 'draft' ? 'draft' : 'queued',
        pinned: body.action === 'pin',
        scheduledAt: body.scheduledAt ?? '2026-07-23T06:30:00.000Z',
        position: state.posts.length,
      })
      state.posts.push(p)
      return json(201, { post: p })
    }
    if (path === '/api/posts/reorder') {
      const { orderedIds } = route.request().postDataJSON() as { orderedIds: string[] }
      state.posts.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
      state.posts.forEach((p, i) => (p.position = i))
      return json(200, { posts: state.posts })
    }
    return json(404, { error: `unmocked: ${method} ${path}` })
  })
  return state
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(results.violations).toEqual([])
}

test('compose → queue shows the post with its slot date', async ({ page }) => {
  await mockApi(page)
  await page.goto('/compose')
  await page.getByLabel(/post text/i).fill('E2E hello LinkedIn')
  await expect(page.getByText(/next slot/i)).toBeVisible()
  await page.getByRole('button', { name: /add to queue/i }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByText('E2E hello LinkedIn')).toBeVisible()
})

test('keyboard-only reorder calls the API with the new order', async ({ page }) => {
  await mockApi(page, [post('a', 'first post', { position: 0 }), post('b', 'second post', { position: 1, scheduledAt: '2026-07-23T06:30:00.000Z' })])
  await page.goto('/')
  await expect(page.getByText('first post')).toBeVisible()
  // Tab to the first card's "Move down" and activate with keyboard only
  const moveDown = page.getByRole('button', { name: /move down/i }).first()
  await moveDown.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listitem').first()).toContainText('second post')
})

test('pin flow sends scheduledAt', async ({ page }) => {
  const state = await mockApi(page)
  await page.goto('/compose')
  await page.getByLabel(/post text/i).fill('Pinned post')
  await page.getByLabel(/pin to date/i).fill('2030-01-15T09:00')
  await page.getByRole('button', { name: /^pin$/i }).click()
  await expect(page).toHaveURL('/')
  expect(state.posts.some((p) => p.pinned)).toBe(true)
})

for (const [name, path] of [
  ['queue', '/'],
  ['composer', '/compose'],
  ['history', '/history'],
  ['settings', '/settings'],
] as const) {
  test(`a11y: ${name} screen has no WCAG violations`, async ({ page }) => {
    await mockApi(page, [post('a', 'sample post')])
    await page.goto(path)
    await expect(page.getByRole('main')).toBeVisible()
    await expectNoA11yViolations(page)
  })
}
```

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS. Fix any axe violations by changing the components (not the test). Common ones: missing labels, contrast (use DS tokens), missing `main` landmark.

- [ ] **Step 3: Full verification and commit**

```bash
npm run test:run && npm run lint && npm run typecheck:api && npm run build && npm run test:e2e
npm run test:coverage && npm run coverage:check
git add e2e
git commit -m "test: E2E scheduler flows with mocked API and axe checks"
```

If `coverage:check` fails against the starter baseline, follow the instructions the ratchet script prints (it manages `.coverage-baseline.json`).

---

### Task 17: Provision infrastructure and deploy

Human-in-the-loop task — several steps need Jens (dashboard clicks, secrets). Do the CLI parts, pause and ask for the rest.

- [ ] **Step 1: Link the Vercel project**

```bash
vercel link   # scope: Jens's Pro team; create new project "manfred-schedule-linkedin"
vercel git connect   # wire the GitHub repo for auto-deploys
```

- [ ] **Step 2: Provision Neon and Blob**

Neon via Marketplace (creates `DATABASE_URL` automatically): `vercel integration add neon` — if the CLI flow doesn't offer it, ask Jens to add the Neon integration to the project in the Vercel dashboard (Storage → Marketplace → Neon). Blob: dashboard → Storage → Blob → create store and connect to the project (provides `BLOB_READ_WRITE_TOKEN`).

- [ ] **Step 3: Get the Zernio account id**

Jens holds the API key. With it (never paste it into files or logs):

```bash
read -s ZKEY   # Jens pastes the key into the terminal prompt
curl -s https://zernio.com/api/v1/accounts -H "Authorization: Bearer $ZKEY" | head -c 2000
```

If no LinkedIn account is listed yet, Jens connects it first: Zernio dashboard → profile → Connect account → LinkedIn (or via `GET /api/v1/connect/linkedin?profileId=…`). Note the LinkedIn account's id → `ZERNIO_ACCOUNT_ID`.

- [ ] **Step 4: Set env vars (production + preview + development)**

```bash
openssl rand -base64 32   # → SESSION_SECRET
openssl rand -base64 32   # → CRON_SECRET
vercel env add APP_PASSWORD
vercel env add SESSION_SECRET
vercel env add CRON_SECRET
vercel env add ZERNIO_API_KEY
vercel env add ZERNIO_ACCOUNT_ID
vercel env pull .env.local   # for local dev + migration run
```

(`DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` arrive via the integrations.)

- [ ] **Step 5: Run the migration**

```bash
set -a; source .env.local; set +a
npm run migrate
```

Expected output: `apply 001_init.sql` then `migrations complete`. Sanity check the repos are live: start `vercel dev`, log in, add slots in Settings, create a queued post, confirm the queue shows a computed date. This is the real-DB verification for Task 4.

- [ ] **Step 6: Grant CI access to the design-system package** (known gotcha — UI only)

Ask Jens: GitHub → `Studio-Manfred/manfred-design-system` package settings → Manage Actions access → add `manfred-schedule-linkedin`. Re-run the failed CI workflow after — it must go green.

- [ ] **Step 7: Deploy and verify cron**

```bash
vercel deploy --prod
```

Then verify: Vercel dashboard → project → Settings → Cron Jobs shows `/api/cron/publish` at `*/5 * * * *`. Trigger it once manually:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<production-domain>/api/cron/publish
```

Expected: `{"published":0,"requeued":0,"failed":0,"missed":0,"swept":0}`.

- [ ] **Step 8: End-to-end smoke test with a real post**

In the production app: log in → Settings → confirm "Connected via Zernio as …" → compose a short real test post → **Pin** it ~10 minutes ahead → wait for the tick → confirm it appears on Jens's LinkedIn profile and in History with a link/status. Jens may delete the post on LinkedIn afterwards. Also verify the alt-text open question: attach an image with alt text and check whether LinkedIn shows it (screen reader or LinkedIn's alt-text view); if it doesn't arrive, add the noted UI caveat in `ImageAttach` copy.

- [ ] **Step 9: Commit any fixes**

```bash
git add -A && git commit -m "fix: production wiring adjustments from smoke test" && git push
```

---

### Task 18: Documentation and project memory

**Files:**
- Rewrite: `README.md` (the stamped starter README)
- Create/update: `changelog.md`
- Update: `MEMORY.md`
- Update: `knowledge/INDEX.md` (+ create `knowledge/zernio.md`)

- [ ] **Step 1: Rewrite `README.md`**

Cover, in this order: what the app is (one paragraph); architecture diagram-in-words (SPA → api/ → Neon/Blob → cron → Zernio → LinkedIn); local dev (`npm install` with GITHUB_TOKEN note, `vercel env pull .env.local`, `npm run migrate`, `vercel dev`); test commands (`test:run`, `test:e2e`, `typecheck:api`, `coverage:check`); env var table (copy from `.env.example` with one-line descriptions); deployment (auto via Vercel-GitHub, cron at `*/5 * * * *`); operational notes (Zernio holds the LinkedIn connection — reconnect in their dashboard if publishes fail with auth errors; missed posts hold after 60 min; max 3 attempts).

- [ ] **Step 2: Create `changelog.md`**

```markdown
# Changelog

## 0.1.0 — 2026-07-XX

Initial release: single-user LinkedIn scheduler.

- Buffer-style queue slots (Europe/Stockholm) with pin-to-exact-time override
- Text + image posts with enforced alt text
- Auto-publish via Zernio (`publishNow`) on a 5-minute Vercel Cron
- Retry (3 attempts), missed-window guard (60 min), stuck-publish sweeper
- Playwright E2E + axe WCAG 2.2 AA checks
```

(Replace `XX` with the actual date at execution time.)

- [ ] **Step 3: Update `MEMORY.md`** — where the project stands, what's deployed, what v2 candidates were explicitly cut (company page, documents/PDF, AI assist, analytics).

- [ ] **Step 4: Create `knowledge/zernio.md`** — domain notes: base URL, auth header, `x-request-id` idempotency, 409 dedup semantics, presign media flow, temp-storage caveat, where the full reference lives (`docs/llms-full.txt`). Add a line for it in `knowledge/INDEX.md`.

- [ ] **Step 5: Final verification and commit**

```bash
npm run test:run && npm run lint && npm run typecheck:api && npm run build
git add -A
git commit -m "docs: README, changelog and project knowledge for v1"
git push
```

---

## Self-Review Notes

- **Spec coverage:** architecture/4 parts → Tasks 1–2, 4; queue mechanics + invariant → Tasks 3, 7; Zernio publish flow incl. presign/idempotency/409 → Task 6; cron tick incl. claim/missed/sweeper/retries → Task 10; five screens → Tasks 11–15; auth & env vars → Tasks 5, 17; error-handling table → Tasks 6, 10, 14; testing strategy → every task + Task 16; prerequisites/provisioning incl. DS-package gotcha → Task 17; alt-text open question → Task 17 Step 8; docs per CLAUDE.md → Task 18. Repos (Task 4) intentionally have no unit tests — verified live in Task 17 Step 5.
- **Known judgment calls:** retry re-deals a failed pinned post onto the queue (unpins) rather than re-pinning a past time; `POST /api/posts` `action` defaults to `draft`; History sorts by scheduled/updated time descending; login rate limiting is a 500 ms failure delay (single-user threat model).
- **Type consistency:** `Post`/`Slot`/`PostImage` defined once in Task 3 and imported everywhere; API HTTP contract stated in Task 8 matches the client in Task 11; `TickDeps` names match `posts-repo` exports.
