import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, afterAll, beforeAll, vi } from 'vitest'

// Freeze the wall clock for the whole unit suite so coverage — and any Date-dependent
// branch (calendar month grid, next-slot scheduling) — is deterministic regardless of the
// machine/CI date. Two source modules fall back to the real clock (MonthCalendar's
// `now ?? new Date()`, ComposerScreen's `dealSchedule({ now: new Date() })`); without a
// pinned clock their past/future branches flip as real time advances, drifting branch
// coverage and eventually tripping the ratchet on an unrelated PR. Only `Date` is faked —
// real timers stay intact so user-event and Testing Library's async helpers behave
// normally (and their fake-timer detection stays off). Instant matches the one
// MonthCalendar.test already pins. See STU-687.
const FIXED_NOW = new Date('2026-07-15T09:00:00.000Z')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterAll(() => {
  vi.useRealTimers()
})

afterEach(() => {
  cleanup()
})
