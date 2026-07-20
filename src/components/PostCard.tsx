import type { ReactNode } from 'react'
import type { useSortable } from '@dnd-kit/sortable'
import { TIMEZONE, type Post } from '@/lib/types'

type SortableHandle = ReturnType<typeof useSortable>

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Props for turning the card's content region into a drag activator.
 * `ref`, `attributes`, and `listeners` come straight from dnd-kit's
 * `useSortable` (via `setActivatorNodeRef`). Keeping the activator on the
 * content region — with the action buttons as siblings below — means the
 * whole visible card drags while avoiding an interactive-nested-in-interactive
 * (role="button" wrapping a link/button) accessibility violation.
 */
export interface DragHandle {
  ref: SortableHandle['setActivatorNodeRef']
  attributes: SortableHandle['attributes']
  listeners: SortableHandle['listeners']
}

export function PostCard({
  post,
  actions,
  dragHandle,
}: {
  post: Post
  actions?: ReactNode
  dragHandle?: DragHandle
}) {
  const draggable = Boolean(dragHandle)
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div
        ref={dragHandle?.ref}
        {...dragHandle?.attributes}
        {...dragHandle?.listeners}
        className={
          draggable
            ? 'flex flex-col gap-2 cursor-grab rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            : 'flex flex-col gap-2'
        }
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {post.scheduledAt && (
            <time dateTime={post.scheduledAt}>{fmt.format(new Date(post.scheduledAt))}</time>
          )}
          {post.pinned && (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">Pinned</span>
          )}
          {draggable && <span className="ml-auto text-xs">⠿ Drag to reorder</span>}
        </div>

        {post.images.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {post.images.slice(0, 4).map((img) => (
              <li key={img.url}>
                <img
                  src={img.url}
                  alt={img.alt}
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
              </li>
            ))}
            {post.images.length > 4 && (
              <li className="flex h-16 w-16 items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
                +{post.images.length - 4}
              </li>
            )}
          </ul>
        )}

        <p className="whitespace-pre-wrap">{post.body}</p>
        {post.error && <p className="text-destructive text-sm">{post.error}</p>}
      </div>

      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </article>
  )
}
