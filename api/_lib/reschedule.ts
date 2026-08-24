import { dealSchedule } from '../../src/lib/queue.js'
import type { Slot } from '../../src/lib/types.js'
import * as postsRepo from './posts-repo.js'
import * as slotsRepo from './slots-repo.js'

export interface RescheduleDeps {
  listSlots(): Promise<Slot[]>
  listQueuedUnpinnedIds(): Promise<string[]>
  listPinnedFutureTimes(now: Date): Promise<Date[]>
  saveSchedule(entries: { id: string; scheduledAt: Date }[]): Promise<void>
  now(): Date
}

export async function recomputeQueue(deps: RescheduleDeps): Promise<void> {
  const now = deps.now()
  const [slots, queuedIds, pinnedTimes] = await Promise.all([
    deps.listSlots(),
    deps.listQueuedUnpinnedIds(),
    deps.listPinnedFutureTimes(now),
  ])
  const dealt = dealSchedule({ slots, queuedIds, pinnedTimes, now })
  await deps.saveSchedule([...dealt.entries()].map(([id, scheduledAt]) => ({ id, scheduledAt })))
}

/** Production wiring — call after any queue mutation, scoped to one user. */
export function recomputeQueueLive(userId: string): Promise<void> {
  return recomputeQueue({
    listSlots: () => slotsRepo.listSlots(userId),
    listQueuedUnpinnedIds: () => postsRepo.listQueuedUnpinnedIds(userId),
    listPinnedFutureTimes: (now) => postsRepo.listPinnedFutureTimes(userId, now),
    saveSchedule: (entries) => postsRepo.saveSchedule(userId, entries),
    now: () => new Date(),
  })
}
