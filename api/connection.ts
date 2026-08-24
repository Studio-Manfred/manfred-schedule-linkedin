import type { VercelRequest, VercelResponse } from '@vercel/node'
import { methodIs, requireUser, sendJson } from './_lib/http.js'
import { encrypt, decrypt } from './_lib/crypto.js'
import { getZernioCreds, setZernioConnection, clearZernioConnection } from './_lib/users-repo.js'
import { listZernioAccounts } from './_lib/zernio-accounts.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'GET', 'POST', 'DELETE')) return
  const userId = requireUser(req, res)
  if (!userId) return

  if (req.method === 'GET') {
    const creds = await getZernioCreds(userId)
    if (!creds) return sendJson(res, 200, { connected: false, accountName: null })
    try {
      const accounts = await listZernioAccounts(decrypt(creds.apiKeyEnc))
      const acct = accounts.find((a) => a.id === creds.accountId)
      return sendJson(res, 200, { connected: Boolean(acct), accountName: acct?.name ?? null })
    } catch {
      return sendJson(res, 200, { connected: false, accountName: null })
    }
  }

  if (req.method === 'DELETE') {
    await clearZernioConnection(userId)
    return res.status(204).end()
  }

  // POST — phase 1 (no accountId): list the key's accounts; phase 2 (accountId): store.
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  if (!apiKey) return sendJson(res, 422, { error: 'apiKey required' })
  const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : undefined

  let accounts: { id: string; name: string }[]
  try {
    accounts = await listZernioAccounts(apiKey)
  } catch (e) {
    return sendJson(res, 422, { error: e instanceof Error ? e.message : 'could not reach Zernio' })
  }
  if (accounts.length === 0) return sendJson(res, 422, { error: 'no LinkedIn account connected in this Zernio account' })

  if (!accountId) return sendJson(res, 200, { accounts })

  const chosen = accounts.find((a) => a.id === accountId)
  if (!chosen) return sendJson(res, 422, { error: 'accountId not found for this key' })
  await setZernioConnection(userId, encrypt(apiKey), chosen.id)
  return sendJson(res, 200, { connected: true, accountName: chosen.name })
}
