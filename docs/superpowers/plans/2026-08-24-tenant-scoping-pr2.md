# Tenant Scoping (multi-user PR2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user their own isolated schedule by adding a `user_id` owner to `posts` and `schedule_slots` and threading `userId` through every user-facing repo function and route, so one user can never read or mutate another's data.

**Architecture:** A single migration adds `user_id` (backfilled to jens, then `NOT NULL`) to both data tables. Every user-facing repo read/write gains a `userId` parameter and an `AND user_id = …` guard; the cron's global functions (`claimDuePosts`, `sweepStuck`, `mark*`, `requeue`) stay unscoped. Routes swap `requireAuth` for `requireUser` and pass the id in. Publishing stays env-based — per-user LinkedIn is PR3. Backend-only: the API JSON contracts don't change shape, so no frontend or E2E changes.

**Tech Stack:** Vercel serverless functions (`@vercel/node`, ESM), `@neondatabase/serverless` (`sql` tagged template), Vitest, TypeScript. Migrations run via `scripts/migrate.mjs` (splits on `/;\s*\n/`, one statement per `sql.query`).

**Spec:** `docs/superpowers/specs/2026-08-18-multi-user-google-auth-design.md` (§4 data model, §8 repos & routes, §9 PR2 row)

**Ticket:** STU-689 · **Branch:** `feat/STU-689-tenant-scoping`

## Global Constraints

- **Publishing stays env-based** this PR. Do NOT touch `api/cron/publish.ts`, `api/_lib/publish-tick.ts`, `api/_lib/publisher.ts`, or `api/connection.ts`. `claimDuePosts`, `sweepStuck`, `requeue`, `markPublished`, `markFailed`, `markMissed` remain **global** (no `userId`).
- **Allowlist unchanged.** Do NOT touch `ALLOWED_DOMAINS` or any auth/OAuth code. Opening the allowlist is PR3.
- **ESM imports:** every relative import in `api/**` ends in `.js` (even for `.ts` sources).
- **`api/**` is outside the coverage ratchet** (`coverage.include` is `src/**` only). PR2 changes no `src/**` files, so the ratchet is unaffected — keep it that way (no `src/` edits).
- **Migration statements must not contain a `;` inside a comment** — `scripts/migrate.mjs` splits on `/;\s*\n/`, so a semicolon in a trailing comment would split into a comment-only "statement" and error. Prefer no comments in the SQL.
- **Backfill target is jens** — `SELECT id FROM users WHERE email = 'jens@studiomanfred.com'` (seeded by migration `003`).
- Conventional commit naming the ticket: `feat(scope): summary (STU-689)`. Update docs in the same PR.

---

## File Structure

**Created:**
- `migrations/004_posts_user_id.sql` — add `user_id` to both tables, backfill, `NOT NULL`, per-user index.
- `api/_lib/repo-scoping.test.ts` — IDOR-guard unit tests (mock `sql`, assert `userId` is bound; ownership no-op).

**Modified:**
- `api/_lib/posts-repo.ts` — `userId` on every user-facing fn; global cron fns unchanged.
- `api/_lib/slots-repo.ts` — `userId` on `listSlots` / `replaceSlots`.
- `api/_lib/reschedule.ts` — `recomputeQueueLive(userId)`.
- `api/posts/index.ts`, `api/posts/[id].ts`, `api/posts/[id]/retry.ts`, `api/posts/reorder.ts`, `api/slots.ts` — `requireAuth` → `requireUser`; thread `userId`.
- `changelog.md`, `README.md`, `MEMORY.md` — document the scoping.

**Untouched (guarded by Global Constraints):** `api/cron/publish.ts`, `api/_lib/publish-tick.ts`, `api/_lib/publisher.ts`, `api/connection.ts`, `api/images.ts` (blob upload, no DB ownership — keeps `requireAuth`), all `src/**`, all auth/OAuth code.

---

## Task 1: Migration 004 — add `user_id`, backfill, NOT NULL, index

**Files:**
- Create: `migrations/004_posts_user_id.sql`

**Interfaces:**
- Produces: the `posts.user_id` and `schedule_slots.user_id` columns (both `NOT NULL` after backfill) that Task 2's repos read/write.

- [ ] **Step 1: Write the migration**

Create `migrations/004_posts_user_id.sql` with EXACTLY this content (no comments — see Global Constraints; each statement separated by a blank line so the `/;\s*\n/` splitter yields seven clean statements):

```sql
ALTER TABLE posts ADD COLUMN user_id uuid REFERENCES users(id);

ALTER TABLE schedule_slots ADD COLUMN user_id uuid REFERENCES users(id);

UPDATE posts SET user_id = (SELECT id FROM users WHERE email = 'jens@studiomanfred.com') WHERE user_id IS NULL;

UPDATE schedule_slots SET user_id = (SELECT id FROM users WHERE email = 'jens@studiomanfred.com') WHERE user_id IS NULL;

ALTER TABLE posts ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE schedule_slots ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS posts_user_due_idx ON posts (user_id, status, scheduled_at);
```

- [ ] **Step 2: Verify the statement splitter parses it into 7 statements**

Run (mirrors how `scripts/migrate.mjs` splits):
```bash
node -e "const fs=require('fs');const b=fs.readFileSync('migrations/004_posts_user_id.sql','utf8');const s=b.split(/;\s*\n/).map(x=>x.trim()).filter(Boolean);console.log(s.length);s.forEach((x,i)=>console.log(i, x.slice(0,40).replace(/\n/g,' ')))"
```
Expected: `7` statements, none beginning with `--`, the first being `ALTER TABLE posts ADD COLUMN user_id`.

- [ ] **Step 3: Commit**

```bash
git add migrations/004_posts_user_id.sql
git commit -m "feat(db): add user_id to posts & schedule_slots, backfill jens (STU-689)"
```

**Do NOT run `npm run migrate`** — the migration runs against prod Neon at deploy time by the operator, not during implementation.

---

## Task 2: Scope repos, reschedule, and routes + IDOR-guard tests

This is one atomic refactor: changing a repo signature ripples to `reschedule.ts` and the routes, so they land together to keep `npm run typecheck:api` green. Write the failing repo test first.

**Files:**
- Create: `api/_lib/repo-scoping.test.ts`
- Modify: `api/_lib/posts-repo.ts`, `api/_lib/slots-repo.ts`, `api/_lib/reschedule.ts`, `api/posts/index.ts`, `api/posts/[id].ts`, `api/posts/[id]/retry.ts`, `api/posts/reorder.ts`, `api/slots.ts`

**Interfaces:**
- Consumes: `requireUser(req, res): string | null` (from `api/_lib/http.ts`, already exists); `posts.user_id` / `schedule_slots.user_id` (Task 1).
- Produces (new repo signatures — `userId` is the FIRST parameter everywhere):
  - `listPosts(userId, statuses?)`, `getPost(userId, id)`, `insertPost(userId, p)`, `updatePost(userId, id, patch)`, `deletePost(userId, id)`, `listQueuedUnpinnedIds(userId)`, `listPinnedFutureTimes(userId, now)`, `saveSchedule(userId, entries)`, `setPositions(userId, orderedIds)`, `nextPosition(userId)`
  - `listSlots(userId)`, `replaceSlots(userId, slots)`
  - `recomputeQueueLive(userId)`
  - **Unchanged / still global:** `claimDuePosts(now)`, `requeue(id, error)`, `markPublished(...)`, `markFailed(...)`, `markMissed(...)`, `sweepStuck(cutoff)`

- [ ] **Step 1: Write the failing IDOR-guard test**

Create `api/_lib/repo-scoping.test.ts`. It mocks `./db.js` with a tagged-template spy that records every query's bound values, so we can assert `userId` is bound on scoped queries and that an unowned `updatePost` is a no-op.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A tagged-template spy standing in for the neon client.
const calls: { text: string; values: unknown[] }[] = []
let results: unknown[][] = []

function tag(strings: TemplateStringsArray, ...values: unknown[]) {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve(results.shift() ?? [])
}
// replaceSlots uses .transaction([...]) whose elements are tagged calls (already
// captured above); the transaction itself just needs to resolve.
;(tag as unknown as { transaction: (q: unknown[]) => Promise<unknown> }).transaction = () =>
  Promise.resolve([])

vi.mock('./db.js', () => ({ sql: () => tag }))

// Import AFTER the mock is registered.
import * as posts from './posts-repo.js'
import * as slots from './slots-repo.js'

beforeEach(() => {
  calls.length = 0
  results = []
})
afterEach(() => vi.clearAllMocks())

const ROW = {
  id: 'p1', body: 'x', images: [], first_comment: null, status: 'queued',
  pinned: false, position: 0, scheduled_at: null, zernio_post_id: null,
  linkedin_url: null, error: null, attempts: 0,
  created_at: '2026-07-15T09:00:00.000Z', updated_at: '2026-07-15T09:00:00.000Z',
}

describe('posts-repo user scoping', () => {
  it('getPost binds the userId', async () => {
    results = [[ROW]]
    await posts.getPost('u1', 'p1')
    expect(calls[0].values).toContain('u1')
    expect(calls[0].values).toContain('p1')
  })

  it('updatePost on a post the user does not own is a no-op (guarded by getPost)', async () => {
    results = [[]] // scoped getPost finds nothing → not owned
    const out = await posts.updatePost('intruder', 'p1', { body: 'hacked' })
    expect(out).toBeNull()
    expect(calls).toHaveLength(1) // only the SELECT ran; no UPDATE issued
  })

  it('deletePost binds the userId', async () => {
    await posts.deletePost('u1', 'p1')
    expect(calls[0].values).toEqual(expect.arrayContaining(['p1', 'u1']))
  })

  it('insertPost binds the userId', async () => {
    results = [[ROW]]
    await posts.insertPost('u1', {
      body: 'x', images: [], firstComment: null, status: 'draft',
      pinned: false, position: null, scheduledAt: null,
    })
    expect(calls[0].values).toContain('u1')
  })

  it('listPosts binds the userId', async () => {
    results = [[]]
    await posts.listPosts('u1')
    expect(calls[0].values).toContain('u1')
  })
})

describe('slots-repo user scoping', () => {
  it('listSlots binds the userId', async () => {
    results = [[]]
    await slots.listSlots('u1')
    expect(calls[0].values).toContain('u1')
  })

  it('replaceSlots scopes the DELETE and INSERT to the userId', async () => {
    results = [[]] // final listSlots() result
    await slots.replaceSlots('u1', [{ weekday: 1, timeLocal: '09:00' }])
    const del = calls.find((c) => c.text.includes('DELETE FROM schedule_slots'))
    const ins = calls.find((c) => c.text.includes('INSERT INTO schedule_slots'))
    expect(del?.values).toContain('u1')
    expect(ins?.values).toContain('u1')
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run api/_lib/repo-scoping.test.ts`
Expected: FAIL (current repos take no `userId`; e.g. `getPost('u1','p1')` calls with the wrong args, `calls[0].values` won't contain `'u1'`, and TS may error on arity).

- [ ] **Step 3: Scope `api/_lib/posts-repo.ts`**

Replace each user-facing function with its scoped form. `userId` is the first parameter. The global cron functions (`claimDuePosts`, `requeue`, `markPublished`, `markFailed`, `markMissed`, `sweepStuck`) and `rowToPost` are UNCHANGED. Interfaces `NewPost`/`PostPatch` are UNCHANGED.

```ts
export async function listPosts(userId: string, statuses?: PostStatus[]): Promise<Post[]> {
  const rows = statuses
    ? await sql()`SELECT * FROM posts WHERE user_id = ${userId} AND status = ANY(${statuses}) ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
    : await sql()`SELECT * FROM posts WHERE user_id = ${userId} ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
  return (rows as any[]).map(rowToPost)
}

export async function getPost(userId: string, id: string): Promise<Post | null> {
  const rows = (await sql()`SELECT * FROM posts WHERE id = ${id} AND user_id = ${userId}`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function insertPost(userId: string, p: NewPost): Promise<Post> {
  const rows = (await sql()`
    INSERT INTO posts (user_id, body, images, first_comment, status, pinned, position, scheduled_at)
    VALUES (${userId}, ${p.body}, ${JSON.stringify(p.images)}::jsonb, ${p.firstComment}, ${p.status}, ${p.pinned}, ${p.position}, ${p.scheduledAt})
    RETURNING *`) as any[]
  return rowToPost(rows[0])
}

export async function updatePost(userId: string, id: string, patch: Partial<PostPatch>): Promise<Post | null> {
  const cur = await getPost(userId, id)
  if (!cur) return null
  const next = {
    body: patch.body ?? cur.body,
    images: patch.images ?? cur.images,
    firstComment: patch.firstComment !== undefined ? patch.firstComment : cur.firstComment,
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
      first_comment = ${next.firstComment},
      status = ${next.status}, pinned = ${next.pinned}, position = ${next.position},
      scheduled_at = ${next.scheduledAt}, attempts = ${next.attempts}, error = ${next.error},
      updated_at = now()
    WHERE id = ${id} AND user_id = ${userId} RETURNING *`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function deletePost(userId: string, id: string): Promise<void> {
  await sql()`DELETE FROM posts WHERE id = ${id} AND user_id = ${userId}`
}

export async function listQueuedUnpinnedIds(userId: string): Promise<string[]> {
  const rows = (await sql()`
    SELECT id FROM posts WHERE user_id = ${userId} AND status = 'queued' AND pinned = false
    ORDER BY position ASC NULLS LAST, created_at ASC`) as any[]
  return rows.map((r) => r.id)
}

export async function listPinnedFutureTimes(userId: string, now: Date): Promise<Date[]> {
  const rows = (await sql()`
    SELECT scheduled_at FROM posts
    WHERE user_id = ${userId} AND status = 'queued' AND pinned = true AND scheduled_at > ${now}`) as any[]
  return rows.map((r) => new Date(r.scheduled_at))
}

export async function saveSchedule(userId: string, entries: { id: string; scheduledAt: Date }[]): Promise<void> {
  for (const e of entries) {
    await sql()`UPDATE posts SET scheduled_at = ${e.scheduledAt}, updated_at = now() WHERE id = ${e.id} AND user_id = ${userId}`
  }
}

export async function setPositions(userId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await sql()`UPDATE posts SET position = ${i}, updated_at = now() WHERE id = ${orderedIds[i]} AND user_id = ${userId}`
  }
}

export async function nextPosition(userId: string): Promise<number> {
  const rows = (await sql()`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM posts
    WHERE user_id = ${userId} AND status = 'queued' AND pinned = false`) as any[]
  return rows[0].next
}
```

Leave `claimDuePosts`, `requeue`, `markPublished`, `markFailed`, `markMissed`, `sweepStuck` exactly as they are (global — the cron owns them).

- [ ] **Step 4: Scope `api/_lib/slots-repo.ts`**

```ts
import type { Slot } from '../../src/lib/types.js'
import { sql } from './db.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listSlots(userId: string): Promise<Slot[]> {
  const rows = (await sql()`SELECT id, weekday, time_local FROM schedule_slots WHERE user_id = ${userId} ORDER BY weekday, time_local`) as any[]
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, timeLocal: r.time_local }))
}

export async function replaceSlots(userId: string, slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]> {
  const sqlc = sql()
  await sqlc.transaction([
    sqlc`DELETE FROM schedule_slots WHERE user_id = ${userId}`,
    ...slots.map((s) => sqlc`INSERT INTO schedule_slots (user_id, weekday, time_local) VALUES (${userId}, ${s.weekday}, ${s.timeLocal})`),
  ])
  return listSlots(userId)
}
```

- [ ] **Step 5: Scope `api/_lib/reschedule.ts`**

`recomputeQueue(deps)` and the `RescheduleDeps` interface are UNCHANGED (the deps are still zero/one-arg closures). Only `recomputeQueueLive` changes — it takes `userId` and closes over it when wiring the repo calls:

```ts
/** Production wiring — call after any queue mutation, scoped to one user. */
export function recomputeQueueLive(userId: string): Promise<void> {
  return recomputeQueue({
    listSlots: () => slotsRepo.listSlots(userId),
    listQueuedUnpinnedIds: () => postsRepo.listQueuedUnpinnedIds(userId),
    listPinnedFutureTimes: (now) => postsRepo.listPinnedFutureTimes(userId, now),
    saveSchedule: (entries) => postsRepo.saveSchedule(userId, entries),
    now: () => new Date(),
  })
}
```

- [ ] **Step 6: Update the routes — `requireAuth` → `requireUser`, thread `userId`**

For each route: replace `import { methodIs, requireAuth, sendJson }` with `requireUser` (keep `methodIs`/`sendJson`), replace the guard with `const userId = requireUser(req, res); if (!userId) return`, and pass `userId` into every repo/`recomputeQueueLive` call.

`api/posts/index.ts` — guard becomes `const userId = requireUser(req, res); if (!userId) return`; then:
- GET: `posts.listPosts(userId)`
- pin branch: `posts.insertPost(userId, { ...valid.value, status: 'queued', pinned: true, position: null, scheduledAt: at })`, `recomputeQueueLive(userId)`, `posts.getPost(userId, post.id)`
- queue branch: `slots.listSlots(userId)`, `posts.nextPosition(userId)`, `posts.insertPost(userId, { ...valid.value, status: 'queued', pinned: false, position, scheduledAt: null })`, `recomputeQueueLive(userId)`, `posts.getPost(userId, post.id)`
- draft (final): `posts.insertPost(userId, { ...valid.value, status: 'draft', pinned: false, position: null, scheduledAt: null })`

`api/posts/[id].ts` — guard → `requireUser`; then:
- `posts.getPost(userId, id)` (the `existing` lookup)
- DELETE: `posts.deletePost(userId, id)`, `recomputeQueueLive(userId)`
- **type fix:** the patch var is typed `let patch: Parameters<typeof posts.updatePost>[1]` — now that `userId` is param 0 and `id` is param 1, the patch is param **2**. Change to `Parameters<typeof posts.updatePost>[2]`.
- queue branch: `slots.listSlots(userId)`, `posts.nextPosition(userId)`
- final: `posts.updatePost(userId, id, patch)`, `recomputeQueueLive(userId)`, `posts.getPost(userId, id)`

`api/posts/[id]/retry.ts` — guard → `requireUser`; then `posts.getPost(userId, id)`, `slots.listSlots(userId)`, `posts.nextPosition(userId)`, `posts.updatePost(userId, id, { ... })`, `recomputeQueueLive(userId)`, final `posts.getPost(userId, id)`.

`api/posts/reorder.ts` — guard → `requireUser`; then `posts.setPositions(userId, orderedIds)`, `recomputeQueueLive(userId)`, `posts.listPosts(userId)`.

`api/slots.ts` — guard → `requireUser`; then GET `slots.listSlots(userId)`; PUT `slots.replaceSlots(userId, valid.value)`, `recomputeQueueLive(userId)`.

- [ ] **Step 7: Run the scoping test + full api typecheck**

Run: `npx vitest run api/_lib/repo-scoping.test.ts` → PASS (all 7).
Run: `npm run typecheck:api` → clean (no arity/type errors; confirms every caller threads `userId`, incl. the `[id].ts` `Parameters<…>[2]` fix).

- [ ] **Step 8: Run the whole unit suite + lint**

Run: `npm run test:run` → all pass (existing `reschedule.test.ts` / `publish-tick.test.ts` untouched and green — their injected deps didn't change).
Run: `npm run lint` → clean.

- [ ] **Step 9: Commit**

```bash
git add api/_lib/posts-repo.ts api/_lib/slots-repo.ts api/_lib/reschedule.ts \
        api/posts/index.ts "api/posts/[id].ts" "api/posts/[id]/retry.ts" \
        api/posts/reorder.ts api/slots.ts api/_lib/repo-scoping.test.ts
git commit -m "feat(api): scope posts & slots per user with IDOR guards (STU-689)"
```

---

## Task 3: Docs

**Files:**
- Modify: `changelog.md`, `README.md`, `MEMORY.md`

- [ ] **Step 1: Changelog**

In `changelog.md`, under the EXISTING `## [Unreleased]` → `### Changed` heading (do not create a new heading block — merge into the existing one), add:

```markdown
- Multi-tenant data isolation: `posts` and `schedule_slots` now carry a `user_id` owner
  (migration `004`), and every queue/draft/history/slots read and write is scoped to the
  signed-in user with `AND user_id = …` ownership guards. Publishing stays env-based for
  now (only jens is active); per-user LinkedIn credentials land in PR3. (STU-689)
```

- [ ] **Step 2: README**

In `README.md`, wherever the data model / auth is described, note that data is per-user: each signed-in user sees and edits only their own posts and slots; the cron's claim remains global. Keep it to 1–3 sentences consistent with the existing README voice. If a "migrations" list exists, add `004_posts_user_id.sql`.

- [ ] **Step 3: MEMORY**

Append a dated entry to `MEMORY.md` (2026-08-24): PR2 (STU-689) shipped tenant scoping — `user_id` on posts/slots, repo+route scoping, IDOR guards, publishing still env-based. Next pickup: PR3 (per-user Zernio creds + connect onboarding, then open `ALLOWED_DOMAINS` to `seventyoneconsulting.se` + `matherstudio.se`).

- [ ] **Step 4: Commit**

```bash
git add changelog.md README.md MEMORY.md
git commit -m "docs: record per-user tenant scoping (STU-689)"
```

---

## Post-implementation (operator, not the implementer)

After merge, the operator runs `004` against prod Neon:
```
DATABASE_URL='<real prod url>' node scripts/migrate.mjs
```
(`skip 001/002/003`, `apply 004_posts_user_id.sql`). Only then is the deploy consistent — but since `NOT NULL` is backfilled inside the migration and only jens has data, there's no window where existing rows lack an owner.

---

## Self-Review

**Spec coverage (§8):** listPosts/getPost/insertPost/updatePost/deletePost/listQueuedUnpinnedIds/listPinnedFutureTimes/saveSchedule/setPositions/nextPosition ✅ scoped; listSlots/replaceSlots ✅; recomputeQueueLive(userId) ✅; claimDuePosts/sweepStuck stay global ✅; routes posts/index, posts/[id], posts/[id]/retry, posts/reorder, slots ✅. `images` intentionally stays `requireAuth` (no DB ownership); `connection` is env-based until PR3 — both noted, not defects.

**Sequencing (§9):** migration `004` (add + backfill + NOT NULL) lands in the SAME PR as the repo writes that populate `user_id`, so `NOT NULL` is never live before writes set it. ✅

**Type consistency:** `userId` is param 0 on every scoped fn. The one place that indexed the old signature — `Parameters<typeof posts.updatePost>[1]` in `[id].ts` — is explicitly moved to `[2]` (Task 2 Step 6). ✅

**Green-at-each-boundary:** T1 is SQL only (no TS). T2 bundles the signature change with every caller so `typecheck:api` is clean at commit. T3 is docs. ✅

**Coverage ratchet:** no `src/**` changes → src coverage identical → ratchet green; new `api/` test is outside the ratchet. ✅

**Out of scope (guarded):** cron/publish-tick/publisher/connection untouched; allowlist untouched; publishing stays env-based. ✅
