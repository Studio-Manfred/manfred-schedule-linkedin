import type { Post, PostImage, PostStatus } from '../../src/lib/types'
import { sql } from './db'

export interface NewPost {
  body: string
  images: PostImage[]
  status: 'draft' | 'queued'
  pinned: boolean
  position: number | null
  scheduledAt: Date | null
}

export interface PostPatch {
  body: string
  images: PostImage[]
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

export async function listPosts(statuses?: PostStatus[]): Promise<Post[]> {
  const rows = statuses
    ? await sql()`SELECT * FROM posts WHERE status = ANY(${statuses}) ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
    : await sql()`SELECT * FROM posts ORDER BY scheduled_at NULLS LAST, position NULLS LAST, created_at DESC`
  return (rows as any[]).map(rowToPost)
}

export async function getPost(id: string): Promise<Post | null> {
  const rows = (await sql()`SELECT * FROM posts WHERE id = ${id}`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function insertPost(p: NewPost): Promise<Post> {
  const rows = (await sql()`
    INSERT INTO posts (body, images, status, pinned, position, scheduled_at)
    VALUES (${p.body}, ${JSON.stringify(p.images)}::jsonb, ${p.status}, ${p.pinned}, ${p.position}, ${p.scheduledAt})
    RETURNING *`) as any[]
  return rowToPost(rows[0])
}

export async function updatePost(id: string, patch: Partial<PostPatch>): Promise<Post | null> {
  const cur = await getPost(id)
  if (!cur) return null
  const next = {
    body: patch.body ?? cur.body,
    images: patch.images ?? cur.images,
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
      status = ${next.status}, pinned = ${next.pinned}, position = ${next.position},
      scheduled_at = ${next.scheduledAt}, attempts = ${next.attempts}, error = ${next.error},
      updated_at = now()
    WHERE id = ${id} RETURNING *`) as any[]
  return rows[0] ? rowToPost(rows[0]) : null
}

export async function deletePost(id: string): Promise<void> {
  await sql()`DELETE FROM posts WHERE id = ${id}`
}

export async function listQueuedUnpinnedIds(): Promise<string[]> {
  const rows = (await sql()`
    SELECT id FROM posts WHERE status = 'queued' AND pinned = false
    ORDER BY position ASC NULLS LAST, created_at ASC`) as any[]
  return rows.map((r) => r.id)
}

export async function listPinnedFutureTimes(now: Date): Promise<Date[]> {
  const rows = (await sql()`
    SELECT scheduled_at FROM posts
    WHERE status = 'queued' AND pinned = true AND scheduled_at > ${now}`) as any[]
  return rows.map((r) => new Date(r.scheduled_at))
}

export async function saveSchedule(entries: { id: string; scheduledAt: Date }[]): Promise<void> {
  for (const e of entries) {
    await sql()`UPDATE posts SET scheduled_at = ${e.scheduledAt}, updated_at = now() WHERE id = ${e.id}`
  }
}

export async function setPositions(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await sql()`UPDATE posts SET position = ${i}, updated_at = now() WHERE id = ${orderedIds[i]}`
  }
}

export async function nextPosition(): Promise<number> {
  const rows = (await sql()`
    SELECT COALESCE(MAX(position), -1) + 1 AS next FROM posts
    WHERE status = 'queued' AND pinned = false`) as any[]
  return rows[0].next
}

export async function claimDuePosts(now: Date): Promise<Post[]> {
  const rows = (await sql()`
    UPDATE posts SET status = 'publishing', attempts = attempts + 1, updated_at = now()
    WHERE status = 'queued' AND scheduled_at <= ${now}
    RETURNING *`) as any[]
  return rows.map(rowToPost)
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
