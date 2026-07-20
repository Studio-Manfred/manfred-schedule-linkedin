import { TZDate } from '@date-fns/tz'
import { TIMEZONE, type Post } from './types'

export interface DayCell {
  dayKey: string // 'YYYY-MM-DD' Stockholm civil day
  dayOfMonth: number
  inCurrentMonth: boolean
  isToday: boolean
  isPast: boolean
  posts: Post[] // Stockholm scheduled day == dayKey, sorted by time asc
}

export interface MonthGrid {
  year: number
  month: number // 0..11
  weeks: DayCell[][] // 6 x 7, Monday-first
}

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m1to12: number, d: number) => `${y}-${pad(m1to12)}-${pad(d)}`

export function stockholmDayKey(iso: string, timeZone: string = TIMEZONE): string {
  const z = new TZDate(new Date(iso), timeZone)
  return keyOf(z.getFullYear(), z.getMonth() + 1, z.getDate())
}

export function stockholmTime(iso: string, timeZone: string = TIMEZONE): string {
  const z = new TZDate(new Date(iso), timeZone)
  return `${pad(z.getHours())}:${pad(z.getMinutes())}`
}

/**
 * The UTC instant for rescheduling `post` onto Stockholm civil day `targetDayKey`
 * ('YYYY-MM-DD') while keeping its current Stockholm time of day. DST-correct.
 * Falls back to 09:00 Stockholm when the post has no scheduledAt.
 */
export function rescheduleIso(post: Post, targetDayKey: string, timeZone: string = TIMEZONE): string {
  const [y, m, d] = targetDayKey.split('-').map(Number)
  let hh = 9
  let mm = 0
  if (post.scheduledAt) {
    const z = new TZDate(new Date(post.scheduledAt), timeZone)
    hh = z.getHours()
    mm = z.getMinutes()
  }
  // Normalise to the canonical UTC 'Z' form (TZDate.toISOString keeps the zone offset).
  return new Date(new TZDate(y!, m! - 1, d!, hh, mm, timeZone).getTime()).toISOString()
}

export function buildMonthGrid(
  year: number,
  month: number,
  posts: Post[],
  opts: { now: Date; timeZone?: string },
): MonthGrid {
  const timeZone = opts.timeZone ?? TIMEZONE
  const todayKey = stockholmDayKey(opts.now.toISOString(), timeZone)

  const byDay = new Map<string, Post[]>()
  for (const p of posts) {
    if (!p.scheduledAt) continue
    const key = stockholmDayKey(p.scheduledAt, timeZone)
    const arr = byDay.get(key) ?? []
    arr.push(p)
    byDay.set(key, arr)
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
  }

  // Grid skeleton via UTC civil arithmetic (a timezone-independent integer calendar).
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday-first leading days
  const weeks: DayCell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = []
    for (let dow = 0; dow < 7; dow++) {
      const cd = new Date(Date.UTC(year, month, 1 - lead + w * 7 + dow))
      const cy = cd.getUTCFullYear()
      const cm = cd.getUTCMonth()
      const cdd = cd.getUTCDate()
      const key = keyOf(cy, cm + 1, cdd)
      row.push({
        dayKey: key,
        dayOfMonth: cdd,
        inCurrentMonth: cm === month,
        isToday: key === todayKey,
        isPast: key < todayKey,
        posts: byDay.get(key) ?? [],
      })
    }
    weeks.push(row)
  }
  return { year, month, weeks }
}
