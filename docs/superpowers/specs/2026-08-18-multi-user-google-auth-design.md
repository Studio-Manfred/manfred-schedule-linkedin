# Multi-user Google auth + per-user LinkedIn schedules — design

**Status:** approved (spec reviewed 2026-08-18; ready for implementation planning — PR1 first)
**Author:** Jens Wedin + Claude
**Related:** supersedes the single-user assumption in `2026-07-20-linkedin-scheduler-design.md`

## 1. Problem & goal

The app is single-user by construction: one `APP_PASSWORD`, a session cookie that
proves only "someone knew the password," `posts`/`schedule_slots` with no owner column,
and one LinkedIn account hardcoded via `ZERNIO_ACCOUNT_ID`. We want **three named people**
— `jens@studiomanfred.com`, `david@seventyoneconsulting.se`, `moa@matherstudio.se` — to
each **sign in with Google** and run **their own** LinkedIn schedule, with no data shared
between them and no collaboration.

**Non-goals (this round):** teams/collaboration, roles/permissions beyond "owner of my
own data," billing/subscriptions in-app, open public signup, company-page posting
(personal profile only, unchanged), password login (removed).

## 2. Key decisions (approved)

1. **Auth:** Google OAuth **replaces** the password entirely. No password fallback.
2. **Signup gate:** **domain** allowlist (env `ALLOWED_DOMAINS`) — anyone with a verified
   Google account at an allowed domain may sign up. Target domains:
   `studiomanfred.com`, `seventyoneconsulting.se`, `matherstudio.se`. **Rollout safety:** the
   env value is set to **`studiomanfred.com` only** through PR1–PR2, and the other two
   domains are added in PR3 (see §9) once per-user data isolation *and* per-user publishing
   are live — so david/moa can't log into an unscoped app. (During PR1 the repos are still
   global, so in principle another `studiomanfred.com` account could see jens' data in that
   short window; the org is effectively just jens, and PR2 closes it. If we want zero risk,
   set an optional `ALLOWED_EMAILS` narrowing override to jens' exact email for PR1–PR2 and
   drop it in PR3.)
3. **LinkedIn per user:** **each user brings their own Zernio account.** They create a
   free Zernio account, connect their LinkedIn there, mint an API key, and paste it into
   our app. We publish each user's posts with **their** key + `accountId`. This keeps each
   user's single connected account inside their own Zernio free credit → **$0 for the
   operator**, at the cost of a one-time manual onboarding per user.
   - Assumption to validate live when david/moa first onboard: a **free** Zernio account
     can mint an API key and publish to its one connected LinkedIn. The billing docs
     strongly imply yes (the $12/month credit covers ~2 free connected accounts), but we
     confirm with a real connect before trusting it.

## 3. Architecture overview

Three concerns, layered:

```
Google OAuth  ──►  session carries userId  ──►  every route/repo scoped to that user
                                                        │
                                                        ▼
                                       per-user Zernio creds (encrypted) drive publishing
```

Nothing about the queue math, composer, calendar, or Zernio publish mechanics changes in
*kind* — they gain a `user_id` dimension. The publisher's interface
(`ZernioPublisher({ apiKey, accountId })`) is already per-credential, so it is fed
per-user values instead of env values.

## 4. Data model

Split across two migrations so that a column is never `NOT NULL` before the repos that
populate it exist (see §9 sequencing):

**`migrations/003_users.sql`** (lands in PR1):

```sql
CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub             text UNIQUE,               -- Google 'sub' claim, set on first login
  email                  text UNIQUE NOT NULL,
  name                   text,
  zernio_api_key_enc     text,                       -- AES-256-GCM ciphertext, nullable until connected
  zernio_account_id      text,                       -- their LinkedIn SocialAccount id, nullable
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
-- Seed jens so his session + existing data have an owner from the first login.
INSERT INTO users (email, name) VALUES ('jens@studiomanfred.com', 'Jens')
  ON CONFLICT (email) DO NOTHING;
```

**`migrations/004_posts_user_id.sql`** (lands in PR2, together with the repo scoping that
sets `user_id` on every write — so NOT NULL is safe):

```sql
ALTER TABLE posts          ADD COLUMN user_id uuid REFERENCES users(id);
ALTER TABLE schedule_slots ADD COLUMN user_id uuid REFERENCES users(id);

UPDATE posts          SET user_id = (SELECT id FROM users WHERE email = 'jens@studiomanfred.com');
UPDATE schedule_slots SET user_id = (SELECT id FROM users WHERE email = 'jens@studiomanfred.com');

ALTER TABLE posts          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE schedule_slots ALTER COLUMN user_id SET NOT NULL;

-- Keep the existing posts_due_idx (status, scheduled_at) for the cron's global claim;
-- add a per-user read index:
CREATE INDEX posts_user_due_idx ON posts (user_id, status, scheduled_at);
```

Notes:
- jens' existing key stays in env for the transition; his row's `zernio_api_key_enc` is
  populated when he re-connects through the new flow (or a one-off backfill encrypts the
  env key into his row). Until then the cron falls back to env creds **for jens only**
  (see §7) so nothing breaks mid-migration.
- `zernio_api_key_enc` is **encrypted at rest**; the plaintext key never leaves the server
  and is never returned to the client.

## 5. Auth — Google OAuth

### Session carries identity
`api/_lib/session.ts` changes from `exp.mac` to `userId.exp.mac(secret, "userId.exp")`:
- `createSession(secret, userId, now?) → token`
- `verifySession(secret, token, now?) → userId | null` (was `boolean`)
- `checkPassword` is **deleted**.

`api/_lib/http.ts`:
- `requireAuth` → **`requireUser(req, res): string | null`** — returns the `userId` or
  sends 401. Every protected route uses the returned id.
- Session cookie attributes unchanged (`HttpOnly; Secure; SameSite=Lax; Max-Age=30d`).

### OAuth flow (authorization code + PKCE)
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (for the redirect URI),
  `ALLOWED_DOMAINS` (comma-separated email domains), `CRED_ENC_KEY` (32-byte base64,
  see §6). Optional `ALLOWED_EMAILS` narrowing override (used only during the PR1–PR2
  rollout window per §2).
- `GET /api/auth/google/start` — generate `state` + PKCE `code_verifier`; store both in
  short-lived signed, HttpOnly cookies; 302 to Google's consent URL
  (`scope=openid email profile`).
- `GET /api/auth/google/callback` — verify `state`; exchange `code` + `code_verifier` at
  Google's token endpoint; verify the `id_token` (issuer, audience = our client id,
  expiry) and read `email`, `email_verified`, `hd`, `sub`, `name`; **reject unless
  `email_verified` is true AND the email's domain is in `ALLOWED_DOMAINS`** (use the `hd`
  hosted-domain claim as corroboration when present; also reject if an `ALLOWED_EMAILS`
  override is set and the email isn't in it); upsert the `users` row by `google_sub` (fall
  back to `email` on first login); set the session cookie with the user's id; 302 to `/`.
- Delete `api/auth/login.ts`; drop `APP_PASSWORD`. `logout.ts` unchanged.
- `api/auth/me.ts` → returns `{ email, name, linkedinConnected: boolean }` (was 204) so the
  header can show who's signed in and whether they still need to connect LinkedIn.

### Frontend
- `LoginScreen` replaces the password form with a **"Sign in with Google"** button that
  links to `/api/auth/google/start` (a plain link/redirect — no fetch).
- `src/api/client.ts` keeps its 401 → `/login` redirect; `api.me()` returns the identity
  object; `api.login(password)` is removed.
- `App.tsx` still gates on `api.me()`; the "connect LinkedIn" nudge appears when
  `linkedinConnected === false`.

## 6. Per-user Zernio credentials

- **Encryption:** `api/_lib/crypto.ts` — `encrypt(plain) → string`, `decrypt(enc) → string`
  using AES-256-GCM with a 32-byte key from `CRED_ENC_KEY` (random `iv` per value, stored
  with the ciphertext). Round-trip + tamper-detection unit-tested.
- **Connect flow (MVP: paste key):** new `api/connection.ts` behavior, per user:
  - `POST /api/connection` `{ apiKey }` → server calls Zernio `GET /v1/accounts` with the
    key, returns the LinkedIn account(s) for the user to confirm (auto-select if one).
  - `POST /api/connection` `{ apiKey, accountId }` → store `encrypt(apiKey)` +
    `accountId` on the user row.
  - `GET /api/connection` → decrypt the user's key, call Zernio, return
    `{ connected, accountName }` (per-user; replaces today's env-based check).
  - `DELETE /api/connection` → clear the user's stored creds (disconnect).
- A **Settings → Connect LinkedIn** panel walks the user through: create a Zernio account →
  connect LinkedIn → Settings → API Keys → paste the key here.
- *Later polish (out of scope now):* drive Zernio's own `GET /v1/connect/linkedin` flow so
  it's a one-click button instead of a paste. Same storage, nicer UX.

## 7. Publishing (cron) — per user

`api/cron/publish.ts` + `api/_lib/publish-tick.ts`:
- `claimDuePosts(now)` returns due posts **with `user_id`** across all users (still a
  single atomic claim).
- The tick **groups claimed posts by user**, and for each user resolves a publisher from
  **their** decrypted `zernio_api_key_enc` + `zernio_account_id`.
- A user with **no connected creds** → their claimed posts are **released back to
  `queued`** (not counted as an attempt) and surfaced in the UI as "connect LinkedIn to
  publish." They are never marked failed for a missing connection.
- **Transition fallback:** if a user has no stored creds but is jens (or: env creds exist
  and the post's user is the env-seeded user), fall back to `ZERNIO_API_KEY`/
  `ZERNIO_ACCOUNT_ID` so jens keeps publishing until he re-connects. Removed once jens has
  connected through the new flow.
- `runPublishTick` stays dependency-injected; the new work is a `resolvePublisher(userId)`
  dep (returns a publisher or `null`), keeping the tick unit-testable without a DB.
- Cadence unchanged (`*/30 * * * *`, per STU-686).

## 8. Repos & routes — scoping

Every `posts-repo` / `slots-repo` function gains a `userId` and scopes its SQL by it:
- Reads scoped: `listPosts(userId, statuses?)`, `getPost(userId, id)` (`AND user_id = …`),
  `listSlots(userId)`, `nextPosition(userId)`, `listQueuedUnpinnedIds(userId)`,
  `listPinnedFutureTimes(userId, now)`.
- Writes scoped: `insertPost(userId, …)`, `updatePost(userId, id, …)` and
  `deletePost(userId, id)` **must** include `AND user_id = ${userId}` in the WHERE — this
  is the IDOR guard so one user can't read/mutate another's post by id.
- `saveSchedule` / `setPositions` scope their `UPDATE … WHERE id = … AND user_id = …`.
- `claimDuePosts`/`sweepStuck` stay global reads for the cron (they carry `user_id`
  through); they are **not** exposed to user routes.
- `recomputeQueueLive(userId)` recomputes one user's queue.
- Each `/api/*` handler calls `requireUser`, then passes the id into the repo calls. Routes
  touched: `posts/index`, `posts/[id]`, `posts/[id]/retry`, `posts/reorder`, `slots`,
  `images`, `connection`.

## 9. Delivery — three sequenced PRs (main shippable throughout)

The allowlist stays **jens-only** until PR3 ships, so the app is never live for
david/moa while any tenant-scoping or per-user-publishing piece is unfinished.

- **PR1 — Auth & identity foundation.** Migration `003` (users table + seed jens only —
  **no `posts`/`slots` changes yet**); session carries `userId`; `crypto.ts`; Google OAuth
  start/callback; `ALLOWED_DOMAINS` = `studiomanfred.com` only (optionally narrowed to
  jens' email via `ALLOWED_EMAILS`); `me` returns identity; LoginScreen → Google button;
  remove password. Repos and publishing untouched — **safe because only jens
  exists** and `posts`/`slots` are unchanged.
- **PR2 — Tenant scoping.** Migration `004` (add `user_id`, backfill jens, NOT NULL) **in
  the same PR as** threading `user_id` through every repo + route — so `NOT NULL` is never
  live before writes populate it. Ownership guards on get/update/delete; per-user slots +
  reschedule; `claimDuePosts` carries `user_id`. **Publishing still env-based** (only jens
  active), so no per-user creds needed yet.
- **PR3 — Per-user LinkedIn.** Encrypted per-user Zernio creds; connect onboarding
  (`connection.ts` + Settings panel); per-user cron publishing with the env fallback for
  jens; drop the fallback once jens re-connects. **Then expand `ALLOWED_DOMAINS` to add
  `seventyoneconsulting.se` + `matherstudio.se`** (and drop any `ALLOWED_EMAILS` override).

Each PR follows the repo rhythm (Linear `STU-NNN` → branch → TDD → CI → squash-merge →
deploy). This spec is the umbrella; `writing-plans` turns it into the per-PR task lists.

## 10. Testing

- **session.ts:** round-trip `createSession`/`verifySession` encodes+recovers `userId`;
  tamper (wrong mac) → null; expired → null; wrong-secret → null.
- **crypto.ts:** encrypt→decrypt round-trip; tampered ciphertext → throws; distinct `iv`
  per call.
- **Google callback helpers (pure, extracted):** `isAllowedIdentity` (domain allowlist +
  optional email override + `email_verified`), `verifyState`, `parseIdToken` — allow a
  matching domain, deny a non-listed domain, deny unverified email, honor the
  `ALLOWED_EMAILS` override when set; state mismatch rejected; malformed id_token rejected.
  Google network calls mocked.
- **Repos:** user-scoping guards — `getPost(other, id)` → null; `updatePost`/`deletePost`
  cross-user → no-op/`null`. (Uses the existing repo test approach; a small DB/mock harness
  as needed.)
- **publish-tick:** per-user grouping via injected `resolvePublisher`; user without creds
  → posts released to `queued`, not failed; each user's posts publish with their own
  publisher; env fallback path covered.
- **E2E/a11y:** LoginScreen shows an accessible "Sign in with Google" control and the
  401→/login gate holds. Real Google OAuth is not E2E'd; the callback is covered by unit
  tests with a mocked token exchange.
- Clock stays frozen in `test/setup.ts` (STU-687); coverage ratchet applies.

## 11. Security notes

- Per-user Zernio API keys: AES-256-GCM at rest, server-only, never serialized to the
  client, cleared on disconnect.
- IDOR: all per-user reads/writes carry `AND user_id = …`; ids are uuids.
- OAuth: `state` + PKCE, `id_token` issuer/audience/expiry verified, `email_verified`
  required, allowlist enforced; session cookie holds only `userId` (no secrets),
  `HttpOnly; Secure; SameSite=Lax`.
- CSRF: same-site cookie + JSON-only mutations; add a double-submit token if we later relax
  SameSite. (Noted, not required now.)

## 12. Decisions resolved in review (2026-08-18)

1. **Domain allowlist** (`ALLOWED_DOMAINS`), not exact emails — the three company domains.
   Staged env value for rollout safety per §2/§9.
2. **Dedicated `CRED_ENC_KEY`** for encrypting stored Zernio keys (separate from
   `SESSION_SECRET`), so rotating one doesn't invalidate the other.
3. **Onboarding MVP = paste API key.** The one-click Zernio connect flow is deferred to a
   later polish PR.
