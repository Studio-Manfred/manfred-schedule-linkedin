import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CLEAR_COOKIE, methodIs } from '../_lib/http'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  res.setHeader('Set-Cookie', CLEAR_COOKIE)
  res.status(204).end()
}
