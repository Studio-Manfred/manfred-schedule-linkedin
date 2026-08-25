// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { resolvePublisher, type ResolveDeps } from './resolve-publisher'
import type { Publisher } from './publisher'

const PUB = (): Publisher => ({ publish: vi.fn() })

function deps(overrides: Partial<ResolveDeps>): ResolveDeps {
  return {
    getZernioCreds: vi.fn(async () => null),
    getUserById: vi.fn(async () => null),
    decrypt: vi.fn((s: string) => s.replace('enc:', '')),
    makePublisher: vi.fn(() => PUB()),
    env: {},
    ...overrides,
  }
}

describe('resolvePublisher', () => {
  it('uses the user’s own decrypted creds when present', async () => {
    const d = deps({ getZernioCreds: vi.fn(async () => ({ apiKeyEnc: 'enc:k1', accountId: 'acc1' })) })
    await resolvePublisher('u1', d)
    expect(d.decrypt).toHaveBeenCalledWith('enc:k1')
    expect(d.makePublisher).toHaveBeenCalledWith({ apiKey: 'k1', accountId: 'acc1' })
  })

  it('falls back to env creds ONLY for the fallback-email user (case-insensitive)', async () => {
    const d = deps({
      getUserById: vi.fn(async () => ({ email: 'Jens@studiomanfred.com' })),
      env: { apiKey: 'envK', accountId: 'envA', fallbackEmail: 'jens@studiomanfred.com' },
    })
    const pub = await resolvePublisher('u-jens', d)
    expect(d.makePublisher).toHaveBeenCalledWith({ apiKey: 'envK', accountId: 'envA' })
    expect(pub).not.toBeNull()
  })

  it('returns null for a different user with no creds even when env is set (isolation)', async () => {
    const d = deps({
      getUserById: vi.fn(async () => ({ email: 'david@seventyoneconsulting.se' })),
      env: { apiKey: 'envK', accountId: 'envA', fallbackEmail: 'jens@studiomanfred.com' },
    })
    expect(await resolvePublisher('u-david', d)).toBeNull()
    expect(d.makePublisher).not.toHaveBeenCalled()
  })

  it('returns null (does not throw) when a stored cred fails to decrypt', async () => {
    const d = deps({
      getZernioCreds: vi.fn(async () => ({ apiKeyEnc: 'bad', accountId: 'acc' })),
      decrypt: vi.fn(() => { throw new Error('bad tag') }),
    })
    expect(await resolvePublisher('u1', d)).toBeNull()
  })

  it('returns null with no creds and no env', async () => {
    expect(await resolvePublisher('u1', deps({}))).toBeNull()
  })

  it('returns null when fallbackEmail is set but env creds are missing', async () => {
    const d = deps({
      getUserById: vi.fn(async () => ({ email: 'jens@studiomanfred.com' })),
      env: { fallbackEmail: 'jens@studiomanfred.com' },
    })
    expect(await resolvePublisher('u-jens', d)).toBeNull()
  })

  it('returns null (does not throw) when the fallback user lookup fails', async () => {
    const d = deps({
      getUserById: vi.fn(async () => { throw new Error('db down') }),
      env: { apiKey: 'envK', accountId: 'envA', fallbackEmail: 'jens@studiomanfred.com' },
    })
    expect(await resolvePublisher('u-jens', d)).toBeNull()
  })
})
