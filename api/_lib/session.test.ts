// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createSession, verifySession } from './session.js'

const SECRET = 'test-secret'
const NOW = Date.parse('2026-07-15T09:00:00.000Z')
const UID = '11111111-1111-1111-1111-111111111111'

describe('session', () => {
  it('round-trips the userId', () => {
    const token = createSession(SECRET, UID, NOW)
    expect(verifySession(SECRET, token, NOW)).toBe(UID)
  })
  it('rejects a tampered mac', () => {
    const token = createSession(SECRET, UID, NOW).slice(0, -1) + 'x'
    expect(verifySession(SECRET, token, NOW)).toBeNull()
  })
  it('rejects a wrong secret', () => {
    const token = createSession(SECRET, UID, NOW)
    expect(verifySession('other', token, NOW)).toBeNull()
  })
  it('rejects an expired token', () => {
    const token = createSession(SECRET, UID, NOW)
    expect(verifySession(SECRET, token, NOW + 31 * 86_400_000)).toBeNull()
  })
  it('rejects a malformed token', () => {
    expect(verifySession(SECRET, undefined, NOW)).toBeNull()
    expect(verifySession(SECRET, 'a.b', NOW)).toBeNull()
  })
})
