import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'

function key(): Buffer {
  const b64 = process.env.CRED_ENC_KEY
  if (!b64) throw new Error('CRED_ENC_KEY not set')
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('CRED_ENC_KEY must decode to 32 bytes')
  return k
}

/** Returns "ivB64.tagB64.dataB64". */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed ciphertext')
  const decipher = createDecipheriv(ALG, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
