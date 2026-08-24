import { MAX_ATTEMPTS, MISSED_WINDOW_MINUTES, STUCK_PUBLISHING_MINUTES } from '../../src/lib/types.js'
import type { ClaimedPost } from './posts-repo.js'
import type { Publisher } from './publisher.js'

export interface TickDeps {
  now(): Date
  claimDuePosts(now: Date): Promise<ClaimedPost[]>
  releaseToQueued(id: string): Promise<void>
  requeue(id: string, error: string): Promise<void>
  markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markMissed(id: string): Promise<void>
  sweepStuck(cutoff: Date): Promise<number>
  resolvePublisher(userId: string): Promise<Publisher | null>
}

export interface TickResult {
  published: number
  requeued: number
  failed: number
  missed: number
  released: number
  swept: number
}

export async function runPublishTick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now()
  const result: TickResult = { published: 0, requeued: 0, failed: 0, missed: 0, released: 0, swept: 0 }

  result.swept = await deps.sweepStuck(new Date(now.getTime() - STUCK_PUBLISHING_MINUTES * 60_000))

  // Resolve each distinct user's publisher at most once per tick.
  const publishers = new Map<string, Publisher | null>()
  const publisherFor = async (userId: string): Promise<Publisher | null> => {
    if (!publishers.has(userId)) publishers.set(userId, await deps.resolvePublisher(userId))
    return publishers.get(userId) ?? null
  }

  for (const post of await deps.claimDuePosts(now)) {
    const scheduled = post.scheduledAt ? new Date(post.scheduledAt) : now
    if (now.getTime() - scheduled.getTime() > MISSED_WINDOW_MINUTES * 60_000) {
      await deps.markMissed(post.id)
      result.missed++
      continue
    }
    const publisher = await publisherFor(post.userId)
    if (!publisher) {
      await deps.releaseToQueued(post.id)
      result.released++
      continue
    }
    const outcome = await publisher.publish({
      requestId: post.id,
      body: post.body,
      images: post.images.map((i) => ({ url: i.url, alt: i.alt, contentType: guessContentType(i.url) })),
      firstComment: post.firstComment,
    })
    if (outcome.ok) {
      await deps.markPublished(post.id, outcome.zernioPostId, outcome.linkedinUrl)
      result.published++
    } else if (outcome.retryable && post.attempts < MAX_ATTEMPTS) {
      await deps.requeue(post.id, outcome.error)
      result.requeued++
    } else {
      await deps.markFailed(post.id, outcome.error)
      result.failed++
    }
  }
  return result
}

function guessContentType(url: string): string {
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) return 'image/jpeg'
  if (url.endsWith('.webp')) return 'image/webp'
  if (url.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}
