import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson } from '../../_lib/http.js'
import { recomputeQueueLive } from '../../_lib/reschedule.js'
import * as posts from '../../_lib/posts-repo.js'
import * as slots from '../../_lib/slots-repo.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  const userId = requireUser(req, res)
  if (!userId) return
  const id = String(req.query.id)
  const post = await posts.getPost(userId, id)
  if (!post) return sendJson(res, 404, { error: 'not found' })
  if (post.status !== 'failed' && post.status !== 'missed')
    return sendJson(res, 409, { error: `cannot retry a ${post.status} post` })
  if ((await slots.listSlots(userId)).length === 0)
    return sendJson(res, 422, { error: 'no posting slots configured — add slots in Settings or pin a time' })
  await posts.updatePost(userId, id, {
    status: 'queued',
    pinned: false,
    position: await posts.nextPosition(userId),
    scheduledAt: null,
    attempts: 0,
    error: null,
  })
  await recomputeQueueLive(userId)
  return sendJson(res, 200, { post: await posts.getPost(userId, id) })
}
