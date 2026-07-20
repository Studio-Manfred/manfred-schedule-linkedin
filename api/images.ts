import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put } from '@vercel/blob'
import { methodIs, requireAuth, sendJson } from './_lib/http'

export const config = { api: { bodyParser: false } }

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodIs(req, res, 'POST')) return
  if (!requireAuth(req, res)) return
  const filename = String(req.query.filename ?? '')
  const contentType = req.headers['content-type'] ?? ''
  if (!filename) return sendJson(res, 422, { error: 'filename query param required' })
  if (!ALLOWED.has(contentType)) return sendJson(res, 422, { error: `unsupported image type: ${contentType}` })
  const blob = await put(`images/${Date.now()}-${filename}`, req, {
    access: 'public',
    contentType,
  })
  return sendJson(res, 201, { url: blob.url })
}
