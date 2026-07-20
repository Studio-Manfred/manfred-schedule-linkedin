import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const THIRTY_DAYS_MS = 30 * 86_400_000

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSession(secret: string, now: number = Date.now()): string {
  const exp = now + THIRTY_DAYS_MS
  return `${exp}.${sign(secret, String(exp))}`
}

export function verifySession(secret: string, token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false
  const [exp, mac] = token.split('.')
  if (!exp || !mac) return false
  const a = Buffer.from(mac)
  const b = Buffer.from(sign(secret, exp))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  return Number(exp) > now
}

/** Constant-time password compare (hashes both sides to equalize length). */
export function checkPassword(supplied: string, expected: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(supplied), h(expected))
}
