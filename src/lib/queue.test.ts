import { describe, expect, it } from 'vitest'
import { dealSchedule, slotOccurrences } from './queue'
import type { Slot } from './types'

const slot = (id: number, weekday: number, timeLocal: string): Slot => ({ id, weekday, timeLocal })

// Mon 2026-07-20 12:00 Stockholm (CEST, UTC+2)
const MON_NOON = new Date('2026-07-20T10:00:00Z')

describe('slotOccurrences', () => {
  it('generates upcoming occurrences in order for Tue/Thu 08:30 slots', () => {
    const occs = slotOccurrences([slot(1, 1, '08:30'), slot(2, 3, '08:30')], MON_NOON, 3)
    expect(occs.map((d) => d.toISOString())).toEqual([
      '2026-07-21T06:30:00.000Z', // Tue 08:30 CEST
      '2026-07-23T06:30:00.000Z', // Thu 08:30 CEST
      '2026-07-28T06:30:00.000Z', // next Tue
    ])
  })

  it('skips a slot time already in the past today', () => {
    // Tue 09:00 Stockholm — today's 08:30 Tue slot has passed
    const tueMorning = new Date('2026-07-21T07:00:00Z')
    const occs = slotOccurrences([slot(1, 1, '08:30')], tueMorning, 1)
    expect(occs[0]?.toISOString()).toBe('2026-07-28T06:30:00.000Z')
  })

  it('keeps 08:30 local time across the October DST transition', () => {
    // Thu 2026-10-22; DST ends Sun 2026-10-25 in Europe/Stockholm
    const now = new Date('2026-10-22T12:00:00Z')
    const occs = slotOccurrences([slot(1, 4, '08:30'), slot(2, 1, '08:30')], now, 2)
    expect(occs.map((d) => d.toISOString())).toEqual([
      '2026-10-23T06:30:00.000Z', // Fri 08:30 CEST (UTC+2)
      '2026-10-27T07:30:00.000Z', // Tue 08:30 CET (UTC+1)
    ])
  })

  it('returns empty when no slots are configured', () => {
    expect(slotOccurrences([], MON_NOON, 5)).toEqual([])
  })
})

describe('dealSchedule', () => {
  const tueThu = [slot(1, 1, '08:30'), slot(2, 3, '08:30')]

  it('deals queued posts onto the next free slots in order', () => {
    const result = dealSchedule({ slots: tueThu, queuedIds: ['a', 'b'], pinnedTimes: [], now: MON_NOON })
    expect(result.get('a')?.toISOString()).toBe('2026-07-21T06:30:00.000Z')
    expect(result.get('b')?.toISOString()).toBe('2026-07-23T06:30:00.000Z')
  })

  it('skips slot occurrences taken by pinned posts', () => {
    const pinned = new Date('2026-07-21T06:30:00Z') // occupies Tue slot
    const result = dealSchedule({ slots: tueThu, queuedIds: ['a'], pinnedTimes: [pinned], now: MON_NOON })
    expect(result.get('a')?.toISOString()).toBe('2026-07-23T06:30:00.000Z')
  })

  it('returns an empty map when no slots are configured', () => {
    const result = dealSchedule({ slots: [], queuedIds: ['a'], pinnedTimes: [], now: MON_NOON })
    expect(result.size).toBe(0)
  })
})
