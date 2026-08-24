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
  const [apiKey, setApiKey] = useState('')
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null)
  const [chosen, setChosen] = useState<string>('')
  const [connBusy, setConnBusy] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)

  useEffect(() => {
    api.getSlots().then((slots) => setRows(slots.map(({ weekday, timeLocal }) => ({ weekday, timeLocal }))))
    api.getConnection().then(setConnection)
  }, [])

  async function refreshConnection() {
    setConnection(await api.getConnection())
  }
  async function findAccounts() {
    setConnError(null)
    setConnBusy(true)
    try {
      const { accounts } = await api.connectStart(apiKey)
      setAccounts(accounts)
      setChosen(accounts[0]?.id ?? '')
    } catch (e) {
      setConnError(e instanceof Error ? e.message : 'could not reach Zernio')
    } finally {
      setConnBusy(false)
    }
  }
  async function confirmConnect() {
    setConnError(null)
    setConnBusy(true)
    try {
      await api.connectConfirm(apiKey, chosen)
      setApiKey('')
      setAccounts(null)
      setChosen('')
      await refreshConnection()
    } catch (e) {
      setConnError(e instanceof Error ? e.message : 'connect failed')
    } finally {
      setConnBusy(false)
    }
  }
  async function disconnect() {
    setConnBusy(true)
    try {
      await api.disconnect()
      await refreshConnection()
    } finally {
      setConnBusy(false)
    }
  }

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

      <Card as="section" aria-labelledby="conn-h" className="flex flex-col gap-3">
        <h2 id="conn-h" className="font-medium">LinkedIn connection</h2>
        {connection === null ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : connection.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Connected via Zernio as <strong>{connection.accountName}</strong>
            </p>
            <Button type="button" variant="outline" className="ml-auto" onClick={disconnect} disabled={connBusy}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Bring your own LinkedIn: create a free{' '}
              <a href="https://zernio.com" target="_blank" rel="noreferrer" className="underline">Zernio</a>{' '}
              account, connect your LinkedIn there, then paste your Zernio API key
              (Settings → API Keys) below.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span>Zernio API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setAccounts(null) }}
                className="rounded-md border border-input bg-background px-3 py-2"
                autoComplete="off"
              />
            </label>
            {accounts === null ? (
              <div>
                <Button type="button" variant="brand" onClick={findAccounts} disabled={!apiKey || connBusy}>
                  Find my account
                </Button>
              </div>
            ) : accounts.length === 0 ? (
              <p role="alert" className="text-sm text-destructive">
                No LinkedIn account is connected in that Zernio account yet.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1 text-sm">
                  <span id="linkedin-account-label">LinkedIn account</span>
                  <Select value={chosen} onValueChange={setChosen}>
                    <SelectTrigger aria-labelledby="linkedin-account-label" className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="brand" onClick={confirmConnect} disabled={!chosen || connBusy}>
                  Connect
                </Button>
              </div>
            )}
            {connError && <p role="alert" className="text-sm text-destructive">{connError}</p>}
          </div>
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
