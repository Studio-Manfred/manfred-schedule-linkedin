import type { ReactNode } from 'react'
import { TIMEZONE, type Post } from '@/lib/types'

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function PostCard({ post, children }: { post: Post; children?: ReactNode }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {post.scheduledAt && <time dateTime={post.scheduledAt}>{fmt.format(new Date(post.scheduledAt))}</time>}
        {post.pinned && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">Pinned</span>
        )}
        {post.images.length > 0 && <span>{post.images.length} image(s)</span>}
      </div>
      <p className="whitespace-pre-wrap">{post.body}</p>
      {post.error && <p className="text-destructive text-sm">{post.error}</p>}
      {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
    </article>
  )
}
