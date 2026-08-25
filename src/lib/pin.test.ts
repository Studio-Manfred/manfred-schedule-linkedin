import { describe, expect, it } from 'vitest'
import { HALF_HOUR_TIMES, combinePinDateTime, snapToHalfHour } from './pin'

describe('HALF_HOUR_TIMES', () => {
  it('lists every half hour of the day', () => {
    expect(HALF_HOUR_TIMES).toHaveLength(48)
    expect(HALF_HOUR_TIMES[0]).toBe('00:00')
    expect(HALF_HOUR_TIMES[1]).toBe('00:30')
    expect(HALF_HOUR_TIMES.at(-1)).toBe('23:30')
    expect(HALF_HOUR_TIMES).toContain('09:30')
  })
})

describe('combinePinDateTime', () => {
  // Asserts via local wall-clock round-trip so it's timezone-independent.
  it('combines a calendar date and a HH:mm time into an ISO instant', () => {
    const iso = combinePinDateTime(new Date(2026, 8, 18), '09:30') // 18 Sep 2026, local
    const back = new Date(iso)
    expect(back.getFullYear()).toBe(2026)
    expect(back.getMonth()).toBe(8) // September (0-indexed)
    expect(back.getDate()).toBe(18)
    expect(back.getHours()).toBe(9)
    expect(back.getMinutes()).toBe(30)
    expect(back.getSeconds()).toBe(0)
  })

  it('ignores any time-of-day already on the date argument', () => {
    const iso = combinePinDateTime(new Date(2026, 0, 5, 23, 45, 12), '07:00')
    const back = new Date(iso)
    expect(back.getDate()).toBe(5)
    expect(back.getHours()).toBe(7)
    expect(back.getMinutes()).toBe(0)
  })
})

describe('snapToHalfHour', () => {
  it('floors minutes to :00 or :30 (no hour rollover)', () => {
    expect(snapToHalfHour('09:00')).toBe('09:00')
    expect(snapToHalfHour('09:17')).toBe('09:00')
    expect(snapToHalfHour('09:30')).toBe('09:30')
    expect(snapToHalfHour('09:45')).toBe('09:30')
    expect(snapToHalfHour('23:59')).toBe('23:30')
  })
})
