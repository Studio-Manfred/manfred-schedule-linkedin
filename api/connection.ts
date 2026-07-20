import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireAuth, sendJson } from './_lib/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET')) return
  if (!requireAuth(req, res)) return
  const apiKey = process.env.ZERNIO_API_KEY
  const accountId = process.env.ZERNIO_ACCOUNT_ID
  if (!apiKey || !accountId) return sendJson(res, 200, { connected: false, accountName: null })
  try {
    const r = await fetch('https://zernio.com/api/v1/accounts', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!r.ok) return sendJson(res, 200, { connected: false, accountName: null })
    const data = (await r.json()) as { accounts?: { _id?: string; id?: string; platform?: string; name?: string; username?: string; displayName?: string }[] }
    const acct = (data.accounts ?? []).find((a) => (a._id ?? a.id) === accountId)
    return sendJson(res, 200, {
      connected: Boolean(acct),
      accountName: acct ? (acct.displayName ?? acct.name ?? acct.username ?? 'LinkedIn account') : null,
    })
  } catch {
    return sendJson(res, 200, { connected: false, accountName: null })
  }
}
