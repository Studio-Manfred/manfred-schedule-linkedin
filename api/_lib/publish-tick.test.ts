// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runPublishTick } from './publish-tick'
import type { ClaimedPost } from './posts-repo'

const NOW = new Date('2026-07-21T06:31:00Z')

function post(overrides: Partial<ClaimedPost>): ClaimedPost {
  return {
    id: 'p1', body: 'hi', images: [], firstComment: null, status: 'publishing', pinned: false, position: 0,
    scheduledAt: '2026-07-21T06:30:00.000Z', zernioPostId: null, linkedinUrl: null,
    error: null, attempts: 1, createdAt: '', updatedAt: '', userId: 'u1', ...overrides,
  }
}

type Res = { ok: true; zernioPostId: string; linkedinUrl: string | null } | { ok: false; retryable: boolean; error: string }

function makeDeps(claimed: ClaimedPost[], resolve: (userId: string) => Promise<{ publish: (i: unknown) => Promise<Res> } | null>) {
  return {
    now: () => NOW,
    claimDuePosts: vi.fn(async () => claimed),
    releaseToQueued: vi.fn(async () => {}),
    requeue: vi.fn(async () => {}),
    markPublished: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    markMissed: vi.fn(async () => {}),
    sweepStuck: vi.fn(async () => 0),
    resolvePublisher: vi.fn(resolve),
  }
}
const okPublisher = (r: Res = { ok: true, zernioPostId: 'z1', linkedinUrl: 'https://li/x' }) => ({ publish: vi.fn(async () => r) })

describe('runPublishTick', () => {
  it('publishes with the post owner’s resolved publisher', async () => {
    const pub = okPublisher()
    const deps = makeDeps([post({})], async () => pub)
    const result = await runPublishTick(deps)
    expect(deps.resolvePublisher).toHaveBeenCalledWith('u1')
    expect(pub.publish).toHaveBeenCalledWith({ requestId: 'p1', body: 'hi', images: [], firstComment: null })
    expect(deps.markPublished).toHaveBeenCalledWith('p1', 'z1', 'https://li/x')
    expect(result.published).toBe(1)
  })

  it('releases a post to queued (not failed, not an attempt) when the owner has no publisher', async () => {
    const deps = makeDeps([post({})], async () => null)
    const result = await runPublishTick(deps)
    expect(deps.releaseToQueued).toHaveBeenCalledWith('p1')
    expect(deps.markFailed).not.toHaveBeenCalled()
    expect(deps.requeue).not.toHaveBeenCalled()
    expect(result.released).toBe(1)
  })

  it('resolves each user’s publisher once and publishes with the right one', async () => {
    const pubA = okPublisher({ ok: true, zernioPostId: 'zA', linkedinUrl: null })
    const pubB = okPublisher({ ok: true, zernioPostId: 'zB', linkedinUrl: null })
    const byUser: Record<string, ReturnType<typeof okPublisher>> = { u1: pubA, u2: pubB }
    const deps = makeDeps(
      [post({ id: 'a1', userId: 'u1' }), post({ id: 'a2', userId: 'u1' }), post({ id: 'b1', userId: 'u2' })],
      async (uid) => byUser[uid] ?? null,
    )
    const result = await runPublishTick(deps)
    expect(result.published).toBe(3)
    expect(pubA.publish).toHaveBeenCalledTimes(2)
    expect(pubB.publish).toHaveBeenCalledTimes(1)
    expect(deps.resolvePublisher).toHaveBeenCalledTimes(2) // resolved once per distinct user
  })

  it('marks a post >60 min late as missed without resolving a publisher', async () => {
    const deps = makeDeps([post({ scheduledAt: '2026-07-21T05:29:00.000Z' })], async () => okPublisher())
    const result = await runPublishTick(deps)
    expect(deps.markMissed).toHaveBeenCalledWith('p1')
    expect(result.missed).toBe(1)
  })

  it('requeues a retryable failure below max attempts', async () => {
    const deps = makeDeps([post({ attempts: 2 })], async () => okPublisher({ ok: false, retryable: true, error: 'zernio 500' }))
    const result = await runPublishTick(deps)
    expect(deps.requeue).toHaveBeenCalledWith('p1', 'zernio 500')
    expect(result.requeued).toBe(1)
  })

  it('fails hard at max attempts or on non-retryable errors', async () => {
    const deps = makeDeps([post({ attempts: 3 })], async () => okPublisher({ ok: false, retryable: true, error: 'zernio 500' }))
    await runPublishTick(deps)
    expect(deps.markFailed).toHaveBeenCalledWith('p1', 'zernio 500')
  })

  it('sweeps stuck posts with a 10-minute cutoff', async () => {
    const deps = makeDeps([], async () => okPublisher())
    deps.sweepStuck = vi.fn(async () => 2)
    const result = await runPublishTick(deps)
    expect(deps.sweepStuck).toHaveBeenCalledWith(new Date('2026-07-21T06:21:00Z'))
    expect(result.swept).toBe(2)
  })
})
