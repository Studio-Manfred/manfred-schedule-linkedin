import type { Post, PostImage, PostStatus } from '../../src/lib/types.js'
import { sql } from './db.js'

export interface NewPost {
  body: string
  images: PostImage[]
  firstComment: string | null
  status: 'draft' | 'queued'
  pinned: boolean
  position: number | null
  scheduledAt: Date | null
}

export type ClaimedPost = Post & { userId: string }

export interface PostPatch {
  body: string
  images: PostImage[]
  firstComment: string | null
  status: PostStatus
  pinned: boolean
  position: number | null
  scheduledAt: Date | null
  attempts: number
  error: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToPost(r: any): Post {
  return {
    id: r.id,
    body: r.body,
    images: r.images as PostImage[],
    firstComment: r.first_comment ?? null,
    status: r.status as PostStatus,
    pinned: r.pinned,
    position: r.position,
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    zernioPostId: r.zernio_post_id,
    linkedinUrl: r.linkedin_url,
    error: r.error,
    attempts: r.attempts,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

export async function listPosts(userId: string, statuses?: PostStatus[]): Promise<Post[]> {
  const rows = statuses
    ? await sql()`SELECT * FROM posts WHERE user_id = ${userId} AND status = ANY(${statuses}) ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
    : await sql()`SELECT * FROM posts WHERE user_id = ${userId} ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
  return (rows as any[]).map(rowToPost)
}

export async function getPost(userId: string, id: string): Promise<Post | null> {
  const rows = (await sql()`SELECT * FROM posts WHERE id = ${id} AND user_id = ${userId}`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function insertPost(userId: string, p: NewPost): Promise<Post> {
  const rows = (await sql()`
    INSERT INTO posts (user_id, body, images, first_comment, status, pinned, position, scheduled_at)
    VALUES (${userId}, ${p.body}, ${JSON.stringify(p.images)}::jsonb, ${p.firstComment}, ${p.status}, ${p.pinned}, ${p.position}, ${p.scheduledAt})
    RETURNING *`) as any[]
  return rowToPost(rows[0])
}

export async function updatePost(userId: string, id: string, patch: Partial<PostPatch>): Promise<Post | null> {
  const cur = await getPost(userId, id)
  if (!cur) return null
  const next = {
    body: patch.body ?? cur.body,
    images: patch.images ?? cur.images,
    firstComment: patch.firstComment !== undefined ? patch.firstComment : cur.firstComment,
    status: patch.status ?? cur.status,
    pinned: patch.pinned ?? cur.pinned,
    position: patch.position !== undefined ? patch.position : cur.position,
    scheduledAt:
      patch.scheduledAt !== undefined
        ? patch.scheduledAt
        : cur.scheduledAt
          ? new Date(cur.scheduledAt)
          : null,
    attempts: patch.attempts ?? cur.attempts,
    error: patch.error !== undefined ? patch.error : cur.error,
  }
  const rows = (await sql()`
    UPDATE posts SET body = ${next.body}, images = ${JSON.stringify(next.images)}::jsonb,
      first_comment = ${next.firstComment},
      status = ${next.status}, pinned = ${next.pinned}, position = ${next.position},
      scheduled_at = ${next.scheduledAt}, attempts = ${next.attempts}, error = ${next.error},
      updated_at = now()
    WHERE id = ${id} AND user_id = ${userId} RETURNING *`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function deletePost(userId: string, id: string): Promise<void> {
  await sql()`DELETE FROM posts WHERE id = ${id} AND user_id = ${userId}`
}

export async function listQueuedUnpinnedIds(userId: string): Promise<string[]> {
  const rows = (await sql()`
    SELECT id FROM posts WHERE user_id = ${userId} AND status = 'queued' AND pinned = false
    ORDER BY position ASC NULLS LAST, created_at ASC`) as any[]
  return rows.map((r) => r.id)
}

export async function listPinnedFutureTimes(userId: string, now: Date): Promise<Date[]> {
  const rows = (await sql()`
    SELECT scheduled_at FROM posts
    WHERE user_id = ${userId} AND status = 'queued' AND pinned = true AND scheduled_at > ${now}`) as any[]
  return rows.map((r) => new Date(r.scheduled_at))
}

export async function saveSchedule(userId: string, entries: { id: string; scheduledAt: Date }[]): Promise<void> {
  for (const e of entries) {
    await sql()`UPDATE posts SET scheduled_at = ${e.scheduledAt}, updated_at = now() WHERE id = ${e.id} AND user_id = ${userId}`
  }
}

export async function setPositions(userId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await sql()`UPDATE posts SET position = ${i}, updated_at = now() WHERE id = ${orderedIds[i]} AND user_id = ${userId}`
  }
}

export async function nextPosition(userId: string): Promise<number> {
  const rows = (await sql()`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM posts
    WHERE user_id = ${userId} AND status = 'queued' AND pinned = false`) as any[]
  return rows[0].next
}

export async function claimDuePosts(now: Date): Promise<ClaimedPost[]> {
  const rows = (await sql()`
    UPDATE posts SET status = 'publishing', attempts = attempts + 1, updated_at = now()
    WHERE status = 'queued' AND scheduled_at <= ${now}
    RETURNING *`) as any[]
  return rows.map((r) => ({ ...rowToPost(r), userId: r.user_id }))
}

/** Undo a claim for a user who can't publish yet: back to queued, attempt not counted, no error. */
export async function releaseToQueued(id: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'queued', attempts = GREATEST(attempts - 1, 0), error = NULL, updated_at = now()
    WHERE id = ${id} AND status = 'publishing'`
}

export async function requeue(id: string, error: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'queued', error = ${error}, updated_at = now() WHERE id = ${id}`
}

export async function markPublished(id: string, zernioPostId: string, linkedinUrl: string | null): Promise<void> {
  await sql()`UPDATE posts SET status = 'published', zernio_post_id = ${zernioPostId},
    linkedin_url = ${linkedinUrl}, error = NULL, updated_at = now() WHERE id = ${id}`
}

export async function markFailed(id: string, error: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'failed', error = ${error}, updated_at = now() WHERE id = ${id}`
}

export async function markMissed(id: string): Promise<void> {
  await sql()`UPDATE posts SET status = 'missed', updated_at = now() WHERE id = ${id}`
}

export async function sweepStuck(cutoff: Date): Promise<number> {
  const rows = (await sql()`
    UPDATE posts SET status = 'failed', error = 'stuck in publishing (swept)', updated_at = now()
    WHERE status = 'publishing' AND updated_at < ${cutoff}
    RETURNING id`) as any[]
  return rows.length
}
