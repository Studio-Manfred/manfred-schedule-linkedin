import { MAX_ATTEMPTS, MISSED_WINDOW_MINUTES, STUCK_PUBLISHING_MINUTES, type Post } from '../../src/lib/types.js'
import type { Publisher } from './publisher.js'

export interface TickDeps {
  now(): Date
  claimDuePosts(now: Date): Promise<Post[]>
  requeue(id: string, error: string): Promise<void>
  markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markMissed(id: string): Promise<void>
  sweepStuck(cutoff: Date): Promise<number>
  publisher: Publisher
}

export interface TickResult {
  published: number
  requeued: number
  failed: number
  missed: number
  swept: number
}

export async function runPublishTick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now()
  const result: TickResult = { published: 0, requeued: 0, failed: 0, missed: 0, swept: 0 }

  result.swept = await deps.sweepStuck(new Date(now.getTime() - STUCK_PUBLISHING_MINUTES * 60_000))

  for (const post of await deps.claimDuePosts(now)) {
    const scheduled = post.scheduledAt ? new Date(post.scheduledAt) : now
    if (now.getTime() - scheduled.getTime() > MISSED_WINDOW_MINUTES * 60_000) {
      await deps.markMissed(post.id)
      result.missed++
      continue
    }
    const outcome = await deps.publisher.publish({
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
