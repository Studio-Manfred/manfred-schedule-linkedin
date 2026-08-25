/** Helpers for the composer's "pin to a specific date & time" control. */

/** Every half hour of the day as "HH:mm" — the pin time options. */
export const HALF_HOUR_TIMES: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

/**
 * Combine a calendar date and a "HH:mm" time into an ISO instant, interpreting
 * the wall-clock in the browser's local timezone (matching the old
 * `datetime-local` input's `new Date("YYYY-MM-DDTHH:mm")` behavior).
 */
export function combinePinDateTime(date: Date, time: string): string {
  const [hh, mm] = time.split(':')
  const d = new Date(date)
  d.setHours(Number(hh), Number(mm), 0, 0)
  return d.toISOString()
}

/** Floor a "HH:mm" to the nearest earlier half hour (":00" or ":30"), no hour rollover. */
export function snapToHalfHour(time: string): string {
  const [hh, mm] = time.split(':')
  return `${(hh ?? '00').padStart(2, '0')}:${Number(mm) < 30 ? '00' : '30'}`
}
