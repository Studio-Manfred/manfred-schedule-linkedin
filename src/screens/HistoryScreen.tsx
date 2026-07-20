import { useCallback, useEffect, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { PostCard } from '@/components/PostCard'
import type { Post } from '@/lib/types'

export function HistoryScreen() {
  const [posts, setPosts] = useState<Post[]>([])
  const load = useCallback(() => api.listPosts().then(setPosts), [])
  useEffect(() => {
    void load()
  }, [load])

  const done = posts
    .filter((p) => ['published', 'failed', 'missed'].includes(p.status))
    .sort((a, b) => new Date(b.scheduledAt ?? b.updatedAt).getTime() - new Date(a.scheduledAt ?? a.updatedAt).getTime())

  async function retry(id: string) {
    await api.retry(id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">History</h1>
      {done.length === 0 && <p className="text-muted-foreground">Nothing published yet.</p>}
      <ul className="flex flex-col gap-3">
        {done.map((p) => (
          <li key={p.id}>
            <PostCard post={p}>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium capitalize">
                {p.status}
              </span>
              {p.status === 'published' &&
                (p.linkedinUrl ? (
                  <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="underline">
                    View on LinkedIn
                  </a>
                ) : (
                  <span className="text-muted-foreground text-sm">Published via Zernio (no direct link returned)</span>
                ))}
              {(p.status === 'failed' || p.status === 'missed') && (
                <Button type="button" variant="ghost" onClick={() => retry(p.id)}>
                  Retry
                </Button>
              )}
            </PostCard>
          </li>
        ))}
      </ul>
    </div>
  )
}
