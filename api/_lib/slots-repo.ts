import type { Slot } from '../../src/lib/types'
import { sql } from './db'

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listSlots(): Promise<Slot[]> {
  const rows = (await sql()`SELECT id, weekday, time_local FROM schedule_slots ORDER BY weekday, time_local`) as any[]
  return rows.map((r) => ({ id: r.id, weekday: r.weekday, timeLocal: r.time_local }))
}

export async function replaceSlots(slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]> {
  const sqlc = sql()
  await sqlc.transaction([
    sqlc`DELETE FROM schedule_slots`,
    ...slots.map((s) => sqlc`INSERT INTO schedule_slots (weekday, time_local) VALUES (${s.weekday}, ${s.timeLocal})`),
  ])
  return listSlots()
}
