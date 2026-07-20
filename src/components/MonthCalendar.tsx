import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { buildMonthGrid, stockholmDayKey, stockholmTime, type DayCell } from '@/lib/calendar'
import { TIMEZONE, type Post, type PostStatus } from '@/lib/types'

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DRAGGABLE: ReadonlySet<PostStatus> = new Set<PostStatus>(['queued', 'failed', 'missed'])

const DOT: Record<PostStatus, string> = {
  draft: 'bg-muted-foreground',
  queued: 'bg-muted-foreground',
  publishing: 'bg-muted-foreground',
  published: 'bg-green-500',
  failed: 'bg-destructive',
  missed: 'bg-destructive',
}

export interface MonthCalendarProps {
  posts: Post[]
  now?: Date
  timeZone?: string
  onSelectPost(post: Post): void
  onSelectDay(dayKey: string): void
  onReschedule(post: Post, targetDayKey: string): void
}

function Chip({
  post,
  timeZone,
  onSelectPost,
}: {
  post: Post
  timeZone: string
  onSelectPost(p: Post): void
}) {
  const draggable = DRAGGABLE.has(post.status)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: post.id,
    data: { post },
    disabled: !draggable,
  })
  const time = post.scheduledAt ? stockholmTime(post.scheduledAt, timeZone) : ''
  const verb = post.status === 'published' ? 'Open published post' : 'Edit'
  return (
    <button
      type="button"
      ref={draggable ? setNodeRef : undefined}
      {...(draggable ? { ...attributes, ...listeners, 'aria-roledescription': 'draggable' } : {})}
      onClick={() => onSelectPost(post)}
      aria-label={`${verb} ${time}: ${post.body.slice(0, 40)}`}
      className={`flex min-h-6 w-full items-center gap-1 rounded border border-border px-1 py-0.5 text-left text-xs ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[post.status]}`} />
      <span className="tabular-nums">{time}</span>
      {post.pinned && <span aria-hidden="true">📌</span>}
      {post.images[0] && (
        <img src={post.images[0].url} alt="" className="ml-auto h-4 w-4 rounded object-cover" />
      )}
    </button>
  )
}

/** Non-interactive copy shown floating under the pointer while dragging. */
function DragOverlayChip({ post, timeZone }: { post: Post; timeZone: string }) {
  const time = post.scheduledAt ? stockholmTime(post.scheduledAt, timeZone) : ''
  return (
    <div className="flex max-w-[12rem] cursor-grabbing items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs shadow-lg">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[post.status]}`} />
      <span className="tabular-nums">{time}</span>
      <span className="truncate">{post.body.slice(0, 24)}</span>
    </div>
  )
}

function Cell({
  cell,
  monthLabel,
  timeZone,
  onSelectPost,
  onSelectDay,
}: {
  cell: DayCell
  monthLabel: string
  timeZone: string
  onSelectPost(p: Post): void
  onSelectDay(k: string): void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: cell.dayKey,
    data: { dayKey: cell.dayKey },
    disabled: cell.isPast,
  })
  const shown = cell.posts.slice(0, 3)
  const extra = cell.posts.length - shown.length
  return (
    <td
      ref={setNodeRef}
      className={`h-24 border border-border align-top ${
        cell.inCurrentMonth ? '' : 'bg-muted/40 text-muted-foreground'
      } ${isOver ? 'bg-primary/10 ring-2 ring-primary ring-inset' : ''}`}
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <span
          className={`text-xs ${
            cell.isToday ? 'rounded-full bg-primary px-1.5 text-primary-foreground' : ''
          }`}
        >
          {cell.dayOfMonth}
        </span>
        {!cell.isPast && (
          <button
            type="button"
            onClick={() => onSelectDay(cell.dayKey)}
            aria-label={`Add a post on ${cell.dayOfMonth} ${monthLabel}`}
            className="flex h-7 w-7 items-center justify-center rounded text-sm text-muted-foreground hover:text-foreground"
          >
            ＋
          </button>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        {shown.map((p) => (
          <Chip key={p.id} post={p} timeZone={timeZone} onSelectPost={onSelectPost} />
        ))}
        {extra > 0 && <span className="text-xs text-muted-foreground">+{extra} more</span>}
      </div>
    </td>
  )
}

export function MonthCalendar({
  posts,
  now,
  timeZone = TIMEZONE,
  onSelectPost,
  onSelectDay,
  onReschedule,
}: MonthCalendarProps) {
  const base = now ?? new Date()
  const baseKey = stockholmDayKey(base.toISOString(), timeZone) // 'YYYY-MM-DD'
  const baseYear = Number(baseKey.slice(0, 4))
  const baseMonth = Number(baseKey.slice(5, 7)) - 1
  const [ym, setYm] = useState({ year: baseYear, month: baseMonth })
  const [activePost, setActivePost] = useState<Post | null>(null)

  // Pointer drag only. Distance activation keeps chip clicks (select) working.
  // Keyboard reschedule is served by the click → composer → edit-date path.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const grid = buildMonthGrid(ym.year, ym.month, posts, { now: base, timeZone })
  const title = `${MONTHS[ym.month]} ${ym.year}`

  const step = (delta: number) =>
    setYm(({ year, month }) => {
      const m = month + delta
      if (m < 0) return { year: year - 1, month: 11 }
      if (m > 11) return { year: year + 1, month: 0 }
      return { year, month: m }
    })

  function onDragStart(e: DragStartEvent) {
    setActivePost((e.active.data.current?.post as Post | undefined) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setActivePost(null)
    const post = e.active.data.current?.post as Post | undefined
    const dayKey = e.over?.data.current?.dayKey as string | undefined
    if (!post || !dayKey) return
    if (post.scheduledAt && stockholmDayKey(post.scheduledAt, timeZone) === dayKey) return
    onReschedule(post, dayKey)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous month"
          className="inline-flex min-h-8 items-center justify-center rounded border border-border px-3"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setYm({ year: baseYear, month: baseMonth })}
          aria-label="Today"
          className="inline-flex min-h-8 items-center justify-center rounded border border-border px-3"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next month"
          className="inline-flex min-h-8 items-center justify-center rounded border border-border px-3"
        >
          ›
        </button>
        <h2 aria-live="polite" className="ml-2 font-semibold">
          {title}
        </h2>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActivePost(null)}
      >
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Scheduled posts for {title}</caption>
          <thead>
            <tr>
              {WEEKDAYS_SHORT.map((d, i) => (
                <th key={d} scope="col" className="border border-border p-1 text-xs font-medium">
                  <span aria-hidden="true">{d}</span>
                  <span className="sr-only">{WEEKDAYS_FULL[i]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((cell) => (
                  <Cell
                    key={cell.dayKey}
                    cell={cell}
                    monthLabel={title}
                    timeZone={timeZone}
                    onSelectPost={onSelectPost}
                    onSelectDay={onSelectDay}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <DragOverlay dropAnimation={null}>
          {activePost ? <DragOverlayChip post={activePost} timeZone={timeZone} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
