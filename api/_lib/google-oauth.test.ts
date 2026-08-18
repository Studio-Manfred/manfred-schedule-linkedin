import { describe, it, expect } from 'vitest'
import {
  parseCsv, pkceChallenge, buildAuthUrl, parseIdToken, validateClaims, isAllowedIdentity,
} from './google-oauth.js'

const CLIENT = 'client-123.apps.googleusercontent.com'
const NOW = Date.parse('2026-07-15T09:00:00.000Z')

function jwt(claims: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

describe('google-oauth helpers', () => {
  it('parseCsv trims and drops blanks', () => {
    expect(parseCsv(' a.com, b.se ,')).toEqual(['a.com', 'b.se'])
    expect(parseCsv(undefined)).toEqual([])
  })
  it('pkceChallenge is the S256 of the verifier (RFC 7636 example)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('buildAuthUrl includes required params', () => {
    const url = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: 'https://x/cb', state: 's', codeChallenge: 'c' }))
    expect(url.searchParams.get('client_id')).toBe(CLIENT)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
  })
  it('parseIdToken decodes the payload', () => {
    expect(parseIdToken(jwt({ email: 'a@b.com' })).email).toBe('a@b.com')
    expect(() => parseIdToken('nope')).toThrow()
  })
  it('validateClaims checks iss/aud/exp', () => {
    const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: NOW / 1000 + 60 }
    expect(validateClaims(good, CLIENT, NOW)).toBe(true)
    expect(validateClaims({ ...good, aud: 'other' }, CLIENT, NOW)).toBe(false)
    expect(validateClaims({ ...good, exp: NOW / 1000 - 1 }, CLIENT, NOW)).toBe(false)
    expect(validateClaims({ ...good, iss: 'evil' }, CLIENT, NOW)).toBe(false)
  })
  it('isAllowedIdentity enforces verified email + domain + optional override', () => {
    const opts = { allowedDomains: ['studiomanfred.com'] }
    expect(isAllowedIdentity({ email: 'j@studiomanfred.com', email_verified: true }, opts)).toBe(true)
    expect(isAllowedIdentity({ email: 'j@evil.com', email_verified: true }, opts)).toBe(false)
    expect(isAllowedIdentity({ email: 'j@studiomanfred.com', email_verified: false }, opts)).toBe(false)
    expect(isAllowedIdentity(
      { email: 'x@studiomanfred.com', email_verified: true },
      { allowedDomains: ['studiomanfred.com'], allowedEmails: ['jens@studiomanfred.com'] },
    )).toBe(false)
  })
})
