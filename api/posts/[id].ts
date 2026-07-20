import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from '../_lib/http'
import { validatePostInput } from '../_lib/validate'
import { recomputeQueueLive } from '../_lib/reschedule'
import * as posts from '../_lib/posts-repo'
import * as slots from '../_lib/slots-repo'

const EDITABLE = new Set(['draft', 'queued', 'failed', 'missed'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'PATCH', 'DELETE')) return
  if (!requireAuth(req, res)) return
  const id = String(req.query.id)
  const existing = await posts.getPost(id)
  if (!existing) return sendJson(res, 404, { error: 'not found' })

  if (req.method === 'DELETE') {
    await posts.deletePost(id)
    await recomputeQueueLive()
    return res.status(204).end()
  }

  if (!EDITABLE.has(existing.status)) return sendJson(res, 409, { error: `cannot edit a ${existing.status} post` })

  const merged = { body: req.body?.body ?? existing.body, images: req.body?.images ?? existing.images }
  const valid = validatePostInput(merged)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })

  const action = req.body?.action as 'draft' | 'queue' | 'pin' | undefined
  let patch: Parameters<typeof posts.updatePost>[1] = { body: valid.value.body, images: valid.value.images }
  if (action === 'pin') {
    const at = new Date(req.body?.scheduledAt ?? NaN)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
      return sendJson(res, 422, { error: 'pin requires a future scheduledAt' })
    patch = { ...patch, status: 'queued', pinned: true, position: null, scheduledAt: at, attempts: 0, error: null }
  } else if (action === 'queue') {
    if ((await slots.listSlots()).length === 0)
      return sendJson(res, 422, { error: 'no posting slots configured — add slots in Settings or pin a time' })
    patch = {
      ...patch,
      status: 'queued',
      pinned: false,
      position: existing.status === 'queued' && !existing.pinned ? existing.position : await posts.nextPosition(),
      attempts: 0,
      error: null,
    }
  } else if (action === 'draft') {
    patch = { ...patch, status: 'draft', pinned: false, position: null, scheduledAt: null }
  }

  const updated = await posts.updatePost(id, patch)
  await recomputeQueueLive()
  return sendJson(res, 200, { post: (await posts.getPost(id)) ?? updated })
}
