import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../../_lib/http'
import { recomputeQueueLive } from '../../_lib/reschedule'
import * as posts from '../../_lib/posts-repo'
import * as slots from '../../_lib/slots-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  if (!requireAuth(req, res)) return
  const id = String(req.query.id)
  const post = await posts.getPost(id)
  if (!post) return sendJson(res, 404, { error: 'not found' })
  if (post.status !== 'failed' && post.status !== 'missed')
    return sendJson(res, 409, { error: `cannot retry a ${post.status} post` })
  if ((await slots.listSlots()).length === 0)
    return sendJson(res, 422, { error: 'no posting slots configured — add slots in Settings or pin a time' })
  await posts.updatePost(id, {
    status: 'queued',
    pinned: false,
    position: await posts.nextPosition(),
    scheduledAt: null,
    attempts: 0,
    error: null,
  })
  await recomputeQueueLive()
  return sendJson(res, 200, { post: await posts.getPost(id) })
}
