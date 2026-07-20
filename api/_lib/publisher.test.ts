// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ZernioPublisher } from './publisher'

function makeFetch(routes: Record<string, (url: string, init?: RequestInit) => Response>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [prefix, respond] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return respond(url, init)
    }
    throw new Error(`unmatched fetch: ${url}`)
  }) as unknown as typeof fetch
}

const BASE = 'https://zernio.test/api/v1'
const opts = { apiKey: 'sk_test', accountId: 'acc_1', baseUrl: BASE }
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

describe('ZernioPublisher', () => {
  it('publishes a text post with publishNow and x-request-id', async () => {
    const fetchImpl = makeFetch({
      [`${BASE}/posts`]: (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.publishNow).toBe(true)
        expect(body.content).toBe('hello')
        expect(body.platforms).toEqual([{ platform: 'linkedin', accountId: 'acc_1' }])
        expect(new Headers(init?.headers).get('x-request-id')).toBe('post-uuid-1')
        return json(201, { post: { _id: 'zp_1', platforms: [{ platform: 'linkedin', platformPostUrl: 'https://linkedin.com/x' }] } })
      },
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({ requestId: 'post-uuid-1', body: 'hello', images: [] })
    expect(result).toEqual({ ok: true, zernioPostId: 'zp_1', linkedinUrl: 'https://linkedin.com/x' })
  })

  it('attaches a first comment as LinkedIn platformSpecificData when provided', async () => {
    const fetchImpl = makeFetch({
      [`${BASE}/posts`]: (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.platforms).toEqual([
          {
            platform: 'linkedin',
            accountId: 'acc_1',
            platformSpecificData: { firstComment: 'Read more: https://x.dev' },
          },
        ])
        return json(201, { post: { _id: 'zp_fc', platforms: [] } })
      },
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({
      requestId: 'r-fc',
      body: 'see comments for links',
      images: [],
      firstComment: 'Read more: https://x.dev',
    })
    expect(result.ok).toBe(true)
  })

  it('omits platformSpecificData when the first comment is empty or null', async () => {
    const fetchImpl = makeFetch({
      [`${BASE}/posts`]: (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.platforms).toEqual([{ platform: 'linkedin', accountId: 'acc_1' }])
        return json(201, { post: { _id: 'zp_nofc', platforms: [] } })
      },
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    expect((await pub.publish({ requestId: 'r-e', body: 'x', images: [], firstComment: '' })).ok).toBe(true)
    expect((await pub.publish({ requestId: 'r-n', body: 'x', images: [], firstComment: null })).ok).toBe(true)
  })

  it('uploads images via presign before posting and passes altText', async () => {
    const calls: string[] = []
    const fetchImpl = makeFetch({
      [`${BASE}/media/presign`]: () => {
        calls.push('presign')
        return json(200, { uploadUrl: 'https://storage.test/put1', publicUrl: 'https://media.test/img1.png' })
      },
      'https://storage.test/put1': (_url, init) => {
        calls.push('upload')
        expect(init?.method).toBe('PUT')
        return new Response(null, { status: 200 })
      },
      'https://blob.test/img1.png': () => {
        calls.push('download')
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      },
      [`${BASE}/posts`]: (_url, init) => {
        calls.push('post')
        const body = JSON.parse(String(init?.body))
        expect(body.mediaItems).toEqual([{ url: 'https://media.test/img1.png', type: 'image', altText: 'a chart' }])
        return json(201, { post: { _id: 'zp_2', platforms: [] } })
      },
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({
      requestId: 'r2',
      body: 'with image',
      images: [{ url: 'https://blob.test/img1.png', alt: 'a chart', contentType: 'image/png' }],
    })
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['presign', 'download', 'upload', 'post'])
  })

  it('treats 409 content-hash dedup as success', async () => {
    const fetchImpl = makeFetch({
      [`${BASE}/posts`]: () => json(409, { error: 'duplicate', existingPostId: 'zp_dup' }),
    })
    const pub = new ZernioPublisher({ ...opts, fetchImpl })
    const result = await pub.publish({ requestId: 'r3', body: 'dup', images: [] })
    expect(result).toEqual({ ok: true, zernioPostId: 'zp_dup', linkedinUrl: null })
  })

  it('marks 5xx and network errors retryable, 4xx not retryable', async () => {
    const pub500 = new ZernioPublisher({
      ...opts,
      fetchImpl: makeFetch({ [`${BASE}/posts`]: () => json(500, { error: 'boom' }) }),
    })
    expect(await pub500.publish({ requestId: 'r4', body: 'x', images: [] })).toMatchObject({ ok: false, retryable: true })

    const pub400 = new ZernioPublisher({
      ...opts,
      fetchImpl: makeFetch({ [`${BASE}/posts`]: () => json(400, { error: 'bad content' }) }),
    })
    expect(await pub400.publish({ requestId: 'r5', body: 'x', images: [] })).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining('bad content') })

    const pubNet = new ZernioPublisher({
      ...opts,
      fetchImpl: (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch,
    })
    expect(await pubNet.publish({ requestId: 'r6', body: 'x', images: [] })).toMatchObject({ ok: false, retryable: true })
  })
})
