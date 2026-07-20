import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@studio-manfred/manfred-design-system'
import { api, ApiError } from '@/api/client'
import { dealSchedule } from '@/lib/queue'
import { MAX_BODY_LENGTH, TIMEZONE, type Post, type PostImage, type Slot } from '@/lib/types'
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
          setImages(post.images)
          if (post.pinned && post.scheduledAt) {
            const parts = new Intl.DateTimeFormat('sv-SE', {
              timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', hour12: false,
            }).formatToParts(new Date(post.scheduledAt))
            const p = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
            setPinAt(`${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`)
          }
        }
      }
    })
  }, [editId])

  const nextSlot = useMemo(() => {
    const queued = posts.filter((p) => p.status === 'queued' && !p.pinned && p.id !== editId).map((p) => p.id)
    const pinnedTimes = posts
      .filter((p) => p.status === 'queued' && p.pinned && p.scheduledAt && p.id !== editId)
      .map((p) => new Date(p.scheduledAt!))
    const dealt = dealSchedule({ slots, queuedIds: [...queued, 'new'], pinnedTimes, now: new Date() })
    return dealt.get('new') ?? null
  }, [slots, posts, editId])

  const remaining = MAX_BODY_LENGTH - body.length
  const altMissing = images.some((i) => i.alt.trim().length === 0)
  const invalid = body.trim().length === 0 || remaining < 0 || altMissing

  async function submit(action: 'draft' | 'queue' | 'pin', e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const input = {
        body,
        images,
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
    <form onSubmit={(e) => submit('queue', e)} className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{editId ? 'Edit post' : 'Compose'}</h1>
      <label className="flex flex-col gap-1">
        <span>Post text</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
        <span aria-live="polite" className={remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}>
          {remaining.toLocaleString('sv-SE')} characters left
        </span>
      </label>

      <ImageAttach images={images} onChange={setImages} />
      {altMissing && <p className="text-muted-foreground">Add alt text to every image before scheduling.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="brand" disabled={busy || invalid || slots.length === 0}>
          Add to queue
        </Button>
        {slots.length === 0 ? (
          <p className="text-muted-foreground">No posting slots configured — add slots in Settings or pin a time.</p>
        ) : (
          nextSlot && <p className="text-muted-foreground">Next slot: {fmt.format(nextSlot)}</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span>Pin to date &amp; time</span>
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
        <Button type="button" variant="ghost" disabled={busy || body.trim().length === 0} onClick={() => submit('draft')}>
          Save draft
        </Button>
      </div>
    </form>
  )
}
