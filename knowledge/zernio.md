# Zernio — domain notes

Zernio (`https://zernio.com`) is the third-party social-publishing API this app
delegates all actual LinkedIn posting to. We never talk to LinkedIn's API directly and
never hold LinkedIn OAuth tokens ourselves — Zernio holds that connection. Full vendored
reference: `docs/llms-full.txt` (~83k lines, fetched from Zernio's `llms-full.txt`).
Read that file for anything not covered here; don't guess at endpoints or fields.

## Auth

- **Base URL:** `https://zernio.com/api/v1`
- **Header:** `Authorization: Bearer ${ZERNIO_API_KEY}`. One key is enough for the whole
  integration (rate limits scale with connected accounts, not key count).
- The connected LinkedIn account is identified by `ZERNIO_ACCOUNT_ID` — a Zernio
  SocialAccount id, fetched once via `GET /api/v1/accounts` and stored in env.
- If publishing starts failing with auth errors, the fix is in the **Zernio dashboard**
  (reconnect LinkedIn there), not in this app's code or env vars — see
  `README.md` § Operational notes.

## Publishing a post

`POST /v1/posts` with `publishNow: true`, the LinkedIn `accountId`, body text, and
`mediaItems: [{ url, type: 'image', altText }]` for image posts. We never use Zernio's
own scheduling (no `scheduledAt`) — our cron calls this at the moment the post is due,
so our Neon DB stays the single source of truth for timing and queue order.

### Idempotency (`x-request-id`)

Every publish call sends header `x-request-id: <our post uuid>`. Retrying with the same
UUID within ~5 minutes returns the original post (`200` with `existingPost`) instead of
creating a duplicate — this is what makes our atomic-claim-then-call flow safe to retry
after a crash or timeout mid-call.

### 409 — content-hash dedup (treat as success)

Independent of the idempotency key, Zernio also fingerprints
`(platform, accountId, content + media)`. If the *same content* was already published
to the *same account* within the last 24 hours, the call returns **HTTP 409** with an
`existingPostId`. Our publisher treats this as success (stores `existingPostId` in place
of a fresh `zernio_post_id`/`linkedin_url`) rather than as a failure to retry — retrying
a 409 would just get another 409, and the content genuinely is already live.

## Media flow (image posts)

Zernio media isn't uploaded inline with the post — it's a two-step presign flow, done
at *publish time* (not at compose time):

1. `POST /v1/media/presign` → returns `uploadUrl` (presigned, expires in 1 hour) and
   `publicUrl`.
2. `PUT` the image binary (fetched from our Vercel Blob store) to `uploadUrl`.
3. Reference the resulting `publicUrl` in `mediaItems: [{ url: publicUrl, type: 'image', altText }]`
   on the `POST /v1/posts` call.

**Temp-storage caveat:** media uploaded via presign sits in Zernio's *temporary* storage
for **7 days** until a post using it actually publishes, then it's Zernio's problem, not
ours — but it is never our durable copy. Vercel Blob remains the durable image store
from compose time onward; we re-upload to Zernio fresh at publish time rather than
treating a Zernio `publicUrl` as long-lived. Don't cache/reuse a Zernio presigned
`publicUrl` across ticks or across posts.

- LinkedIn via Zernio allows up to 20 images per post; the composer enforces this cap.
- Alt text: Zernio's post-read schema exposes `altText` on media items; create-side
  support for LinkedIn specifically wasn't explicitly documented in the vendored
  reference at the time of writing. We store alt text in our DB regardless and send it
  in `mediaItems` — if it doesn't make it through to LinkedIn, that's a UI-copy
  limitation to surface in the composer, not a reason to drop the field.

## Where this is used in code

- `api/_lib/publisher.ts` — the Zernio client / publish call, behind a small interface
  so a direct LinkedIn API implementation could be swapped in later without touching
  queue logic.
- `api/_lib/publish-tick.ts` — the cron tick: claim → presign/PUT media → call
  `POST /v1/posts` → handle success/409/other-failure.
- `api/cron/publish.ts` — the Vercel Function the cron hits every 5 minutes
  (`*/5 * * * *`, guarded by `CRON_SECRET`).
