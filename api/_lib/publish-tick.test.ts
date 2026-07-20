// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { runPublishTick } from './publish-tick'
import type { Post } from '../../src/lib/types'

const NOW = new Date('2026-07-21T06:31:00Z')

function post(overrides: Partial<Post>): Post {
  return {
    id: 'p1', body: 'hi', images: [], firstComment: null, status: 'publishing', pinned: false, position: 0,
    scheduledAt: '2026-07-21T06:30:00.000Z', zernioPostId: null, linkedinUrl: null,
    error: null, attempts: 1, createdAt: '', updatedAt: '', ...overrides,
  }
}

function makeDeps(claimed: Post[], publishResult: Awaited<ReturnType<TickPublisher['publish']>>) {
  const publisher = { publish: vi.fn(async () => publishResult) }
  return {
    deps: {
      now: () => NOW,
      claimDuePosts: vi.fn(async () => claimed),
      requeue: vi.fn(async () => {}),
      markPublished: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markMissed: vi.fn(async () => {}),
      sweepStuck: vi.fn(async () => 0),
      publisher,
    },
    publisher,
  }
}
type TickPublisher = { publish: (i: unknown) => Promise<{ ok: true; zernioPostId: string; linkedinUrl: string | null } | { ok: false; retryable: boolean; error: string }> }

describe('runPublishTick', () => {
  it('publishes a due post and records the result', async () => {
    const { deps, publisher } = makeDeps([post({})], { ok: true, zernioPostId: 'z1', linkedinUrl: 'https://li/x' })
    const result = await runPublishTick(deps)
    expect(publisher.publish).toHaveBeenCalledWith({ requestId: 'p1', body: 'hi', images: [], firstComment: null })
    expect(deps.markPublished).toHaveBeenCalledWith('p1', 'z1', 'https://li/x')
    expect(result.published).toBe(1)
  })

  it('forwards a post first comment to the publisher', async () => {
    const { deps, publisher } = makeDeps([post({ firstComment: 'Link: https://x.dev' })], {
      ok: true,
      zernioPostId: 'z2',
      linkedinUrl: null,
    })
    await runPublishTick(deps)
    expect(publisher.publish).toHaveBeenCalledWith({
      requestId: 'p1',
      body: 'hi',
      images: [],
      firstComment: 'Link: https://x.dev',
    })
  })

  it('marks a post >60 min late as missed without publishing', async () => {
    const late = post({ scheduledAt: '2026-07-21T05:29:00.000Z' }) // 62 min late
    const { deps, publisher } = makeDeps([late], { ok: true, zernioPostId: 'z', linkedinUrl: null })
    const result = await runPublishTick(deps)
    expect(publisher.publish).not.toHaveBeenCalled()
    expect(deps.markMissed).toHaveBeenCalledWith('p1')
    expect(result.missed).toBe(1)
  })

  it('requeues a retryable failure below max attempts', async () => {
    const { deps } = makeDeps([post({ attempts: 2 })], { ok: false, retryable: true, error: 'zernio 500' })
    const result = await runPublishTick(deps)
    expect(deps.requeue).toHaveBeenCalledWith('p1', 'zernio 500')
    expect(result.requeued).toBe(1)
  })

  it('fails hard at max attempts or on non-retryable errors', async () => {
    const { deps } = makeDeps([post({ attempts: 3 })], { ok: false, retryable: true, error: 'zernio 500' })
    await runPublishTick(deps)
    expect(deps.markFailed).toHaveBeenCalledWith('p1', 'zernio 500')

    const { deps: deps2 } = makeDeps([post({ attempts: 1 })], { ok: false, retryable: false, error: 'bad content' })
    await runPublishTick(deps2)
    expect(deps2.markFailed).toHaveBeenCalledWith('p1', 'bad content')
  })

  it('sweeps stuck posts with a 10-minute cutoff', async () => {
    const { deps } = makeDeps([], { ok: true, zernioPostId: 'z', linkedinUrl: null })
    deps.sweepStuck = vi.fn(async () => 2)
    const result = await runPublishTick(deps)
    expect(deps.sweepStuck).toHaveBeenCalledWith(new Date('2026-07-21T06:21:00Z'))
    expect(result.swept).toBe(2)
  })
})
