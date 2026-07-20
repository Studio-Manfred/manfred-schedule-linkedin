export interface PublishInput {
  requestId: string
  body: string
  images: { url: string; alt: string; contentType: string }[]
  /** Auto-posted as the first comment after publish (e.g. external links). */
  firstComment?: string | null
}

export type PublishResult =
  | { ok: true; zernioPostId: string; linkedinUrl: string | null }
  | { ok: false; retryable: boolean; error: string }

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>
}

interface ZernioOpts {
  apiKey: string
  accountId: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export class ZernioPublisher implements Publisher {
  private fetch: typeof fetch
  private base: string
  constructor(private opts: ZernioOpts) {
    this.fetch = opts.fetchImpl ?? fetch
    this.base = opts.baseUrl ?? 'https://zernio.com/api/v1'
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json', ...extra }
  }

  /** Blob URL -> Zernio temp storage publicUrl (presign, download, PUT). */
  private async uploadImage(img: PublishInput['images'][number]): Promise<string> {
    const presignRes = await this.fetch(`${this.base}/media/presign`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ filename: img.url.split('/').pop() ?? 'image', contentType: img.contentType }),
    })
    if (!presignRes.ok) throw new Error(`presign failed: ${presignRes.status}`)
    const { uploadUrl, publicUrl } = (await presignRes.json()) as { uploadUrl: string; publicUrl: string }
    const blob = await this.fetch(img.url)
    if (!blob.ok) throw new Error(`image download failed: ${blob.status}`)
    const put = await this.fetch(uploadUrl, {
      method: 'PUT',
      body: await blob.arrayBuffer(),
      headers: { 'Content-Type': img.contentType },
    })
    if (!put.ok) throw new Error(`image upload failed: ${put.status}`)
    return publicUrl
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const mediaItems = []
      for (const img of input.images) {
        mediaItems.push({ url: await this.uploadImage(img), type: 'image', altText: img.alt })
      }
      const firstComment = input.firstComment?.trim()
      const linkedin = {
        platform: 'linkedin',
        accountId: this.opts.accountId,
        ...(firstComment ? { platformSpecificData: { firstComment: input.firstComment } } : {}),
      }
      const res = await this.fetch(`${this.base}/posts`, {
        method: 'POST',
        headers: this.headers({ 'x-request-id': input.requestId }),
        body: JSON.stringify({
          content: input.body,
          ...(mediaItems.length > 0 ? { mediaItems } : {}),
          publishNow: true,
          platforms: [linkedin],
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status === 409) {
        // Content-hash dedup: identical content already went out within 24h.
        return { ok: true, zernioPostId: String(data.existingPostId ?? 'unknown'), linkedinUrl: null }
      }
      if (res.ok) {
        const post = data.post as { _id?: string; existingPost?: unknown; platforms?: { platform: string; platformPostUrl?: string }[] } | undefined
        const li = post?.platforms?.find((p) => p.platform === 'linkedin')
        return { ok: true, zernioPostId: post?._id ?? 'unknown', linkedinUrl: li?.platformPostUrl ?? null }
      }
      const message = typeof data.error === 'string' ? data.error : `zernio ${res.status}`
      return { ok: false, retryable: res.status >= 500, error: message }
    } catch (e) {
      return { ok: false, retryable: true, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
