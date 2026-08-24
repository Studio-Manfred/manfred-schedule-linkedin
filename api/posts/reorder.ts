import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson } from '../_lib/http.js'
import { recomputeQueueLive } from '../_lib/reschedule.js'
import * as posts from '../_lib/posts-repo.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  const userId = requireUser(req, res)
  if (!userId) return
  const orderedIds = req.body?.orderedIds
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string'))
    return sendJson(res, 422, { error: 'orderedIds must be a string array' })
  await posts.setPositions(userId, orderedIds)
  await recomputeQueueLive(userId)
  return sendJson(res, 200, { posts: await posts.listPosts(userId) })
}
