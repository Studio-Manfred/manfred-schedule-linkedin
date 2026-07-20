import { TZDate } from '@date-fns/tz'
import { TIMEZONE, type Slot } from './types'

/** ISO weekday (0 = Monday … 6 = Sunday) of a TZDate. */
function isoWeekday(d: TZDate): number {
  return (d.getDay() + 6) % 7
}

/**
 * Upcoming UTC instants of the weekly slots strictly after `after`, sorted,
 * at most `count`. DST-safe: slots are wall-clock times in Europe/Stockholm.
 */
export function slotOccurrences(slots: Slot[], after: Date, count: number): Date[] {
  if (slots.length === 0 || count === 0) return []
  const out: Date[] = []
  const start = new TZDate(after, TIMEZONE)
  // Worst case one slot/week: scan enough days to find `count` occurrences.
  const maxDays = count * 7 + 7
  for (let offset = 0; offset <= maxDays && out.length < count * 2; offset++) {
    const day = new TZDate(start.getFullYear(), start.getMonth(), start.getDate() + offset, TIMEZONE)
    const todays = slots
      .filter((s) => s.weekday === isoWeekday(day))
      .sort((a, b) => a.timeLocal.localeCompare(b.timeLocal))
    for (const s of todays) {
      const [hh = 0, mm = 0] = s.timeLocal.split(':').map(Number)
      const occ = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, TIMEZONE)
      if (occ.getTime() > after.getTime()) out.push(new Date(occ.getTime()))
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, count)
}

/**
 * Deal queued (non-pinned) posts, in queue order, onto the next free slot
 * occurrences. Occurrences exactly matching a pinned post's time are skipped.
 * Returns postId -> UTC instant. Empty map when no slots are configured.
 */
export function dealSchedule(args: {
  slots: Slot[]
  queuedIds: string[]
  pinnedTimes: Date[]
  now: Date
}): Map<string, Date> {
  const { slots, queuedIds, pinnedTimes, now } = args
  const result = new Map<string, Date>()
  if (slots.length === 0 || queuedIds.length === 0) return result
  const taken = new Set(pinnedTimes.map((t) => t.getTime()))
  const occs = slotOccurrences(slots, now, queuedIds.length + pinnedTimes.length)
  let i = 0
  for (const id of queuedIds) {
    while (i < occs.length && taken.has(occs[i]!.getTime())) i++
    const occ = occs[i]
    if (!occ) break
    result.set(id, occ)
    i++
  }
  return result
}
