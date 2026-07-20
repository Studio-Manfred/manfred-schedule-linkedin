import { useState, type FormEvent } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api, ApiError } from '@/api/client'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Manfred Schedule</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" variant="brand" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </main>
  )
}
