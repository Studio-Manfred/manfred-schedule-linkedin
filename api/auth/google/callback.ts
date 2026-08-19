import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, readCookie, SESSION_COOKIE, CLEAR_FLOW_COOKIE } from '../../_lib/http.js'
import { createSession } from '../../_lib/session.js'
import { upsertUserByEmail } from '../../_lib/users-repo.js'
import {
  exchangeCode, parseIdToken, validateClaims, isAllowedIdentity, parseCsv,
} from '../../_lib/google-oauth.js'

function fail(res: VercelResponse, reason: string) {
  res.setHeader('Set-Cookie', [CLEAR_FLOW_COOKIE('oauth_state'), CLEAR_FLOW_COOKIE('oauth_verifier')])
  res.writeHead(302, { Location: `/login?error=${reason}` }).end()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.APP_URL
  const secret = process.env.SESSION_SECRET
  if (!clientId || !clientSecret || !appUrl || !secret) return fail(res, 'config')

  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const cookieState = readCookie(req, 'oauth_state')
  const verifier = readCookie(req, 'oauth_verifier')
  if (!code || !state || !cookieState || state !== cookieState || !verifier) return fail(res, 'state')

  try {
    const { id_token } = await exchangeCode({
      code, clientId, clientSecret,
      redirectUri: `${appUrl}/api/auth/google/callback`,
      codeVerifier: verifier,
    })
    const claims = parseIdToken(id_token)
    if (!validateClaims(claims, clientId, Date.now())) return fail(res, 'token')
    if (!isAllowedIdentity(claims, {
      allowedDomains: parseCsv(process.env.ALLOWED_DOMAINS),
      allowedEmails: parseCsv(process.env.ALLOWED_EMAILS),
    })) return fail(res, 'not_allowed')

    const user = await upsertUserByEmail(claims.email!.toLowerCase(), claims.sub!, claims.name ?? null)
    res.setHeader('Set-Cookie', [
      SESSION_COOKIE(createSession(secret, user.id)),
      CLEAR_FLOW_COOKIE('oauth_state'),
      CLEAR_FLOW_COOKIE('oauth_verifier'),
    ])
    res.writeHead(302, { Location: '/' }).end()
  } catch {
    return fail(res, 'exchange')
  }
}
