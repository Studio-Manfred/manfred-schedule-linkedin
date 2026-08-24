import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifySession } from './session.js'

export function readCookie(req: VercelRequest, name: string): string | undefined {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

export function sendJson(res: VercelResponse, status: number, data: unknown): void {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(data))
}

/** Sends 401 and returns false when the session cookie is missing/invalid. */
export function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const secret = process.env.SESSION_SECRET
  if (!secret || verifySession(secret, readCookie(req, 'session')) === null) {
    sendJson(res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}

/** Sends 401 and returns null when unauthenticated; otherwise returns the userId. */
export function requireUser(req: VercelRequest, res: VercelResponse): string | null {
  const secret = process.env.SESSION_SECRET
  const userId = secret ? verifySession(secret, readCookie(req, 'session')) : null
  if (!userId) {
    sendJson(res, 401, { error: 'unauthorized' })
    return null
  }
  return userId
}

/** Sends 405 and returns false when the method doesn't match. */
export function methodIs(req: VercelRequest, res: VercelResponse, ...methods: string[]): boolean {
  if (methods.includes(req.method ?? '')) return true
  res.setHeader('Allow', methods.join(', '))
  sendJson(res, 405, { error: 'method not allowed' })
  return false
}

export const SESSION_COOKIE = (token: string) =>
  `session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax; Secure`

export const CLEAR_COOKIE = 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure'

export const FLOW_COOKIE = (name: string, value: string) =>
  `${name}=${value}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`
export const CLEAR_FLOW_COOKIE = (name: string) =>
  `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`
