import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth } from '../_lib/http.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  if (!requireAuth(req, res)) return
  res.status(204).end()
}
