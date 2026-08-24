// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { listZernioAccounts } from './zernio-accounts'

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch
}

describe('listZernioAccounts', () => {
  it('normalizes LinkedIn accounts to {id, name}', async () => {
    const f = fetchReturning(200, { accounts: [
      { _id: 'a1', platform: 'linkedin', displayName: 'Jens Wedin' },
      { id: 'a2', platform: 'twitter', name: 'Ignore Me' },
    ] })
    expect(await listZernioAccounts('k', f)).toEqual([{ id: 'a1', name: 'Jens Wedin' }])
  })

  it('throws on an unauthorized key', async () => {
    await expect(listZernioAccounts('bad', fetchReturning(401, {}))).rejects.toThrow(/invalid/i)
  })
})
