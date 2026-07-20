import { useEffect, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface SlotRow {
  weekday: number
  timeLocal: string
}

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const [rows, setRows] = useState<SlotRow[]>([])
  const [connection, setConnection] = useState<{ connected: boolean; accountName: string | null } | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSlots().then((slots) => setRows(slots.map(({ weekday, timeLocal }) => ({ weekday, timeLocal }))))
    api.getConnection().then(setConnection)
  }, [])

  function update(i: number, patch: Partial<SlotRow>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setSaved(false)
  }

  async function save() {
    setError(null)
    try {
      await api.putSlots(rows)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    }
  }

  async function logout() {
    await api.logout()
    onLogout()
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section aria-labelledby="schedule-h" className="flex flex-col gap-3">
        <h2 id="schedule-h" className="font-medium">Posting schedule (Europe/Stockholm)</h2>
        <ul className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={i} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`wd-${i}`}>Weekday</label>
              <select
                id={`wd-${i}`}
                value={row.weekday}
                onChange={(e) => update(i, { weekday: Number(e.target.value) })}
                className="rounded-md border border-input bg-background px-3 py-2"
              >
                {WEEKDAYS.map((d, wd) => (
                  <option key={wd} value={wd}>{d}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`t-${i}`}>Time</label>
              <input
                id={`t-${i}`}
                type="time"
                value={row.timeLocal}
                onChange={(e) => update(i, { timeLocal: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2"
              />
              <Button type="button" variant="ghost" aria-label={`Remove slot ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <Button type="button" variant="ghost" onClick={() => setRows([...rows, { weekday: 0, timeLocal: '09:00' }])}>
            Add slot
          </Button>
          <Button type="button" variant="brand" onClick={save}>
            Save schedule
          </Button>
        </div>
        <p aria-live="polite">{saved ? 'Schedule saved. Queue times recomputed.' : ''}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </section>

      <section aria-labelledby="conn-h" className="flex flex-col gap-2">
        <h2 id="conn-h" className="font-medium">LinkedIn connection</h2>
        {connection === null ? (
          <p className="text-muted-foreground">Checking…</p>
        ) : connection.connected ? (
          <p>
            Connected via Zernio as <strong>{connection.accountName}</strong>
          </p>
        ) : (
          <p className="text-destructive">
            Not connected. Connect LinkedIn in the{' '}
            <a href="https://zernio.com" target="_blank" rel="noreferrer" className="underline">Zernio dashboard</a>{' '}
            and check ZERNIO_API_KEY / ZERNIO_ACCOUNT_ID env vars.
          </p>
        )}
      </section>

      <section aria-labelledby="sess-h" className="flex flex-col gap-2">
        <h2 id="sess-h" className="font-medium">Session</h2>
        <div>
          <Button type="button" variant="ghost" onClick={logout}>Log out</Button>
        </div>
      </section>
    </div>
  )
}
