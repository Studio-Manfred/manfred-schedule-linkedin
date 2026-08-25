import { sql } from './db.js'

export interface User {
  id: string
  googleSub: string | null
  email: string
  name: string | null
  zernioAccountId: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToUser(r: any): User {
  return {
    id: r.id,
    googleSub: r.google_sub ?? null,
    email: r.email,
    name: r.name ?? null,
    zernioAccountId: r.zernio_account_id ?? null,
  }
}

export async function upsertUserByEmail(
  email: string,
  googleSub: string,
  name: string | null,
): Promise<User> {
  const rows = (await sql()`
    INSERT INTO users (email, google_sub, name)
    VALUES (${email}, ${googleSub}, ${name})
    ON CONFLICT (email) DO UPDATE
      SET google_sub = EXCLUDED.google_sub,
          name = COALESCE(EXCLUDED.name, users.name),
          updated_at = now()
    RETURNING *`) as any[]
  return rowToUser(rows[0])
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = (await sql()`SELECT * FROM users WHERE id = ${id}`) as any[]
  return rows[0] ? rowToUser(rows[0]) : null
}

export async function setZernioConnection(userId: string, apiKeyEnc: string, accountId: string): Promise<void> {
  await sql()`UPDATE users SET zernio_api_key_enc = ${apiKeyEnc}, zernio_account_id = ${accountId}, updated_at = now() WHERE id = ${userId}`
}

export async function clearZernioConnection(userId: string): Promise<void> {
  await sql()`UPDATE users SET zernio_api_key_enc = NULL, zernio_account_id = NULL, updated_at = now() WHERE id = ${userId}`
}

export async function getZernioCreds(userId: string): Promise<{ apiKeyEnc: string; accountId: string } | null> {
  const rows = (await sql()`SELECT zernio_api_key_enc, zernio_account_id FROM users WHERE id = ${userId}`) as any[]
  const r = rows[0]
  if (!r || !r.zernio_api_key_enc || !r.zernio_account_id) return null
  return { apiKeyEnc: r.zernio_api_key_enc, accountId: r.zernio_account_id }
}
