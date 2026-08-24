import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson } from './_lib/http.js'
import { validateSlots } from './_lib/validate.js'
import { recomputeQueueLive } from './_lib/reschedule.js'
import * as slots from './_lib/slots-repo.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'PUT')) return
  const userId = requireUser(req, res)
  if (!userId) return
  if (req.method === 'GET') return sendJson(res, 200, { slots: await slots.listSlots(userId) })
  const valid = validateSlots(req.body?.slots)
  if (!valid.ok) return sendJson(res, 422, { error: valid.error })
  const saved = await slots.replaceSlots(userId, valid.value)
  await recomputeQueueLive(userId)
  return sendJson(res, 200, { slots: saved })
}
