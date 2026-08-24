import { createHash, randomBytes } from 'node:crypto'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

export interface IdTokenClaims {
  email?: string; email_verified?: boolean; hd?: string
  sub?: string; name?: string; aud?: string; iss?: string; exp?: number
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

export function parseCsv(v?: string): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}
export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest())
}

export function buildAuthUrl(p: {
  clientId: string; redirectUri: string; state: string; codeChallenge: string
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  })
  return `${AUTH_ENDPOINT}?${q.toString()}`
}

export function parseIdToken(idToken: string): IdTokenClaims {
  const seg = idToken.split('.')[1]
  if (!seg) throw new Error('malformed id_token')
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as IdTokenClaims
}

export function validateClaims(c: IdTokenClaims, clientId: string, now: number): boolean {
  if (!c.iss || !VALID_ISSUERS.includes(c.iss)) return false
  if (c.aud !== clientId) return false
  if (!c.exp || c.exp * 1000 <= now) return false
  return true
}

export function isAllowedIdentity(
  c: IdTokenClaims,
  opts: { allowedDomains: string[]; allowedEmails?: string[] },
): boolean {
  if (!c.email || c.email_verified !== true) return false
  const email = c.email.toLowerCase()
  if (opts.allowedEmails && opts.allowedEmails.length > 0) {
    if (!opts.allowedEmails.map((e) => e.toLowerCase()).includes(email)) return false
  }
  const domain = email.split('@')[1]
  if (!domain) return false
  return opts.allowedDomains.map((d) => d.toLowerCase()).includes(domain)
}

export async function exchangeCode(p: {
  code: string; clientId: string; clientSecret: string; redirectUri: string; codeVerifier: string
}): Promise<{ id_token: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      code_verifier: p.codeVerifier,
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  return (await res.json()) as { id_token: string }
}
