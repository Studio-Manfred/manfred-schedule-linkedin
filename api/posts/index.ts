import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../_lib/http'
import { validatePostInput } from '../_lib/validate'
import { recomputeQueueLive } from '../_lib/reschedule'
import * as posts from '../_lib/posts-repo'
import * as slots from '../_lib/slots-repo'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'POST')) return
  if (!requireAuth(req, res)) return

  if (req.method === 'GET') {
    return sendJson(res, 200, { posts: await posts.listPosts() })
  }

  const valid = validatePostInput(req.body)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })
  const action = req.body?.action as 'draft' | 'queue' | 'pin' | undefined

  if (action === 'pin') {
    const at = new Date(req.body?.scheduledAt ?? NaN)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
      return sendJson(res, 422, { error: 'pin requires a future scheduledAt' })
    const post = await posts.insertPost({ ...valid.value, status: 'queued', pinned: true, position: null, scheduledAt: at })
    await recomputeQueueLive() // pinned post may displace dealt slots
    return sendJson(res, 201, { post: (await posts.getPost(post.id)) ?? post })
  }

  if (action === 'queue') {
    if ((await slots.listSlots()).length === 0)
      return sendJson(res, 422, { error: 'no posting slots configured — add slots in Settings or pin a time' })
    const position = await posts.nextPosition()
    const post = await posts.insertPost({ ...valid.value, status: 'queued', pinned: false, position, scheduledAt: null })
    await recomputeQueueLive()
    return sendJson(res, 201, { post: (await posts.getPost(post.id)) ?? post })
  }

  const post = await posts.insertPost({ ...valid.value, status: 'draft', pinned: false, position: null, scheduledAt: null })
  return sendJson(res, 201, { post })
}
