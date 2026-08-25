# Per-User LinkedIn (multi-user PR3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user run their own LinkedIn schedule end to end — bring their own Zernio account, paste an API key stored encrypted at rest, and have the cron publish each user's posts with their own credentials — then open the domain allowlist to all three domains.

**Architecture:** A new `crypto.ts` (AES-256-GCM) encrypts each user's Zernio API key into the existing `users.zernio_api_key_enc` column. `connection.ts` becomes per-user (paste key → confirm account → store encrypted). The cron's `claimDuePosts` starts carrying `user_id`; the tick resolves a publisher per user from their decrypted creds (with an env-cred fallback for jens during the transition), and releases a no-creds user's posts back to `queued` instead of failing them. A Settings panel drives the connect/disconnect UX. The publisher interface (`ZernioPublisher({apiKey, accountId})`) is already per-credential and does not change.

**Tech Stack:** Vercel serverless functions (`@vercel/node`, ESM — relative imports end in `.js`), `node:crypto` (AES-256-GCM), `@neondatabase/serverless`, React 19 + Tailwind + `@studio-manfred/manfred-design-system`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-multi-user-google-auth-design.md` (§6, §7, §9)

**Ticket:** STU-690 · **Branch:** `feat/STU-690-per-user-linkedin`

## Global Constraints

- **The plaintext Zernio API key never leaves the server.** It is encrypted at rest (`zernio_api_key_enc`), never returned by any GET, never put in the `User` type, never logged.
- **`CRED_ENC_KEY`** is a 32-byte key, base64-encoded, read from env. Separate from `SESSION_SECRET`. `crypto.ts` throws if it is missing or the wrong length.
- **Transition fallback:** the cron falls back to env `ZERNIO_API_KEY`/`ZERNIO_ACCOUNT_ID` **only** for the single user whose email equals `ZERNIO_FALLBACK_EMAIL` (jens), and only when that user has no stored creds. No fallback for anyone else — a user without creds must never publish through someone else's account.
- **Opening `ALLOWED_DOMAINS`** to the other two domains is an **operator env step done after** per-user publishing is verified on the deploy — NOT a code change in this PR (the code already reads the env var). The plan updates only the `.env.example` documentation/comment.
- **ESM imports** in `api/**` end in `.js`. `api/tsconfig.json` has `noUncheckedIndexedAccess: true` — narrow indexed access.
- **Coverage ratchet** applies to `src/**` (Task 5 adds UI — keep its branches tested). `api/**` stays outside the ratchet.
- Conventional commits naming the ticket: `feat(scope): summary (STU-690)`. Docs update in the same PR.

---

## File Structure

**Created:**
- `api/_lib/crypto.ts` + `api/_lib/crypto.test.ts` — AES-256-GCM encrypt/decrypt.
- `api/_lib/zernio-accounts.ts` + `api/_lib/zernio-accounts.test.ts` — list+normalize a key's LinkedIn accounts (pure over an injected fetch).

**Modified:**
- `api/_lib/users-repo.ts` — credential store fns.
- `api/connection.ts` — per-user GET/POST/DELETE.
- `api/_lib/posts-repo.ts` — `ClaimedPost` (carries `userId`), `claimDuePosts` returns it, new `releaseToQueued`.
- `api/_lib/publish-tick.ts` + `api/_lib/publish-tick.test.ts` — `resolvePublisher` dep, per-user grouping, `released` counter.
- `api/cron/publish.ts` — resolve each user's publisher (decrypt creds; env fallback for jens).
- `src/api/client.ts` — `connectStart`/`connectConfirm`/`disconnect`.
- `src/screens/SettingsScreen.tsx` + `src/screens/SettingsScreen.test.tsx` — Connect/Disconnect panel.
- `.env.example`, `README.md`, `changelog.md`, `MEMORY.md`.

**Untouched:** `api/_lib/publisher.ts` (already per-credential), auth/OAuth, migrations (columns exist since `003`), the scoped repos from PR2.

---

## Task 1: `crypto.ts` — AES-256-GCM encrypt/decrypt (TDD)

**Files:** Create `api/_lib/crypto.ts`, `api/_lib/crypto.test.ts`

**Interfaces:**
- Produces: `encrypt(plain: string): string` (returns `"ivB64.tagB64.dataB64"`), `decrypt(payload: string): string` (throws on malformed/tampered). Consumed by Task 3 (connection) and Task 4 (cron).

- [ ] **Step 1: Write the failing test** — `api/_lib/crypto.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encrypt, decrypt } from './crypto'

// 32 bytes base64 — deterministic test key.
const KEY = Buffer.alloc(32, 7).toString('base64')

describe('crypto (AES-256-GCM)', () => {
  beforeEach(() => { process.env.CRED_ENC_KEY = KEY })
  afterEach(() => { delete process.env.CRED_ENC_KEY })

  it('round-trips a value', () => {
    const secret = 'zk_live_abc123'
    expect(decrypt(encrypt(secret))).toBe(secret)
  })

  it('uses a distinct IV per call (ciphertexts differ for same plaintext)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })

  it('throws on a tampered ciphertext', () => {
    const enc = encrypt('secret')
    const [iv, tag, data] = enc.split('.')
    const flipped = data![0] === 'A' ? 'B' : 'A'
    const tampered = [iv, tag, flipped + data!.slice(1)].join('.')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('throws when CRED_ENC_KEY is missing', () => {
    delete process.env.CRED_ENC_KEY
    expect(() => encrypt('x')).toThrow(/CRED_ENC_KEY/)
  })

  it('throws when CRED_ENC_KEY is the wrong length', () => {
    process.env.CRED_ENC_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })
})
```

- [ ] **Step 2: Run it — verify it fails.** `npx vitest run api/_lib/crypto.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `api/_lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'

function key(): Buffer {
  const b64 = process.env.CRED_ENC_KEY
  if (!b64) throw new Error('CRED_ENC_KEY not set')
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('CRED_ENC_KEY must decode to 32 bytes')
  return k
}

/** Returns "ivB64.tagB64.dataB64". */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed ciphertext')
  const decipher = createDecipheriv(ALG, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run tests + typecheck.** `npx vitest run api/_lib/crypto.test.ts` → PASS (5/5). `npm run typecheck:api` → clean.

- [ ] **Step 5: Commit.** `git add api/_lib/crypto.ts api/_lib/crypto.test.ts && git commit -m "feat(api): AES-256-GCM crypto for credential encryption (STU-690)"`

---

## Task 2: `users-repo` credential store

**Files:** Modify `api/_lib/users-repo.ts`

**Interfaces:**
- Consumes: `sql` (existing).
- Produces: `setZernioConnection(userId, apiKeyEnc, accountId)`, `clearZernioConnection(userId)`, `getZernioCreds(userId): Promise<{apiKeyEnc, accountId} | null>`. Consumed by Task 3 (connection) and Task 4 (cron). `User`/`getUserById`/`upsertUserByEmail` are UNCHANGED (still never expose the encrypted key).

- [ ] **Step 1: Append the three functions** to `api/_lib/users-repo.ts`:

```ts
export async function setZernioConnection(userId: string, apiKeyEnc: string, accountId: string): Promise<void> {
  await sql()`UPDATE users SET zernio_api_key_enc = ${apiKeyEnc}, zernio_account_id = ${accountId}, updated_at = now() WHERE id = ${userId}`
}

export async function clearZernioConnection(userId: string): Promise<void> {
  await sql()`UPDATE users SET zernio_api_key_enc = NULL, zernio_account_id = NULL, updated_at = now() WHERE id = ${userId}`
}

export async function getZernioCreds(userId: string): Promise<{ apiKeyEnc: string; accountId: string } | null> {
  const rows = (await sql()`SELECT zernio_api_key_enc, zernio_account_id FROM users WHERE id = ${userId}`) as any[]
  const r = rows[0]
  if (!r || !r.zernio_api_key_enc || !r.zernio_account_id) return null
  return { apiKeyEnc: r.zernio_api_key_enc, accountId: r.zernio_account_id }
}
```

- [ ] **Step 2: Typecheck.** `npm run typecheck:api` → clean. (No unit test — matches the thin-repo precedent; the security-critical logic is `crypto.ts` (tested) and the route in Task 3.)

- [ ] **Step 3: Commit.** `git add api/_lib/users-repo.ts && git commit -m "feat(api): user Zernio credential store (set/clear/get) (STU-690)"`

---

## Task 3: `zernio-accounts` helper + per-user `connection.ts`

**Files:** Create `api/_lib/zernio-accounts.ts`, `api/_lib/zernio-accounts.test.ts`; rewrite `api/connection.ts`

**Interfaces:**
- Consumes: `crypto.encrypt`/`decrypt` (T1), `users-repo` cred fns (T2), `requireUser` (exists).
- Produces: `listZernioAccounts(apiKey, fetchImpl?): Promise<{id, name}[]>`. The `/api/connection` GET/POST/DELETE contract consumed by Task 5's client.

- [ ] **Step 1: Write the failing helper test** — `api/_lib/zernio-accounts.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { listZernioAccounts } from './zernio-accounts'

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch
}

describe('listZernioAccounts', () => {
  it('normalizes LinkedIn accounts to {id, name}', async () => {
    const f = fetchReturning(200, { accounts: [
      { _id: 'a1', platform: 'linkedin', displayName: 'Jens Wedin' },
      { id: 'a2', platform: 'twitter', name: 'Ignore Me' },
    ] })
    expect(await listZernioAccounts('k', f)).toEqual([{ id: 'a1', name: 'Jens Wedin' }])
  })

  it('throws on an unauthorized key', async () => {
    await expect(listZernioAccounts('bad', fetchReturning(401, {}))).rejects.toThrow(/invalid/i)
  })
})
```

- [ ] **Step 2: Run it — verify it fails.** `npx vitest run api/_lib/zernio-accounts.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `api/_lib/zernio-accounts.ts`:

```ts
const BASE = 'https://zernio.com/api/v1'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Returns the key's LinkedIn accounts as {id, name}. Throws 'invalid Zernio API key' on 401. */
export async function listZernioAccounts(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  const r = await fetchImpl(`${BASE}/accounts`, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (r.status === 401) throw new Error('invalid Zernio API key')
  if (!r.ok) throw new Error(`Zernio accounts request failed (${r.status})`)
  const data = (await r.json()) as { accounts?: any[] }
  return (data.accounts ?? [])
    .filter((a) => (a.platform ?? '').toLowerCase() === 'linkedin')
    .map((a) => ({
      id: String(a._id ?? a.id),
      name: String(a.displayName ?? a.name ?? a.username ?? 'LinkedIn account'),
    }))
}
```

- [ ] **Step 4: Run the helper test.** `npx vitest run api/_lib/zernio-accounts.test.ts` → PASS.

- [ ] **Step 5: Rewrite `api/connection.ts`** (per-user; replaces the env-based version entirely):

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson } from './_lib/http.js'
import { encrypt, decrypt } from './_lib/crypto.js'
import { getZernioCreds, setZernioConnection, clearZernioConnection } from './_lib/users-repo.js'
import { listZernioAccounts } from './_lib/zernio-accounts.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'POST', 'DELETE')) return
  const userId = requireUser(req, res)
  if (!userId) return

  if (req.method === 'GET') {
    const creds = await getZernioCreds(userId)
    if (!creds) return sendJson(res, 200, { connected: false, accountName: null })
    try {
      const accounts = await listZernioAccounts(decrypt(creds.apiKeyEnc))
      const acct = accounts.find((a) => a.id === creds.accountId)
      return sendJson(res, 200, { connected: Boolean(acct), accountName: acct?.name ?? null })
    } catch {
      return sendJson(res, 200, { connected: false, accountName: null })
    }
  }

  if (req.method === 'DELETE') {
    await clearZernioConnection(userId)
    return res.status(204).end()
  }

  // POST — phase 1 (no accountId): list the key's accounts; phase 2 (accountId): store.
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  if (!apiKey) return sendJson(res, 422, { error: 'apiKey required' })
  const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : undefined

  let accounts: { id: string; name: string }[]
  try {
    accounts = await listZernioAccounts(apiKey)
  } catch (e) {
    return sendJson(res, 422, { error: e instanceof Error ? e.message : 'could not reach Zernio' })
  }
  if (accounts.length === 0) return sendJson(res, 422, { error: 'no LinkedIn account connected in this Zernio account' })

  if (!accountId) return sendJson(res, 200, { accounts })

  const chosen = accounts.find((a) => a.id === accountId)
  if (!chosen) return sendJson(res, 422, { error: 'accountId not found for this key' })
  await setZernioConnection(userId, encrypt(apiKey), chosen.id)
  return sendJson(res, 200, { connected: true, accountName: chosen.name })
}
```

- [ ] **Step 6: Typecheck + lint + focused tests.** `npm run typecheck:api` clean; `npm run lint` clean; `npx vitest run api/_lib/crypto.test.ts api/_lib/zernio-accounts.test.ts` PASS.

- [ ] **Step 7: Commit.** `git add api/_lib/zernio-accounts.ts api/_lib/zernio-accounts.test.ts api/connection.ts && git commit -m "feat(api): per-user LinkedIn connect flow (paste key, confirm, store encrypted) (STU-690)"`

---

## Task 4: Per-user cron publishing

**Files:** Modify `api/_lib/posts-repo.ts`, `api/_lib/publish-tick.ts`, `api/_lib/publish-tick.test.ts`, `api/cron/publish.ts`

**Interfaces:**
- Consumes: `getZernioCreds` (T2), `getUserById` (exists), `decrypt` (T1), `ZernioPublisher` (exists).
- Produces: `ClaimedPost = Post & { userId }`; `claimDuePosts(now): Promise<ClaimedPost[]>`; `releaseToQueued(id)`; `TickDeps.resolvePublisher(userId): Promise<Publisher | null>`; `TickResult.released`.

- [ ] **Step 1: `posts-repo.ts` — add `ClaimedPost`, carry `userId` in `claimDuePosts`, add `releaseToQueued`.**

Add the type (near the top, after imports) and change `claimDuePosts`; add `releaseToQueued`. Everything else (including the global `requeue`/`mark*`/`sweepStuck`) is unchanged.

```ts
export type ClaimedPost = Post & { userId: string }

export async function claimDuePosts(now: Date): Promise<ClaimedPost[]> {
  const rows = (await sql()`
    UPDATE posts SET status = 'publishing', attempts = attempts + 1, updated_at = now()
    WHERE status = 'queued' AND scheduled_at <= ${now}
    RETURNING *`) as any[]
  return rows.map((r) => ({ ...rowToPost(r), userId: r.user_id }))
}

/** Undo a claim for a user who can't publish yet: back to queued, attempt not counted, no error. */
export async function releaseToQueued(id: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'queued', attempts = GREATEST(attempts - 1, 0), error = NULL, updated_at = now()
    WHERE id = ${id} AND status = 'publishing'`
}
```

- [ ] **Step 2: Rewrite the failing tick test** — `api/_lib/publish-tick.test.ts` (the current single-`publisher` shape is replaced by `resolvePublisher` + `ClaimedPost`; add the no-creds-release and two-user cases):

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runPublishTick } from './publish-tick'
import type { ClaimedPost } from './posts-repo'

const NOW = new Date('2026-07-21T06:31:00Z')

function post(overrides: Partial<ClaimedPost>): ClaimedPost {
  return {
    id: 'p1', body: 'hi', images: [], firstComment: null, status: 'publishing', pinned: false, position: 0,
    scheduledAt: '2026-07-21T06:30:00.000Z', zernioPostId: null, linkedinUrl: null,
    error: null, attempts: 1, createdAt: '', updatedAt: '', userId: 'u1', ...overrides,
  }
}

type Res = { ok: true; zernioPostId: string; linkedinUrl: string | null } | { ok: false; retryable: boolean; error: string }

function makeDeps(claimed: ClaimedPost[], resolve: (userId: string) => Promise<{ publish: (i: unknown) => Promise<Res> } | null>) {
  return {
    now: () => NOW,
    claimDuePosts: vi.fn(async () => claimed),
    releaseToQueued: vi.fn(async () => {}),
    requeue: vi.fn(async () => {}),
    markPublished: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    markMissed: vi.fn(async () => {}),
    sweepStuck: vi.fn(async () => 0),
    resolvePublisher: vi.fn(resolve),
  }
}
const okPublisher = (r: Res = { ok: true, zernioPostId: 'z1', linkedinUrl: 'https://li/x' }) => ({ publish: vi.fn(async () => r) })

describe('runPublishTick', () => {
  it('publishes with the post owner’s resolved publisher', async () => {
    const pub = okPublisher()
    const deps = makeDeps([post({})], async () => pub)
    const result = await runPublishTick(deps)
    expect(deps.resolvePublisher).toHaveBeenCalledWith('u1')
    expect(pub.publish).toHaveBeenCalledWith({ requestId: 'p1', body: 'hi', images: [], firstComment: null })
    expect(deps.markPublished).toHaveBeenCalledWith('p1', 'z1', 'https://li/x')
    expect(result.published).toBe(1)
  })

  it('releases a post to queued (not failed, not an attempt) when the owner has no publisher', async () => {
    const deps = makeDeps([post({})], async () => null)
    const result = await runPublishTick(deps)
    expect(deps.releaseToQueued).toHaveBeenCalledWith('p1')
    expect(deps.markFailed).not.toHaveBeenCalled()
    expect(deps.requeue).not.toHaveBeenCalled()
    expect(result.released).toBe(1)
  })

  it('resolves each user’s publisher once and publishes with the right one', async () => {
    const pubA = okPublisher({ ok: true, zernioPostId: 'zA', linkedinUrl: null })
    const pubB = okPublisher({ ok: true, zernioPostId: 'zB', linkedinUrl: null })
    const byUser: Record<string, ReturnType<typeof okPublisher>> = { u1: pubA, u2: pubB }
    const deps = makeDeps(
      [post({ id: 'a1', userId: 'u1' }), post({ id: 'a2', userId: 'u1' }), post({ id: 'b1', userId: 'u2' })],
      async (uid) => byUser[uid] ?? null,
    )
    const result = await runPublishTick(deps)
    expect(result.published).toBe(3)
    expect(pubA.publish).toHaveBeenCalledTimes(2)
    expect(pubB.publish).toHaveBeenCalledTimes(1)
    expect(deps.resolvePublisher).toHaveBeenCalledTimes(2) // resolved once per distinct user
  })

  it('marks a post >60 min late as missed without resolving a publisher', async () => {
    const deps = makeDeps([post({ scheduledAt: '2026-07-21T05:29:00.000Z' })], async () => okPublisher())
    const result = await runPublishTick(deps)
    expect(deps.markMissed).toHaveBeenCalledWith('p1')
    expect(result.missed).toBe(1)
  })

  it('requeues a retryable failure below max attempts', async () => {
    const deps = makeDeps([post({ attempts: 2 })], async () => okPublisher({ ok: false, retryable: true, error: 'zernio 500' }))
    const result = await runPublishTick(deps)
    expect(deps.requeue).toHaveBeenCalledWith('p1', 'zernio 500')
    expect(result.requeued).toBe(1)
  })

  it('fails hard at max attempts or on non-retryable errors', async () => {
    const deps = makeDeps([post({ attempts: 3 })], async () => okPublisher({ ok: false, retryable: true, error: 'zernio 500' }))
    await runPublishTick(deps)
    expect(deps.markFailed).toHaveBeenCalledWith('p1', 'zernio 500')
  })

  it('sweeps stuck posts with a 10-minute cutoff', async () => {
    const deps = makeDeps([], async () => okPublisher())
    deps.sweepStuck = vi.fn(async () => 2)
    const result = await runPublishTick(deps)
    expect(deps.sweepStuck).toHaveBeenCalledWith(new Date('2026-07-21T06:21:00Z'))
    expect(result.swept).toBe(2)
  })
})
```

- [ ] **Step 3: Run it — verify it fails.** `npx vitest run api/_lib/publish-tick.test.ts` → FAIL (deps shape changed).

- [ ] **Step 4: Rewrite `api/_lib/publish-tick.ts`:**

```ts
import { MAX_ATTEMPTS, MISSED_WINDOW_MINUTES, STUCK_PUBLISHING_MINUTES } from '../../src/lib/types.js'
import type { ClaimedPost } from './posts-repo.js'
import type { Publisher } from './publisher.js'

export interface TickDeps {
  now(): Date
  claimDuePosts(now: Date): Promise<ClaimedPost[]>
  releaseToQueued(id: string): Promise<void>
  requeue(id: string, error: string): Promise<void>
  markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markMissed(id: string): Promise<void>
  sweepStuck(cutoff: Date): Promise<number>
  resolvePublisher(userId: string): Promise<Publisher | null>
}

export interface TickResult {
  published: number
  requeued: number
  failed: number
  missed: number
  released: number
  swept: number
}

export async function runPublishTick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now()
  const result: TickResult = { published: 0, requeued: 0, failed: 0, missed: 0, released: 0, swept: 0 }

  result.swept = await deps.sweepStuck(new Date(now.getTime() - STUCK_PUBLISHING_MINUTES * 60_000))

  // Resolve each distinct user's publisher at most once per tick.
  const publishers = new Map<string, Publisher | null>()
  const publisherFor = async (userId: string): Promise<Publisher | null> => {
    if (!publishers.has(userId)) publishers.set(userId, await deps.resolvePublisher(userId))
    return publishers.get(userId) ?? null
  }

  for (const post of await deps.claimDuePosts(now)) {
    const scheduled = post.scheduledAt ? new Date(post.scheduledAt) : now
    if (now.getTime() - scheduled.getTime() > MISSED_WINDOW_MINUTES * 60_000) {
      await deps.markMissed(post.id)
      result.missed++
      continue
    }
    const publisher = await publisherFor(post.userId)
    if (!publisher) {
      await deps.releaseToQueued(post.id)
      result.released++
      continue
    }
    const outcome = await publisher.publish({
      requestId: post.id,
      body: post.body,
      images: post.images.map((i) => ({ url: i.url, alt: i.alt, contentType: guessContentType(i.url) })),
      firstComment: post.firstComment,
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

- [ ] **Step 5: Rewrite `api/cron/publish.ts`** (resolve each user's publisher; env fallback for jens; drop the hard env requirement):

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendJson } from '../_lib/http.js'
import { runPublishTick } from '../_lib/publish-tick.js'
import { ZernioPublisher, type Publisher } from '../_lib/publisher.js'
import { getUserById, getZernioCreds } from '../_lib/users-repo.js'
import { decrypt } from '../_lib/crypto.js'
import * as posts from '../_lib/posts-repo.js'

async function resolvePublisher(userId: string): Promise<Publisher | null> {
  const creds = await getZernioCreds(userId)
  if (creds) return new ZernioPublisher({ apiKey: decrypt(creds.apiKeyEnc), accountId: creds.accountId })

  // Transition fallback: env creds, only for the configured fallback user (jens), only until they connect.
  const envKey = process.env.ZERNIO_API_KEY
  const envAcct = process.env.ZERNIO_ACCOUNT_ID
  const fallbackEmail = process.env.ZERNIO_FALLBACK_EMAIL
  if (envKey && envAcct && fallbackEmail) {
    const user = await getUserById(userId)
    if (user && user.email.toLowerCase() === fallbackEmail.toLowerCase()) {
      return new ZernioPublisher({ apiKey: envKey, accountId: envAcct })
    }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return sendJson(res, 401, { error: 'unauthorized' })
  }
  const result = await runPublishTick({
    now: () => new Date(),
    claimDuePosts: posts.claimDuePosts,
    releaseToQueued: posts.releaseToQueued,
    requeue: posts.requeue,
    markPublished: posts.markPublished,
    markFailed: posts.markFailed,
    markMissed: posts.markMissed,
    sweepStuck: posts.sweepStuck,
    resolvePublisher,
  })
  console.log('publish tick', JSON.stringify(result))
  return sendJson(res, 200, result)
}
```

- [ ] **Step 6: Run tick tests + whole api typecheck + full suite.** `npx vitest run api/_lib/publish-tick.test.ts` → PASS (7/7). `npm run typecheck:api` clean. `npm run test:run` all pass. `npm run lint` clean.

- [ ] **Step 7: Commit.** `git add api/_lib/posts-repo.ts api/_lib/publish-tick.ts api/_lib/publish-tick.test.ts api/cron/publish.ts && git commit -m "feat(api): per-user cron publishing with env fallback for jens (STU-690)"`

---

## Task 5: Settings — Connect / Disconnect LinkedIn panel

**Files:** Modify `src/api/client.ts`, `src/screens/SettingsScreen.tsx`, `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: the `/api/connection` contract from Task 3 (`POST {apiKey}` → `{accounts}`; `POST {apiKey, accountId}` → `{connected, accountName}`; `DELETE` → 204; `GET` → `{connected, accountName}`).

- [ ] **Step 1: Add client methods** to `src/api/client.ts` (after `getConnection`):

```ts
  async connectStart(apiKey: string): Promise<{ accounts: { id: string; name: string }[] }> {
    return request('/api/connection', { method: 'POST', body: JSON.stringify({ apiKey }) })
  },
  async connectConfirm(apiKey: string, accountId: string): Promise<{ connected: boolean; accountName: string | null }> {
    return request('/api/connection', { method: 'POST', body: JSON.stringify({ apiKey, accountId }) })
  },
  async disconnect(): Promise<void> {
    await request<void>('/api/connection', { method: 'DELETE' })
  },
```

- [ ] **Step 2: Write the failing UI test** — replace the connection assertions in `src/screens/SettingsScreen.test.tsx` and add connect/disconnect cases. Extend the mock with the new methods, and cover: not-connected → paste key → Find account → Connect; and connected → Disconnect.

```ts
// in the vi.mock api object, add: connectStart: vi.fn(), connectConfirm: vi.fn(), disconnect: vi.fn()
```

Add these tests inside `describe('SettingsScreen', …)`:

```ts
  it('connects LinkedIn: paste key, find account, confirm', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: false, accountName: null })
    vi.mocked(api.connectStart).mockResolvedValue({ accounts: [{ id: 'a1', name: 'Jens Wedin' }] })
    vi.mocked(api.connectConfirm).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
    render(<SettingsScreen onLogout={vi.fn()} />)
    await screen.findByLabelText(/zernio api key/i)
    await userEvent.type(screen.getByLabelText(/zernio api key/i), 'zk_test')
    await userEvent.click(screen.getByRole('button', { name: /find.*account/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^connect$/i }))
    expect(api.connectConfirm).toHaveBeenCalledWith('zk_test', 'a1')
  })

  it('disconnects LinkedIn', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
    vi.mocked(api.disconnect).mockResolvedValue()
    render(<SettingsScreen onLogout={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /disconnect/i }))
    expect(api.disconnect).toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run it — verify it fails.** `npx vitest run src/screens/SettingsScreen.test.tsx` → FAIL.

- [ ] **Step 4: Implement the panel** — replace the "LinkedIn connection" `<Card>` in `src/screens/SettingsScreen.tsx` with a connect/disconnect panel, and add the handlers/state. Keep the existing schedule + session cards untouched.

Add state near the other `useState` calls:

```tsx
  const [apiKey, setApiKey] = useState('')
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null)
  const [chosen, setChosen] = useState<string>('')
  const [connBusy, setConnBusy] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)

  async function refreshConnection() {
    setConnection(await api.getConnection())
  }
  async function findAccounts() {
    setConnError(null); setConnBusy(true)
    try {
      const { accounts } = await api.connectStart(apiKey)
      setAccounts(accounts)
      setChosen(accounts[0]?.id ?? '')
    } catch (e) { setConnError(e instanceof Error ? e.message : 'could not reach Zernio') }
    finally { setConnBusy(false) }
  }
  async function confirmConnect() {
    setConnError(null); setConnBusy(true)
    try {
      await api.connectConfirm(apiKey, chosen)
      setApiKey(''); setAccounts(null); setChosen('')
      await refreshConnection()
    } catch (e) { setConnError(e instanceof Error ? e.message : 'connect failed') }
    finally { setConnBusy(false) }
  }
  async function disconnect() {
    setConnBusy(true)
    try { await api.disconnect(); await refreshConnection() } finally { setConnBusy(false) }
  }
```

Replace the connection `<Card>` body with:

```tsx
      <Card as="section" aria-labelledby="conn-h" className="flex flex-col gap-3">
        <h2 id="conn-h" className="font-medium">LinkedIn connection</h2>
        {connection === null ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : connection.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Connected via Zernio as <strong>{connection.accountName}</strong>
            </p>
            <Button type="button" variant="outline" className="ml-auto" onClick={disconnect} disabled={connBusy}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Bring your own LinkedIn: create a free{' '}
              <a href="https://zernio.com" target="_blank" rel="noreferrer" className="underline">Zernio</a>{' '}
              account, connect your LinkedIn there, then paste your Zernio API key
              (Settings → API Keys) below.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span>Zernio API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setAccounts(null) }}
                className="rounded-md border border-input bg-background px-3 py-2"
                autoComplete="off"
              />
            </label>
            {accounts === null ? (
              <div>
                <Button type="button" variant="brand" onClick={findAccounts} disabled={!apiKey || connBusy}>
                  Find my account
                </Button>
              </div>
            ) : accounts.length === 0 ? (
              <p role="alert" className="text-sm text-destructive">
                No LinkedIn account is connected in that Zernio account yet.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span>LinkedIn account</span>
                  <Select value={chosen} onValueChange={setChosen}>
                    <SelectTrigger aria-label="LinkedIn account" className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </label>
                <Button type="button" variant="brand" onClick={confirmConnect} disabled={!chosen || connBusy}>
                  Connect
                </Button>
              </div>
            )}
            {connError && <p role="alert" className="text-sm text-destructive">{connError}</p>}
          </div>
        )}
      </Card>
```

- [ ] **Step 5: Run tests, typecheck, lint, coverage.** `npx vitest run src/screens/SettingsScreen.test.tsx` PASS; `npm run test:run` all pass; `npm run build` (typecheck+build) clean; `npm run lint` clean; `npm run test:coverage && npm run coverage:check` → ratchet green (add tests above keep the new branches covered; if a metric dips below tolerance, add a test for the uncovered branch — do NOT lower the baseline).

- [ ] **Step 6: Commit.** `git add src/api/client.ts src/screens/SettingsScreen.tsx src/screens/SettingsScreen.test.tsx && git commit -m "feat(settings): connect/disconnect LinkedIn per user (STU-690)"`

---

## Task 6: Env + docs

**Files:** Modify `.env.example`, `README.md`, `changelog.md`, `MEMORY.md`

- [ ] **Step 1: `.env.example`** — add the two new vars near the Zernio block, and note the fallback / allowlist:

```
# 32-byte key (base64) for encrypting stored Zernio API keys at rest, e.g. `openssl rand -base64 32`
CRED_ENC_KEY=
# Transition only: the cron uses the env ZERNIO_* creds for THIS user's posts until they connect
# their own Zernio account via Settings. Set to jens' email during rollout; remove once he reconnects.
ZERNIO_FALLBACK_EMAIL=
```
Update the `ALLOWED_DOMAINS` comment to: `# Comma-separated allowed signup domains. PR3: studiomanfred.com,seventyoneconsulting.se,matherstudio.se`. Keep `ZERNIO_API_KEY`/`ZERNIO_ACCOUNT_ID` (now the transition fallback for jens).

- [ ] **Step 2: `README.md`** — add a "Connect LinkedIn (per user)" note: each user creates a free Zernio account, connects LinkedIn, mints an API key, pastes it in Settings; the key is stored encrypted (`CRED_ENC_KEY`); the cron publishes each user's posts with their own creds; jens keeps publishing via the env fallback until he reconnects. 2–5 sentences, matching the README voice.

- [ ] **Step 3: `changelog.md`** — under the EXISTING `## [Unreleased]`, add to `### Added`: the per-user connect flow + encrypted Zernio creds; to `### Changed`: the cron now publishes per user with an env fallback for jens. Merge into the existing headings (do NOT create duplicate `### Added`/`### Changed`). Reference (STU-690).

- [ ] **Step 4: `MEMORY.md`** — dated 2026-08-24 entry: PR3 shipped (crypto, per-user connect, per-user cron, Settings panel). Next/operator: set `CRED_ENC_KEY` + `ZERNIO_FALLBACK_EMAIL` in Vercel, deploy, jens connects his own key, verify publish, THEN open `ALLOWED_DOMAINS` to all three domains and tell David/Moa to onboard.

- [ ] **Step 5: Commit.** `git add .env.example README.md changelog.md MEMORY.md && git commit -m "docs: per-user LinkedIn onboarding + env (STU-690)"`

---

## Post-implementation (operator, not the implementer) — the rollout order matters

After merge/deploy, in this order:
1. Set `CRED_ENC_KEY` (`openssl rand -base64 32`) and `ZERNIO_FALLBACK_EMAIL=jens@studiomanfred.com` in Vercel (Production). Redeploy.
2. jens opens Settings → Connect LinkedIn → pastes his own Zernio API key → confirms his account. (Until then, the env fallback keeps his posts publishing.)
3. Verify a real publish works with his own creds; then the `ZERNIO_FALLBACK_EMAIL` (and env `ZERNIO_*`) can be removed.
4. **Only then** set `ALLOWED_DOMAINS=studiomanfred.com,seventyoneconsulting.se,matherstudio.se`. David and Moa sign in (add them as Google OAuth test users if the consent screen is still in Testing), each connects their own Zernio account, and each gets their own isolated board.

No migration this PR — the `zernio_api_key_enc` / `zernio_account_id` columns already exist from migration `003`.

---

## Self-Review

**Spec coverage:** §6 crypto (T1) + per-user connection GET/POST/DELETE (T3) ✅; users-repo cred store (T2) ✅; §7 per-user cron with grouping, no-creds → released-not-failed, env fallback for jens (T4) ✅; Settings connect panel (T5) ✅; §9 open allowlist = operator step documented (T6 + Post-implementation) ✅.

**Green at each boundary:** T1/T2 add unused-yet code (green). T3 rewrites connection.ts using T1/T2 (GET response shape unchanged for the existing client). T4 changes `claimDuePosts` return type + tick deps + cron together (one atomic unit). T5 is the only `src/**` change (coverage covered by its tests). T6 docs. ✅

**Security:** plaintext key only in POST request body and transiently in the route before `encrypt`; never stored plaintext, never returned, never in `User`, never logged. `decrypt` only server-side (connection GET + cron). AES-256-GCM authenticates (tamper → throw). ✅

**Type consistency:** `ClaimedPost = Post & {userId}` keeps `userId` off the public `Post` type and out of user-facing responses (`rowToPost` unchanged); only `claimDuePosts` carries it, only the cron consumes it. `TickResult` gains `released` (all call sites are the cron + tests). ✅

**YAGNI:** no per-post "needs connection" column — the existing `me().linkedinConnected` banner covers the nudge; no-creds posts simply stay `queued`. Paste-key MVP per spec §12.3 (one-click Zernio connect deferred). ✅
