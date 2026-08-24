import type { Publisher } from './publisher.js'

export interface ResolveDeps {
  getZernioCreds(userId: string): Promise<{ apiKeyEnc: string; accountId: string } | null>
  getUserById(userId: string): Promise<{ email: string } | null>
  decrypt(payload: string): string
  makePublisher(opts: { apiKey: string; accountId: string }): Publisher
  env: { apiKey?: string; accountId?: string; fallbackEmail?: string }
}

/**
 * Resolve the publisher for one user: their own decrypted creds, else the env
 * fallback ONLY for the configured fallback-email user (jens), else null. Never
 * throws — a bad/undecryptable cred for one user yields null (their posts get
 * released) instead of aborting the whole tick.
 */
export async function resolvePublisher(userId: string, deps: ResolveDeps): Promise<Publisher | null> {
  try {
    const creds = await deps.getZernioCreds(userId)
    if (creds) return deps.makePublisher({ apiKey: deps.decrypt(creds.apiKeyEnc), accountId: creds.accountId })
  } catch {
    return null
  }
  const { apiKey, accountId, fallbackEmail } = deps.env
  if (apiKey && accountId && fallbackEmail) {
    const user = await deps.getUserById(userId)
    if (user && user.email.toLowerCase() === fallbackEmail.toLowerCase()) {
      return deps.makePublisher({ apiKey, accountId })
    }
  }
  return null
}
