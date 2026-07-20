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
