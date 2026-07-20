import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card } from '@studio-manfred/manfred-design-system'
import { api, ApiError } from '@/api/client'
import { dealSchedule } from '@/lib/queue'
import {
  MAX_BODY_LENGTH,
  MAX_FIRST_COMMENT_LENGTH,
  TIMEZONE,
  type Post,
  type PostImage,
  type Slot,
} from '@/lib/types'
import { ImageAttach } from '@/components/ImageAttach'

const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function ComposerScreen() {
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const navigate = useNavigate()

  const [body, setBody] = useState('')
  const [firstComment, setFirstComment] = useState('')
  const [images, setImages] = useState<PostImage[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [pinAt, setPinAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.getSlots(), api.listPosts()]).then(([s, p]) => {
      setSlots(s)
      setPosts(p)
      if (editId) {
        const post = p.find((x) => x.id === editId)
        if (post) {
          setBody(post.body)
          setFirstComment(post.firstComment ?? '')
          setImages(post.images)
          if (post.pinned && post.scheduledAt) {
            const parts = new Intl.DateTimeFormat('sv-SE', {
              timeZone: TIMEZONE,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).formatToParts(new Date(post.scheduledAt))
            const at = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
            setPinAt(`${at('year')}-${at('month')}-${at('day')}T${at('hour')}:${at('minute')}`)
          }
        }
      }
    })
  }, [editId])

  // Pre-fill the pin datetime when arriving from the calendar's "add on this day".
  useEffect(() => {
    const pin = params.get('pin')
    if (!editId && pin && /^\d{4}-\d{2}-\d{2}$/.test(pin)) setPinAt(`${pin}T09:00`)
  }, [params, editId])

  const nextSlot = useMemo(() => {
    const queued = posts
      .filter((p) => p.status === 'queued' && !p.pinned && p.id !== editId)
      .map((p) => p.id)
    const pinnedTimes = posts
      .filter((p) => p.status === 'queued' && p.pinned && p.scheduledAt && p.id !== editId)
      .map((p) => new Date(p.scheduledAt!))
    const dealt = dealSchedule({ slots, queuedIds: [...queued, 'new'], pinnedTimes, now: new Date() })
    return dealt.get('new') ?? null
  }, [slots, posts, editId])

  const remaining = MAX_BODY_LENGTH - body.length
  const firstCommentRemaining = MAX_FIRST_COMMENT_LENGTH - firstComment.length
  const altMissing = images.some((i) => i.alt.trim().length === 0)
  const emptyBody = body.trim().length === 0
  const invalid = emptyBody || remaining < 0 || firstCommentRemaining < 0 || altMissing

  async function submit(action: 'draft' | 'queue' | 'pin') {
    setBusy(true)
    setError(null)
    try {
      const input = {
        body,
        images,
        firstComment,
        action,
        ...(action === 'pin' ? { scheduledAt: new Date(pinAt).toISOString() } : {}),
      }
      if (editId) await api.updatePost(editId, input)
      else await api.createPost(input)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{editId ? 'Edit post' : 'Compose'}</h1>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Post text</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span
            aria-live="polite"
            className={remaining < 0 ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
          >
            {remaining.toLocaleString('sv-SE')} characters left
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || emptyBody}
            onClick={() => submit('draft')}
          >
            Save draft
          </Button>
        </div>
      </div>

      <ImageAttach images={images} onChange={setImages} />

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">First comment (optional)</span>
          <textarea
            value={firstComment}
            onChange={(e) => setFirstComment(e.target.value)}
            rows={3}
            aria-describedby="first-comment-hint"
            placeholder="Read more: https://example.com"
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p id="first-comment-hint" className="text-sm text-muted-foreground">
            Auto-posted as the first comment right after publishing. Put links here — LinkedIn
            suppresses posts with links in the body.
          </p>
          {firstComment.length > 0 && (
            <span
              aria-live="polite"
              className={
                firstCommentRemaining < 0
                  ? 'shrink-0 text-sm text-destructive'
                  : 'shrink-0 text-sm text-muted-foreground'
              }
            >
              {firstCommentRemaining.toLocaleString('sv-SE')} left
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <Card as="section" aria-labelledby="schedule-heading" className="flex flex-col gap-4">
        <h2 id="schedule-heading" className="font-medium">
          Schedule this post
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="brand"
            disabled={busy || invalid || slots.length === 0}
            onClick={() => submit('queue')}
          >
            Add to queue
          </Button>
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No posting slots configured — add some in Settings, or pin a time below.
            </p>
          ) : (
            nextSlot && <p className="text-sm text-muted-foreground">Next slot: {fmt.format(nextSlot)}</p>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
          or
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Pin to a specific date &amp; time</span>
            <input
              type="datetime-local"
              value={pinAt}
              onChange={(e) => setPinAt(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </label>
          <Button type="button" disabled={busy || invalid || !pinAt} onClick={() => submit('pin')}>
            Pin
          </Button>
        </div>
      </Card>
    </form>
  )
}
