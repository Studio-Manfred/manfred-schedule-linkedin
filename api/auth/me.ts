import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson, CLEAR_COOKIE } from '../_lib/http.js'
import { getUserById } from '../_lib/users-repo.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  const userId = requireUser(req, res)
  if (!userId) return
  const user = await getUserById(userId)
  if (!user) {
    res.setHeader('Set-Cookie', CLEAR_COOKIE)
    return sendJson(res, 401, { error: 'unknown user' })
  }
  return sendJson(res, 200, {
    email: user.email,
    name: user.name,
    linkedinConnected: Boolean(user.zernioAccountId),
  })
}
