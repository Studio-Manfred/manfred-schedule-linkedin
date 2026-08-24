import type { Slot } from '../../src/lib/types.js'
import { sql } from './db.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listSlots(userId: string): Promise<Slot[]> {
  const rows = (await sql()`SELECT id, weekday, time_local FROM schedule_slots WHERE user_id = ${userId} ORDER BY weekday, time_local`) as any[]
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, timeLocal: r.time_local }))
}

export async function replaceSlots(userId: string, slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]> {
  const sqlc = sql()
  await sqlc.transaction([
    sqlc`DELETE FROM schedule_slots WHERE user_id = ${userId}`,
    ...slots.map((s) => sqlc`INSERT INTO schedule_slots (user_id, weekday, time_local) VALUES (${userId}, ${s.weekday}, ${s.timeLocal})`),
  ])
  return listSlots(userId)
}
