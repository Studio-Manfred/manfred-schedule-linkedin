# PR1 — Google OAuth login + user identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single password with Google sign-in and give every session a real user identity, laying the foundation for multi-tenancy — without yet scoping posts/slots per user.

**Architecture:** A new `users` table; the session token carries a `userId`; a Google OAuth authorization-code + PKCE flow (`/api/auth/google/start` + `/callback`) verifies the ID token, enforces a domain allowlist, upserts the user, and issues the session cookie. Repos/publishing are untouched — safe because only jens exists in PR1.

**Tech Stack:** React 19 + Vite, Vercel Node functions (`@vercel/node`, ESM), Neon Postgres via `@neondatabase/serverless`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-18-multi-user-google-auth-design.md` (see §5 Auth, §9 PR1, §10 Testing, §11 Security).

**Ticket:** File `STU-NNN` at execution start; branch `feat/STU-NNN-google-auth-pr1` off `main`.

## Global Constraints

- **ESM import extensions:** every relative import in `api/**` MUST end in `.js` (e.g. `from './session.js'`) — Vercel runs these as plain Node ESM; extensionless imports pass local tooling but 500 in prod (`knowledge/ERRORS.md`, 2026-07-20).
- **Frozen test clock:** the suite freezes `Date` to `2026-07-15T09:00:00.000Z` (`test/setup.ts`, STU-687). Pass explicit `now`/timestamps in tests; never assert on real wall-clock.
- **Coverage ratchet:** measured over `src/**` only (`vitest.config.ts` `coverage.include`), so `api/**` changes don't move it — but `src/**` changes (LoginScreen, client, App) do. Run `npm run test:coverage && npm run coverage:check` before every push; keep all four metrics within 0.5pp of `.coverage-baseline.json`.
- **Conventional commits** naming the ticket: `feat(auth): … (STU-NNN)`.
- **Accessibility:** the sign-in control is a real, keyboard-focusable, labeled element (`jsx-a11y` + axe sweep guard it).
- **Secrets:** never log tokens, codes, client secret, or session values.

---

### Task 1: Session token carries a userId

**Files:**
- Modify: `api/_lib/session.ts`
- Test: `api/_lib/session.test.ts`

**Interfaces:**
- Produces: `createSession(secret: string, userId: string, now?: number): string`; `verifySession(secret: string, token: string | undefined, now?: number): string | null` (was `boolean`). `checkPassword` is deleted.
- Token shape: `"<userId>.<expMs>.<hmacBase64url(secret, "<userId>.<expMs>")>"`. userIds are uuids (no `.`), so `split('.')` yields exactly 3 parts.

- [ ] **Step 1: Rewrite the failing tests** in `api/_lib/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSession, verifySession } from './session.js'

const SECRET = 'test-secret'
const NOW = Date.parse('2026-07-15T09:00:00.000Z')
const UID = '11111111-1111-1111-1111-111111111111'

describe('session', () => {
  it('round-trips the userId', () => {
    const token = createSession(SECRET, UID, NOW)
    expect(verifySession(SECRET, token, NOW)).toBe(UID)
  })
  it('rejects a tampered mac', () => {
    const token = createSession(SECRET, UID, NOW).slice(0, -1) + 'x'
    expect(verifySession(SECRET, token, NOW)).toBeNull()
  })
  it('rejects a wrong secret', () => {
    const token = createSession(SECRET, UID, NOW)
    expect(verifySession('other', token, NOW)).toBeNull()
  })
  it('rejects an expired token', () => {
    const token = createSession(SECRET, UID, NOW)
    expect(verifySession(SECRET, token, NOW + 31 * 86_400_000)).toBeNull()
  })
  it('rejects a malformed token', () => {
    expect(verifySession(SECRET, undefined, NOW)).toBeNull()
    expect(verifySession(SECRET, 'a.b', NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run api/_lib/session.test.ts`
Expected: FAIL (verifySession returns boolean / signature mismatch).

- [ ] **Step 3: Implement** — replace the body of `api/_lib/session.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

const THIRTY_DAYS_MS = 30 * 86_400_000

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSession(secret: string, userId: string, now: number = Date.now()): string {
  const payload = `${userId}.${now + THIRTY_DAYS_MS}`
  return `${payload}.${sign(secret, payload)}`
}

export function verifySession(
  secret: string,
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, exp, mac] = parts
  if (!userId || !exp || !mac) return null
  const expected = sign(secret, `${userId}.${exp}`)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(exp) <= now) return null
  return userId
}
```

(`checkPassword` is intentionally removed.)

- [ ] **Step 4: Run tests** — `npx vitest run api/_lib/session.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add api/_lib/session.ts api/_lib/session.test.ts && git commit -m "feat(auth): session token carries userId (STU-NNN)"`

---

### Task 2: users table migration + users-repo

**Files:**
- Create: `migrations/003_users.sql`
- Create: `api/_lib/users-repo.ts`

**Interfaces:**
- Produces: `User = { id: string; googleSub: string | null; email: string; name: string | null; zernioAccountId: string | null }`; `upsertUserByEmail(email: string, googleSub: string, name: string | null): Promise<User>`; `getUserById(id: string): Promise<User | null>`.

No unit test: repos are thin SQL wrappers (matching `posts-repo`/`slots-repo`, which have none); their behavior is exercised through the callback in Task 5 and `me` in Task 6.

- [ ] **Step 1: Create the migration** `migrations/003_users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub         text UNIQUE,
  email              text UNIQUE NOT NULL,
  name               text,
  zernio_api_key_enc text,
  zernio_account_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (email, name) VALUES ('jens@studiomanfred.com', 'Jens')
  ON CONFLICT (email) DO NOTHING;
```

- [ ] **Step 2: Create `api/_lib/users-repo.ts`:**

```ts
import { sql } from './db.js'

export interface User {
  id: string
  googleSub: string | null
  email: string
  name: string | null
  zernioAccountId: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToUser(r: any): User {
  return {
    id: r.id,
    googleSub: r.google_sub ?? null,
    email: r.email,
    name: r.name ?? null,
    zernioAccountId: r.zernio_account_id ?? null,
  }
}

export async function upsertUserByEmail(
  email: string,
  googleSub: string,
  name: string | null,
): Promise<User> {
  const rows = (await sql()`
    INSERT INTO users (email, google_sub, name)
    VALUES (${email}, ${googleSub}, ${name})
    ON CONFLICT (email) DO UPDATE
      SET google_sub = EXCLUDED.google_sub,
          name = COALESCE(EXCLUDED.name, users.name),
          updated_at = now()
    RETURNING *`) as any[]
  return rowToUser(rows[0])
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = (await sql()`SELECT * FROM users WHERE id = ${id}`) as any[]
  return rows[0] ? rowToUser(rows[0]) : null
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck:api` → clean.

- [ ] **Step 4: Commit** — `git add migrations/003_users.sql api/_lib/users-repo.ts && git commit -m "feat(auth): users table + users-repo (STU-NNN)"`

(The migration runs against Neon via `npm run migrate` during deploy — noted in Task 8.)

---

### Task 3: Google OAuth pure helpers

**Files:**
- Create: `api/_lib/google-oauth.ts`
- Test: `api/_lib/google-oauth.test.ts`

**Interfaces:**
- Produces: `parseCsv(v?: string): string[]`; `randomToken(bytes?: number): string`; `pkceChallenge(verifier: string): string`; `buildAuthUrl(p: { clientId; redirectUri; state; codeChallenge }): string`; `parseIdToken(idToken: string): IdTokenClaims`; `validateClaims(c: IdTokenClaims, clientId: string, now: number): boolean`; `isAllowedIdentity(c: IdTokenClaims, opts: { allowedDomains: string[]; allowedEmails?: string[] }): boolean`; `exchangeCode(p): Promise<{ id_token: string }>`.
- `IdTokenClaims = { email?; email_verified?; hd?; sub?; name?; aud?; iss?; exp? }` (exp in seconds).

- [ ] **Step 1: Write the failing tests** `api/_lib/google-oauth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseCsv, pkceChallenge, buildAuthUrl, parseIdToken, validateClaims, isAllowedIdentity,
} from './google-oauth.js'

const CLIENT = 'client-123.apps.googleusercontent.com'
const NOW = Date.parse('2026-07-15T09:00:00.000Z')

function jwt(claims: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

describe('google-oauth helpers', () => {
  it('parseCsv trims and drops blanks', () => {
    expect(parseCsv(' a.com, b.se ,')).toEqual(['a.com', 'b.se'])
    expect(parseCsv(undefined)).toEqual([])
  })
  it('pkceChallenge is the S256 of the verifier (RFC 7636 example)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('buildAuthUrl includes required params', () => {
    const url = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: 'https://x/cb', state: 's', codeChallenge: 'c' }))
    expect(url.searchParams.get('client_id')).toBe(CLIENT)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
  })
  it('parseIdToken decodes the payload', () => {
    expect(parseIdToken(jwt({ email: 'a@b.com' })).email).toBe('a@b.com')
    expect(() => parseIdToken('nope')).toThrow()
  })
  it('validateClaims checks iss/aud/exp', () => {
    const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: NOW / 1000 + 60 }
    expect(validateClaims(good, CLIENT, NOW)).toBe(true)
    expect(validateClaims({ ...good, aud: 'other' }, CLIENT, NOW)).toBe(false)
    expect(validateClaims({ ...good, exp: NOW / 1000 - 1 }, CLIENT, NOW)).toBe(false)
    expect(validateClaims({ ...good, iss: 'evil' }, CLIENT, NOW)).toBe(false)
  })
  it('isAllowedIdentity enforces verified email + domain + optional override', () => {
    const opts = { allowedDomains: ['studiomanfred.com'] }
    expect(isAllowedIdentity({ email: 'j@studiomanfred.com', email_verified: true }, opts)).toBe(true)
    expect(isAllowedIdentity({ email: 'j@evil.com', email_verified: true }, opts)).toBe(false)
    expect(isAllowedIdentity({ email: 'j@studiomanfred.com', email_verified: false }, opts)).toBe(false)
    expect(isAllowedIdentity(
      { email: 'x@studiomanfred.com', email_verified: true },
      { allowedDomains: ['studiomanfred.com'], allowedEmails: ['jens@studiomanfred.com'] },
    )).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run api/_lib/google-oauth.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `api/_lib/google-oauth.ts`:**

```ts
import { createHash, randomBytes } from 'node:crypto'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

export interface IdTokenClaims {
  email?: string; email_verified?: boolean; hd?: string
  sub?: string; name?: string; aud?: string; iss?: string; exp?: number
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

export function parseCsv(v?: string): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}
export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest())
}

export function buildAuthUrl(p: {
  clientId: string; redirectUri: string; state: string; codeChallenge: string
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  })
  return `${AUTH_ENDPOINT}?${q.toString()}`
}

export function parseIdToken(idToken: string): IdTokenClaims {
  const seg = idToken.split('.')[1]
  if (!seg) throw new Error('malformed id_token')
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as IdTokenClaims
}

export function validateClaims(c: IdTokenClaims, clientId: string, now: number): boolean {
  if (!c.iss || !VALID_ISSUERS.includes(c.iss)) return false
  if (c.aud !== clientId) return false
  if (!c.exp || c.exp * 1000 <= now) return false
  return true
}

export function isAllowedIdentity(
  c: IdTokenClaims,
  opts: { allowedDomains: string[]; allowedEmails?: string[] },
): boolean {
  if (!c.email || c.email_verified !== true) return false
  const email = c.email.toLowerCase()
  if (opts.allowedEmails && opts.allowedEmails.length > 0) {
    if (!opts.allowedEmails.map((e) => e.toLowerCase()).includes(email)) return false
  }
  const domain = email.split('@')[1]
  if (!domain) return false
  return opts.allowedDomains.map((d) => d.toLowerCase()).includes(domain)
}

export async function exchangeCode(p: {
  code: string; clientId: string; clientSecret: string; redirectUri: string; codeVerifier: string
}): Promise<{ id_token: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      code_verifier: p.codeVerifier,
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  return (await res.json()) as { id_token: string }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run api/_lib/google-oauth.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add api/_lib/google-oauth.ts api/_lib/google-oauth.test.ts && git commit -m "feat(auth): google oauth helpers (STU-NNN)"`

---

### Task 4: `/api/auth/google/start` route

**Files:**
- Create: `api/auth/google/start.ts`
- Modify: `api/_lib/http.ts` (add short-lived flow cookies helper)

**Interfaces:**
- Consumes: `buildAuthUrl`, `randomToken`, `pkceChallenge` (Task 3).
- Produces: sets two HttpOnly cookies `oauth_state` and `oauth_verifier` (Max-Age 600, SameSite=Lax, Secure, Path=/); 302 to Google.

- [ ] **Step 1: Add a flow-cookie helper to `api/_lib/http.ts`** (append):

```ts
export const FLOW_COOKIE = (name: string, value: string) =>
  `${name}=${value}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`
export const CLEAR_FLOW_COOKIE = (name: string) =>
  `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`
```

- [ ] **Step 2: Create `api/auth/google/start.ts`:**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, sendJson, FLOW_COOKIE } from '../../_lib/http.js'
import { buildAuthUrl, pkceChallenge, randomToken } from '../../_lib/google-oauth.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.APP_URL
  if (!clientId || !appUrl) return sendJson(res, 500, { error: 'oauth not configured' })

  const state = randomToken()
  const verifier = randomToken()
  const url = buildAuthUrl({
    clientId,
    redirectUri: `${appUrl}/api/auth/google/callback`,
    state,
    codeChallenge: pkceChallenge(verifier),
  })
  res.setHeader('Set-Cookie', [FLOW_COOKIE('oauth_state', state), FLOW_COOKIE('oauth_verifier', verifier)])
  res.writeHead(302, { Location: url }).end()
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck:api` → clean.

- [ ] **Step 4: Commit** — `git add api/auth/google/start.ts api/_lib/http.ts && git commit -m "feat(auth): google oauth start route (STU-NNN)"`

---

### Task 5: `/api/auth/google/callback` route

**Files:**
- Create: `api/auth/google/callback.ts`

**Interfaces:**
- Consumes: `readCookie`, `SESSION_COOKIE`, `CLEAR_FLOW_COOKIE` (http.ts); `exchangeCode`, `parseIdToken`, `validateClaims`, `isAllowedIdentity`, `parseCsv` (Task 3); `createSession` (Task 1); `upsertUserByEmail` (Task 2).
- Behavior: verify `state` vs cookie; exchange `code`; validate + allow-check claims; upsert user; set session cookie; clear flow cookies; 302 to `/`. Any failure → 302 to `/login?error=<reason>` (never leak details).

- [ ] **Step 1: Create `api/auth/google/callback.ts`:**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, readCookie, SESSION_COOKIE, CLEAR_FLOW_COOKIE } from '../../_lib/http.js'
import { createSession } from '../../_lib/session.js'
import { upsertUserByEmail } from '../../_lib/users-repo.js'
import {
  exchangeCode, parseIdToken, validateClaims, isAllowedIdentity, parseCsv,
} from '../../_lib/google-oauth.js'

function fail(res: VercelResponse, reason: string) {
  res.setHeader('Set-Cookie', [CLEAR_FLOW_COOKIE('oauth_state'), CLEAR_FLOW_COOKIE('oauth_verifier')])
  res.writeHead(302, { Location: `/login?error=${reason}` }).end()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.APP_URL
  const secret = process.env.SESSION_SECRET
  if (!clientId || !clientSecret || !appUrl || !secret) return fail(res, 'config')

  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const cookieState = readCookie(req, 'oauth_state')
  const verifier = readCookie(req, 'oauth_verifier')
  if (!code || !state || !cookieState || state !== cookieState || !verifier) return fail(res, 'state')

  try {
    const { id_token } = await exchangeCode({
      code, clientId, clientSecret,
      redirectUri: `${appUrl}/api/auth/google/callback`,
      codeVerifier: verifier,
    })
    const claims = parseIdToken(id_token)
    if (!validateClaims(claims, clientId, Date.now())) return fail(res, 'token')
    if (!isAllowedIdentity(claims, {
      allowedDomains: parseCsv(process.env.ALLOWED_DOMAINS),
      allowedEmails: parseCsv(process.env.ALLOWED_EMAILS),
    })) return fail(res, 'not_allowed')

    const user = await upsertUserByEmail(claims.email!.toLowerCase(), claims.sub!, claims.name ?? null)
    res.setHeader('Set-Cookie', [
      SESSION_COOKIE(createSession(secret, user.id)),
      CLEAR_FLOW_COOKIE('oauth_state'),
      CLEAR_FLOW_COOKIE('oauth_verifier'),
    ])
    res.writeHead(302, { Location: '/' }).end()
  } catch {
    return fail(res, 'exchange')
  }
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck:api` → clean.

- [ ] **Step 3: Commit** — `git add api/auth/google/callback.ts && git commit -m "feat(auth): google oauth callback route (STU-NNN)"`

---

### Task 6: `requireUser`, identity `me`, remove password login

**Files:**
- Modify: `api/_lib/http.ts` (add `requireUser`; keep `requireAuth` working)
- Modify: `api/auth/me.ts`
- Delete: `api/auth/login.ts`

**Interfaces:**
- Produces: `requireUser(req, res): string | null` (sends 401 + returns null when unauthenticated). `requireAuth` stays a boolean gate for the not-yet-scoped routes (internally `verifySession(...) !== null`). `GET /api/auth/me` → `200 { email, name, linkedinConnected }` or 401.

- [ ] **Step 1: Update `api/_lib/http.ts`** — make `requireAuth` use the new return type and add `requireUser`:

```ts
export function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.SESSION_SECRET
  if (!secret || verifySession(secret, readCookie(req, 'session')) === null) {
    sendJson(res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}

export function requireUser(req: VercelRequest, res: VercelResponse): string | null {
  const secret = process.env.SESSION_SECRET
  const userId = secret ? verifySession(secret, readCookie(req, 'session')) : null
  if (!userId) {
    sendJson(res, 401, { error: 'unauthorized' })
    return null
  }
  return userId
}
```

- [ ] **Step 2: Rewrite `api/auth/me.ts`:**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson, CLEAR_COOKIE } from '../_lib/http.js'
import { getUserById } from '../_lib/users-repo.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  const userId = requireUser(req, res)
  if (!userId) return
  const user = await getUserById(userId)
  if (!user) {
    res.setHeader('Set-Cookie', CLEAR_COOKIE)
    return sendJson(res, 401, { error: 'unknown user' })
  }
  return sendJson(res, 200, {
    email: user.email,
    name: user.name,
    linkedinConnected: Boolean(user.zernioAccountId),
  })
}
```

- [ ] **Step 3: Delete password login** — `git rm api/auth/login.ts`.

- [ ] **Step 4: Typecheck** — `npm run typecheck:api` → clean (confirm nothing else imports `checkPassword` or `login`).

- [ ] **Step 5: Commit** — `git add -A api/_lib/http.ts api/auth/me.ts && git commit -m "feat(auth): requireUser + identity me, drop password login (STU-NNN)"`

---

### Task 7: Frontend — Google sign-in

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/screens/LoginScreen.tsx`
- Modify: `src/screens/LoginScreen.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `api.me(): Promise<{ email: string; name: string | null; linkedinConnected: boolean } | null>`; `api.login` removed; `api.logout` unchanged. LoginScreen renders a link/button to `/api/auth/google/start`.

- [ ] **Step 1: Update `src/api/client.ts`** — replace `me()` and remove `login()`:

```ts
export interface Me { email: string; name: string | null; linkedinConnected: boolean }
// in the api object:
async me(): Promise<Me | null> {
  const res = await fetch('/api/auth/me')
  return res.ok ? ((await res.json()) as Me) : null
},
async logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' })
},
```
(Delete the `login(password)` method.)

- [ ] **Step 2: Update `LoginScreen.test.tsx`** to assert the accessible Google control and drop password assertions:

```tsx
import { render, screen } from '@testing-library/react'
import { LoginScreen } from './LoginScreen'

it('offers an accessible Google sign-in link', () => {
  render(<LoginScreen />)
  const link = screen.getByRole('link', { name: /sign in with google/i })
  expect(link).toHaveAttribute('href', '/api/auth/google/start')
})
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/screens/LoginScreen.test.tsx` → FAIL.

- [ ] **Step 4: Rewrite `src/screens/LoginScreen.tsx`** — replace the password form with a plain link (a full-page navigation, not `fetch`), keeping the existing page shell/design-system styling. Read an optional `?error=` query param and show a friendly message. Minimal shape:

```tsx
export function LoginScreen() {
  const error = new URLSearchParams(window.location.search).get('error')
  return (
    <main className="…existing centered card classes…">
      <h1>…app title…</h1>
      {error && <p role="alert">Sign-in failed. Please try again.</p>}
      <a href="/api/auth/google/start" className="…button classes…">Sign in with Google</a>
    </main>
  )
}
```
Drop the `onSuccess` prop and the password state.

- [ ] **Step 5: Update `src/App.tsx`** — replace `const [authed, setAuthed] = useState<boolean|null>` with the identity object; render `<LoginScreen />` (no `onSuccess`) when `me` is null:

```tsx
const [me, setMe] = useState<Me | null | undefined>(undefined) // undefined = loading
useEffect(() => { api.me().then(setMe) }, [])
// … if (me === undefined) return <Spinner/>; if (!me) return <LoginScreen />
```
Keep the existing routes; the "connect LinkedIn" nudge on `me.linkedinConnected === false` is deferred to PR3 (the flag is available now).

- [ ] **Step 6: Run the full suite + coverage gate**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run test:coverage && npm run coverage:check`
Expected: all tests PASS (App.tsx has no unit test — it's covered by the E2E suite); typecheck/lint clean; ratchet PASS (all four metrics within 0.5pp — if a metric dips because the password branch is gone, add/adjust a `src/` test rather than lowering the baseline).

- [ ] **Step 7: Commit** — `git add src/ && git commit -m "feat(auth): google sign-in on the frontend (STU-NNN)"`

---

### Task 8: Env, provisioning, docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`, `CHANGELOG.md`, `knowledge/ERRORS.md` (if a gotcha surfaces), `MEMORY.md`

- [ ] **Step 1: Update `.env.example`** — remove `APP_PASSWORD`; add:

```
# Google OAuth (Google Cloud Console → APIs & Services → Credentials → OAuth client ID, type "Web application")
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Public base URL, used to build the OAuth redirect URI. e.g. https://manfred-schedule-linkedin.vercel.app
APP_URL=
# Comma-separated allowed email domains for signup (PR1: studiomanfred.com only)
ALLOWED_DOMAINS=studiomanfred.com
# Optional: narrow to exact emails during rollout (comma-separated); leave blank normally
ALLOWED_EMAILS=
```

- [ ] **Step 2: Google Cloud provisioning (manual, do once before deploy)** — record in the PR description:
  1. Create an OAuth client ID (Web application).
  2. Authorized redirect URI: `${APP_URL}/api/auth/google/callback` (prod URL) and `http://localhost:5173/api/auth/google/callback` for local if testing.
  3. OAuth consent screen: External, scopes `openid email profile`; add the three users as test users while unverified.
  4. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `APP_URL` / `ALLOWED_DOMAINS` in Vercel project env (Production + Preview). Remove `APP_PASSWORD`.
  5. Run the migration against prod Neon: `npm run migrate` (creates `users`, seeds jens).

- [ ] **Step 3: Docs** — `README.md` auth section (Google sign-in, allowlist, env); `CHANGELOG.md` `[Unreleased] › Changed`:
  `- Auth: replaced the shared password with Google sign-in; sessions now carry a user identity (foundation for per-user schedules). (STU-NNN)`

- [ ] **Step 4: Commit** — `git add -A && git commit -m "docs(auth): env + README + changelog for Google sign-in (STU-NNN)"`

---

## Delivery

Open the PR (`Closes STU-NNN`), fill the template (Test plan: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run coverage:check`, `npm run build`; note real Google OAuth is verified manually on the preview deploy since it can't be E2E'd). Merge when CI is green; run the migration + set env before/at deploy per Task 8. **Do not add david/moa's domains yet** — that's PR3.

## Self-review notes (author)

- **Spec coverage:** §5 session identity (T1), users table (T2), OAuth start/callback + helpers + allowlist (T3–T5), requireUser + me identity + remove password (T6), frontend Google button (T7), env/provisioning/docs (T8). `crypto.ts` intentionally deferred to PR3 (not used in PR1). Repos/posts/slots untouched per §9 PR1.
- **Auth safety:** ID token trusted because it comes directly from Google's token endpoint over TLS with our client secret; we still validate `iss`/`aud`/`exp` + `email_verified` + allowlist. Full JWKS signature verification is unnecessary for the server-side code exchange and is out of scope.
- **Coverage:** api/** isn't measured; only the `src/**` LoginScreen/client/App changes can move the ratchet — Task 7 Step 6 gates on it.
