// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkPassword, createSession, verifySession } from './session'

const SECRET = 'test-secret'

describe('session', () => {
  it('round-trips a valid token', () => {
    const t = createSession(SECRET, 1_000_000)
    expect(verifySession(SECRET, t, 1_000_000)).toBe(true)
  })

  it('rejects a tampered token', () => {
    const t = createSession(SECRET, 1_000_000)
    expect(verifySession(SECRET, t + 'x', 1_000_000)).toBe(false)
    expect(verifySession('other-secret', t, 1_000_000)).toBe(false)
  })

  it('rejects an expired token (30 days)', () => {
    const t = createSession(SECRET, 0)
    expect(verifySession(SECRET, t, 31 * 86_400_000)).toBe(false)
  })

  it('rejects garbage and undefined', () => {
    expect(verifySession(SECRET, undefined)).toBe(false)
    expect(verifySession(SECRET, 'nope')).toBe(false)
  })
})

describe('checkPassword', () => {
  it('accepts exact match, rejects everything else without throwing on length mismatch', () => {
    expect(checkPassword('hunter2', 'hunter2')).toBe(true)
    expect(checkPassword('hunter', 'hunter2')).toBe(false)
    expect(checkPassword('', 'hunter2')).toBe(false)
  })
})
