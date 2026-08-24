import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A tagged-template spy standing in for the neon client.
const calls: { text: string; values: unknown[] }[] = []
let results: unknown[][] = []

function tag(strings: TemplateStringsArray, ...values: unknown[]) {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve(results.shift() ?? [])
}
// replaceSlots uses .transaction([...]) whose elements are tagged calls (already
// captured above); the transaction itself just needs to resolve.
;(tag as unknown as { transaction: (q: unknown[]) => Promise<unknown> }).transaction = () =>
  Promise.resolve([])

vi.mock('./db.js', () => ({ sql: () => tag }))

// Import AFTER the mock is registered.
import * as posts from './posts-repo.js'
import * as slots from './slots-repo.js'

beforeEach(() => {
  calls.length = 0
  results = []
})
afterEach(() => vi.clearAllMocks())

const ROW = {
  id: 'p1', body: 'x', images: [], first_comment: null, status: 'queued',
  pinned: false, position: 0, scheduled_at: null, zernio_post_id: null,
  linkedin_url: null, error: null, attempts: 0,
  created_at: '2026-07-15T09:00:00.000Z', updated_at: '2026-07-15T09:00:00.000Z',
}

describe('posts-repo user scoping', () => {
  it('getPost binds the userId', async () => {
    results = [[ROW]]
    await posts.getPost('u1', 'p1')
    expect(calls[0]!.values).toContain('u1')
    expect(calls[0]!.values).toContain('p1')
  })

  it('updatePost on a post the user does not own is a no-op (guarded by getPost)', async () => {
    results = [[]] // scoped getPost finds nothing → not owned
    const out = await posts.updatePost('intruder', 'p1', { body: 'hacked' })
    expect(out).toBeNull()
    expect(calls).toHaveLength(1) // only the SELECT ran; no UPDATE issued
  })

  it('deletePost binds the userId', async () => {
    await posts.deletePost('u1', 'p1')
    expect(calls[0]!.values).toEqual(expect.arrayContaining(['p1', 'u1']))
  })

  it('insertPost binds the userId', async () => {
    results = [[ROW]]
    await posts.insertPost('u1', {
      body: 'x', images: [], firstComment: null, status: 'draft',
      pinned: false, position: null, scheduledAt: null,
    })
    expect(calls[0]!.values).toContain('u1')
  })

  it('listPosts binds the userId', async () => {
    results = [[]]
    await posts.listPosts('u1')
    expect(calls[0]!.values).toContain('u1')
  })
})

describe('slots-repo user scoping', () => {
  it('listSlots binds the userId', async () => {
    results = [[]]
    await slots.listSlots('u1')
    expect(calls[0]!.values).toContain('u1')
  })

  it('replaceSlots scopes the DELETE and INSERT to the userId', async () => {
    results = [[]] // final listSlots() result
    await slots.replaceSlots('u1', [{ weekday: 1, timeLocal: '09:00' }])
    const del = calls.find((c) => c.text.includes('DELETE FROM schedule_slots'))
    const ins = calls.find((c) => c.text.includes('INSERT INTO schedule_slots'))
    expect(del?.values).toContain('u1')
    expect(ins?.values).toContain('u1')
  })
})
