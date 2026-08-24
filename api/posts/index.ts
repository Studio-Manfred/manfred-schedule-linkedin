import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson } from '../_lib/http.js'
import { validatePostInput } from '../_lib/validate.js'
import { recomputeQueueLive } from '../_lib/reschedule.js'
import * as posts from '../_lib/posts-repo.js'
import * as slots from '../_lib/slots-repo.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'POST')) return
  const userId = requireUser(req, res)
  if (!userId) return

  if (req.method === 'GET') {
    return sendJson(res, 200, { posts: await posts.listPosts(userId) })
  }

  const valid = validatePostInput(req.body)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })
  const action = req.body?.action as 'draft' | 'queue' | 'pin' | undefined

  if (action === 'pin') {
    const at = new Date(req.body?.scheduledAt ?? NaN)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
      return sendJson(res, 422, { error: 'pin requires a future scheduledAt' })
    const post = await posts.insertPost(userId, { ...valid.value, status: 'queued', pinned: true, position: null, scheduledAt: at })
    await recomputeQueueLive(userId) // pinned post may displace dealt slots
    return sendJson(res, 201, { post: (await posts.getPost(userId, post.id)) ?? post })
  }

  if (action === 'queue') {
    if ((await slots.listSlots(userId)).length === 0)
      return sendJson(res, 422, { error: 'no posting slots configured — add slots in Settings or pin a time' })
    const position = await posts.nextPosition(userId)
    const post = await posts.insertPost(userId, { ...valid.value, status: 'queued', pinned: false, position, scheduledAt: null })
    await recomputeQueueLive(userId)
    return sendJson(res, 201, { post: (await posts.getPost(userId, post.id)) ?? post })
  }

  const post = await posts.insertPost(userId, { ...valid.value, status: 'draft', pinned: false, position: null, scheduledAt: null })
  return sendJson(res, 201, { post })
}
