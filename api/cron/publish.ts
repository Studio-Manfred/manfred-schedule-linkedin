import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendJson } from '../_lib/http.js'
import { runPublishTick } from '../_lib/publish-tick.js'
import { resolvePublisher as resolvePublisherWith } from '../_lib/resolve-publisher.js'
import { ZernioPublisher } from '../_lib/publisher.js'
import { getUserById, getZernioCreds } from '../_lib/users-repo.js'
import { decrypt } from '../_lib/crypto.js'
import * as posts from '../_lib/posts-repo.js'

const resolvePublisher = (userId: string) =>
  resolvePublisherWith(userId, {
    getZernioCreds,
    getUserById,
    decrypt,
    makePublisher: (o) => new ZernioPublisher(o),
    env: {
      apiKey: process.env.ZERNIO_API_KEY,
      accountId: process.env.ZERNIO_ACCOUNT_ID,
      fallbackEmail: process.env.ZERNIO_FALLBACK_EMAIL,
    },
  })

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
