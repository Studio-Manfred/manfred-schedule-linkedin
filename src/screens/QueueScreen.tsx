import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import { Badge, Button } from '@studio-manfred/manfred-design-system'
import { api, ApiError } from '@/api/client'
import { MonthCalendar } from '@/components/MonthCalendar'
import { PostCard } from '@/components/PostCard'
import { rescheduleIso } from '@/lib/calendar'
import { TIMEZONE, type Post } from '@/lib/types'

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
  const [tab, setTab] = useState<'queue' | 'drafts' | 'month'>('queue')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

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

  function openPost(post: Post) {
    if (post.status === 'published') {
      if (post.linkedinUrl) window.open(post.linkedinUrl, '_blank', 'noopener,noreferrer')
      return
    }
    navigate(`/compose?edit=${post.id}`)
  }

  async function reschedule(post: Post, dayKey: string) {
    setError(null)
    try {
      await api.updatePost(post.id, { action: 'pin', scheduledAt: rescheduleIso(post, dayKey, TIMEZONE) })
      await load()
    } catch (e) {
      await load() // snap the chip back to its real slot
      setError(e instanceof ApiError ? e.message : 'could not reschedule')
    }
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
        {(['queue', 'drafts', 'month'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? 'flex items-center gap-2 border-b-2 border-foreground px-3 py-2 font-medium'
                : 'flex items-center gap-2 px-3 py-2'
            }
          >
            {t === 'queue' ? 'Upcoming' : t === 'drafts' ? 'Drafts' : 'Monthly View'}
            {t !== 'month' && (
              <Badge variant="neutral" size="sm">
                {t === 'queue' ? upcoming.length : drafts.length}
              </Badge>
            )}
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

      {tab === 'month' && (
        <>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <MonthCalendar
            posts={posts}
            onSelectPost={openPost}
            onSelectDay={(dayKey) => navigate(`/compose?pin=${dayKey}`)}
            onReschedule={reschedule}
          />
        </>
      )}
    </div>
  )
}
