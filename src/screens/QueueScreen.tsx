import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { PostCard } from '@/components/PostCard'
import type { Post } from '@/lib/types'

function CardActions({ post, onDelete }: { post: Post; onDelete: (id: string) => void }) {
  return (
    <>
      <Button type="button" variant="ghost" asChild>
        <Link to={`/compose?edit=${post.id}`}>Edit</Link>
      </Button>
      <Button type="button" variant="ghost" onClick={() => onDelete(post.id)}>
        Delete
      </Button>
    </>
  )
}

function SortableItem({ post, onDelete }: { post: Post; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: post.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    >
      <PostCard
        post={post}
        dragHandle={{ ref: setActivatorNodeRef, attributes, listeners }}
        actions={<CardActions post={post} onDelete={onDelete} />}
      />
    </li>
  )
}

export function QueueScreen() {
  const [posts, setPosts] = useState<Post[]>([])
  const [tab, setTab] = useState<'queue' | 'drafts'>('queue')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(() => api.listPosts().then(setPosts), [])
  useEffect(() => {
    void load()
  }, [load])

  const unpinned = posts
    .filter((p) => p.status === 'queued' && !p.pinned)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const pinned = posts.filter((p) => p.status === 'queued' && p.pinned)
  const drafts = posts.filter((p) => p.status === 'draft')
  const upcoming = [...unpinned, ...pinned].sort(
    (a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime(),
  )

  async function persistOrder(orderedIds: string[]) {
    setPosts(await api.reorder(orderedIds))
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = unpinned.map((p) => p.id)
    void persistOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this post?')) return
    await api.deletePost(id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Queue</h1>
        <Button variant="brand" asChild>
          <Link to="/compose">New post</Link>
        </Button>
      </div>

      <div role="tablist" aria-label="Queue sections" className="flex gap-2 border-b border-border">
        {(['queue', 'drafts'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={tab === t ? 'border-b-2 border-foreground px-3 py-2 font-medium' : 'px-3 py-2'}
          >
            {t === 'queue' ? `Upcoming (${upcoming.length})` : `Drafts (${drafts.length})`}
          </button>
        ))}
      </div>

      {tab === 'queue' &&
        (upcoming.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing queued.{' '}
            <Link to="/compose" className="underline">
              Write your first post
            </Link>
            .
          </p>
        ) : (
          <>
            {unpinned.length > 1 && (
              <p className="text-sm text-muted-foreground">
                Drag a card, or focus it and press Space then the arrow keys, to reorder the queue.
              </p>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={unpinned.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-3">
                  {upcoming.map((p) =>
                    p.pinned ? (
                      <li key={p.id}>
                        <PostCard post={p} actions={<CardActions post={p} onDelete={remove} />} />
                      </li>
                    ) : (
                      <SortableItem key={p.id} post={p} onDelete={remove} />
                    ),
                  )}
                </ul>
              </SortableContext>
            </DndContext>
          </>
        ))}

      {tab === 'drafts' && (
        <ul className="flex flex-col gap-3">
          {drafts.map((p) => (
            <li key={p.id}>
              <PostCard post={p} actions={<CardActions post={p} onDelete={remove} />} />
            </li>
          ))}
          {drafts.length === 0 && <p className="text-muted-foreground">No drafts.</p>}
        </ul>
      )}
    </div>
  )
}
