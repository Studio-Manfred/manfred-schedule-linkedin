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
