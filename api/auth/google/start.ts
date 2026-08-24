import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, sendJson, FLOW_COOKIE } from '../../_lib/http.js'
import { buildAuthUrl, pkceChallenge, randomToken } from '../../_lib/google-oauth.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.APP_URL
  if (!clientId || !appUrl) return sendJson(res, 500, { error: 'oauth not configured' })

  const state = randomToken()
  const verifier = randomToken()
  const url = buildAuthUrl({
    clientId,
    redirectUri: `${appUrl}/api/auth/google/callback`,
    state,
    codeChallenge: pkceChallenge(verifier),
  })
  res.setHeader('Set-Cookie', [FLOW_COOKIE('oauth_state', state), FLOW_COOKIE('oauth_verifier', verifier)])
  res.writeHead(302, { Location: url }).end()
}
