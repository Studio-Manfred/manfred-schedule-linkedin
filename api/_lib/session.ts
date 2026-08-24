import { createHmac, timingSafeEqual } from 'node:crypto'

const THIRTY_DAYS_MS = 30 * 86_400_000

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSession(secret: string, userId: string, now: number = Date.now()): string {
  const payload = `${userId}.${now + THIRTY_DAYS_MS}`
  return `${payload}.${sign(secret, payload)}`
}

export function verifySession(
  secret: string,
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, exp, mac] = parts
  if (!userId || !exp || !mac) return null
  const expected = sign(secret, `${userId}.${exp}`)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(exp) <= now) return null
  return userId
}
