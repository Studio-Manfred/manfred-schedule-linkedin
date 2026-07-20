// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { recomputeQueue } from './reschedule'
import type { Slot } from '../../src/lib/types'

const tueThu: Slot[] = [
  { id: 1, weekday: 1, timeLocal: '08:30' },
  { id: 2, weekday: 3, timeLocal: '08:30' },
]
const MON_NOON = new Date('2026-07-20T10:00:00Z')

function makeDeps(overrides: Partial<Parameters<typeof recomputeQueue>[0]> = {}) {
  return {
    listSlots: async () => tueThu,
    listQueuedUnpinnedIds: async () => ['a', 'b'],
    listPinnedFutureTimes: async () => [],
    saveSchedule: vi.fn(async () => {}),
    now: () => MON_NOON,
    ...overrides,
  }
}

describe('recomputeQueue', () => {
  it('deals queued posts onto slots and saves', async () => {
    const deps = makeDeps()
    await recomputeQueue(deps)
    expect(deps.saveSchedule).toHaveBeenCalledWith([
      { id: 'a', scheduledAt: new Date('2026-07-21T06:30:00Z') },
      { id: 'b', scheduledAt: new Date('2026-07-23T06:30:00Z') },
    ])
  })

  it('skips pinned-occupied occurrences', async () => {
    const deps = makeDeps({
      listQueuedUnpinnedIds: async () => ['a'],
      listPinnedFutureTimes: async () => [new Date('2026-07-21T06:30:00Z')],
    })
    await recomputeQueue(deps)
    expect(deps.saveSchedule).toHaveBeenCalledWith([{ id: 'a', scheduledAt: new Date('2026-07-23T06:30:00Z') }])
  })

  it('saves nothing when there are no slots', async () => {
    const deps = makeDeps({ listSlots: async () => [] })
    await recomputeQueue(deps)
    expect(deps.saveSchedule).toHaveBeenCalledWith([])
  })
})
