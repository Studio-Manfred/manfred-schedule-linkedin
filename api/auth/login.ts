import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, sendJson, SESSION_COOKIE } from '../_lib/http.js'
import { checkPassword, createSession } from '../_lib/session.js'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  const expected = process.env.APP_PASSWORD
  const secret = process.env.SESSION_SECRET
  if (!expected || !secret) return sendJson(res, 500, { error: 'server not configured' })
  const supplied = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!checkPassword(supplied, expected)) {
    await delay(500) // blunt brute-force damper for a single-user app
    return sendJson(res, 401, { error: 'wrong password' })
  }
  res.setHeader('Set-Cookie', SESSION_COOKIE(createSession(secret)))
  res.status(204).end()
}
