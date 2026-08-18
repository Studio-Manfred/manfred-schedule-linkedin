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
