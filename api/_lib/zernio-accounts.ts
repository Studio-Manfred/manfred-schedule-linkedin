const BASE = 'https://zernio.com/api/v1'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Returns the key's LinkedIn accounts as {id, name}. Throws 'invalid Zernio API key' on 401. */
export async function listZernioAccounts(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  const r = await fetchImpl(`${BASE}/accounts`, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (r.status === 401) throw new Error('invalid Zernio API key')
  if (!r.ok) throw new Error(`Zernio accounts request failed (${r.status})`)
  const data = (await r.json()) as { accounts?: any[] }
  return (data.accounts ?? [])
    .filter((a) => (a.platform ?? '').toLowerCase() === 'linkedin')
    .map((a) => ({
      id: String(a._id ?? a.id),
      name: String(a.displayName ?? a.name ?? a.username ?? 'LinkedIn account'),
    }))
}
