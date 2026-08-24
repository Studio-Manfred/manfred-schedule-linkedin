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
