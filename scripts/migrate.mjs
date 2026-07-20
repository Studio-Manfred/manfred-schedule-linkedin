#!/usr/bin/env node
import { neon } from '@neondatabase/serverless'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}
const sql = neon(url)

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
)`

const dir = path.join(import.meta.dirname, '..', 'migrations')
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

for (const file of files) {
  const done = await sql`SELECT 1 FROM schema_migrations WHERE name = ${file}`
  if (done.length > 0) {
    console.log(`skip  ${file}`)
    continue
  }
  const body = await readFile(path.join(dir, file), 'utf8')
  // neon() runs one statement per call — split on ';' at line ends
  for (const stmt of body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await sql.query(stmt)
  }
  await sql`INSERT INTO schema_migrations (name) VALUES (${file})`
  console.log(`apply ${file}`)
}
console.log('migrations complete')
