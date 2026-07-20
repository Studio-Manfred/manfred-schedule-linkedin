// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildMonthGrid, rescheduleIso, stockholmDayKey, stockholmTime } from './calendar'
import type { Post } from './types'

const TZ = 'Europe/Stockholm'
function post(id: string, scheduledAt: string | null, extra: Partial<Post> = {}): Post {
  return {
    id,
    body: `body ${id}`,
    images: [],
    firstComment: null,
    status: 'queued',
    pinned: false,
    position: 0,
    scheduledAt,
    zernioPostId: null,
    linkedinUrl: null,
    error: null,
    attempts: 0,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

describe('stockholmDayKey / stockholmTime', () => {
  it('maps a UTC instant to the Stockholm civil day and time', () => {
    // 06:30 UTC in summer (UTC+2) = 08:30 Stockholm
    expect(stockholmDayKey('2026-07-20T06:30:00.000Z', TZ)).toBe('2026-07-20')
    expect(stockholmTime('2026-07-20T06:30:00.000Z', TZ)).toBe('08:30')
  })
  it('shifts to the next day when the instant crosses midnight in Stockholm', () => {
    // 22:30 UTC summer = 00:30 next day Stockholm
    expect(stockholmDayKey('2026-07-20T22:30:00.000Z', TZ)).toBe('2026-07-21')
  })
})

describe('rescheduleIso', () => {
  it('keeps the Stockholm time of day and recomputes the DST offset for the target date', () => {
    const p = post('a', '2026-07-20T06:30:00.000Z') // 08:30 Stockholm summer
    // 08:30 Stockholm in December is UTC+1 -> 07:30Z
    expect(rescheduleIso(p, '2026-12-15', TZ)).toBe('2026-12-15T07:30:00.000Z')
  })
  it('defaults to 09:00 Stockholm when the post has no scheduledAt', () => {
    const p = post('a', null)
    expect(rescheduleIso(p, '2026-07-20', TZ)).toBe('2026-07-20T07:00:00.000Z') // 09:00 summer = 07:00Z
  })
})

describe('buildMonthGrid', () => {
  const now = new Date('2026-07-15T09:00:00.000Z')
  it('produces 6 weeks x 7 Monday-first days for Sep 2021', () => {
    const g = buildMonthGrid(2021, 8, [], { now, timeZone: TZ }) // month 8 = September
    expect(g.weeks).toHaveLength(6)
    expect(g.weeks.every((w) => w.length === 7)).toBe(true)
    // 1 Sep 2021 is a Wednesday -> Monday-first row 1 starts Mon 30 Aug
    expect(g.weeks[0]![0]!.dayKey).toBe('2021-08-30')
    expect(g.weeks[0]![2]!.dayKey).toBe('2021-09-01')
    expect(g.weeks[0]![0]!.inCurrentMonth).toBe(false)
    expect(g.weeks[0]![2]!.inCurrentMonth).toBe(true)
  })
  it('flags today and past days relative to Stockholm now', () => {
    const g = buildMonthGrid(2026, 6, [], { now, timeZone: TZ }) // July 2026
    const cells = g.weeks.flat()
    expect(cells.find((c) => c.dayKey === '2026-07-15')!.isToday).toBe(true)
    expect(cells.find((c) => c.dayKey === '2026-07-14')!.isPast).toBe(true)
    expect(cells.find((c) => c.dayKey === '2026-07-16')!.isPast).toBe(false)
  })
  it('buckets dated posts onto their Stockholm day, sorted by time, excluding drafts', () => {
    const posts = [
      post('late', '2026-07-16T10:00:00.000Z'),
      post('early', '2026-07-16T06:00:00.000Z'),
      post('draft', null, { status: 'draft' }),
      post('shift', '2026-07-16T22:30:00.000Z'), // -> 2026-07-17 Stockholm
    ]
    const g = buildMonthGrid(2026, 6, posts, { now, timeZone: TZ })
    const cells = g.weeks.flat()
    const d16 = cells.find((c) => c.dayKey === '2026-07-16')!
    expect(d16.posts.map((p) => p.id)).toEqual(['early', 'late'])
    const d17 = cells.find((c) => c.dayKey === '2026-07-17')!
    expect(d17.posts.map((p) => p.id)).toEqual(['shift'])
    expect(cells.flatMap((c) => c.posts).some((p) => p.id === 'draft')).toBe(false)
  })
})
