// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encrypt, decrypt } from './crypto'

// 32 bytes base64 — deterministic test key.
const KEY = Buffer.alloc(32, 7).toString('base64')

describe('crypto (AES-256-GCM)', () => {
  beforeEach(() => { process.env.CRED_ENC_KEY = KEY })
  afterEach(() => { delete process.env.CRED_ENC_KEY })

  it('round-trips a value', () => {
    const secret = 'zk_live_abc123'
    expect(decrypt(encrypt(secret))).toBe(secret)
  })

  it('uses a distinct IV per call (ciphertexts differ for same plaintext)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })

  it('throws on a tampered ciphertext', () => {
    const enc = encrypt('secret')
    const [iv, tag, data] = enc.split('.')
    const flipped = data![0] === 'A' ? 'B' : 'A'
    const tampered = [iv, tag, flipped + data!.slice(1)].join('.')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('throws when CRED_ENC_KEY is missing', () => {
    delete process.env.CRED_ENC_KEY
    expect(() => encrypt('x')).toThrow(/CRED_ENC_KEY/)
  })

  it('throws when CRED_ENC_KEY is the wrong length', () => {
    process.env.CRED_ENC_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })
})
