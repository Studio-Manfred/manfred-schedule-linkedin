import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface SlotRow {
  weekday: number
  timeLocal: string
}

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const [rows, setRows] = useState<SlotRow[]>([])
  const [connection, setConnection] = useState<{ connected: boolean; accountName: string | null } | null>(
    null,
  )
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
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card as="section" aria-labelledby="schedule-h" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="schedule-h" className="font-medium">
            Posting schedule
          </h2>
          <p className="text-sm text-muted-foreground">
            Times are Europe/Stockholm. Queued posts fill the next free slot in order.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No slots yet. Add one below, or pin posts to an exact time in the composer.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3">
                <Select
                  value={String(row.weekday)}
                  onValueChange={(v) => update(i, { weekday: Number(v) })}
                >
                  <SelectTrigger aria-label={`Weekday for slot ${i + 1}`} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d, wd) => (
                      <SelectItem key={wd} value={String(wd)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="sr-only" htmlFor={`t-${i}`}>
                  Time for slot {i + 1}
                </label>
                <input
                  id={`t-${i}`}
                  type="time"
                  value={row.timeLocal}
                  onChange={(e) => update(i, { timeLocal: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Remove slot ${i + 1}`}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows([...rows, { weekday: 0, timeLocal: '09:00' }])}
          >
            Add slot
          </Button>
          <Button type="button" variant="brand" onClick={save}>
            Save schedule
          </Button>
        </div>

        <p aria-live="polite" className="text-sm text-muted-foreground">
          {saved ? 'Schedule saved. Queue times recomputed.' : ''}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </Card>

      <Card as="section" aria-labelledby="conn-h" className="flex flex-col gap-2">
        <h2 id="conn-h" className="font-medium">
          LinkedIn connection
        </h2>
        {connection === null ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : connection.connected ? (
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-green-500" />
            Connected via Zernio as <strong>{connection.accountName}</strong>
          </p>
        ) : (
          <p className="text-sm text-destructive">
            Not connected. Connect LinkedIn in the{' '}
            <a href="https://zernio.com" target="_blank" rel="noreferrer" className="underline">
              Zernio dashboard
            </a>{' '}
            and check the ZERNIO_API_KEY / ZERNIO_ACCOUNT_ID environment variables.
          </p>
        )}
      </Card>

      <Card as="section" aria-labelledby="sess-h" className="flex flex-col gap-3">
        <h2 id="sess-h" className="font-medium">
          Session
        </h2>
        <div>
          <Button type="button" variant="outline" onClick={logout}>
            Log out
          </Button>
        </div>
      </Card>
    </div>
  )
}
