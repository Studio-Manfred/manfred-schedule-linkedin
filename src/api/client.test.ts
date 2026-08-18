import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'
import type { Post, Slot } from '@/lib/types'

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const post: Post = {
  id: 'p1',
  body: 'hello',
  images: [],
  firstComment: null,
  status: 'draft',
  pinned: false,
  position: null,
  scheduledAt: null,
  zernioPostId: null,
  linkedinUrl: null,
  error: null,
  attempts: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const slot: Slot = { id: 1, weekday: 0, timeLocal: '08:30' }

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('logout', () => {
    it('POSTs to /api/auth/logout and resolves on 204', async () => {
      fetchMock.mockResolvedValueOnce(res(204))

      await expect(api.logout()).resolves.toBeUndefined()

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/auth/logout')
      expect(init.method).toBe('POST')
    })
  })

  describe('me', () => {
    it('returns the identity when /api/auth/me is ok', async () => {
      const identity = { email: 'jens@studiomanfred.com', name: 'Jens Wedin', linkedinConnected: true }
      fetchMock.mockResolvedValueOnce(res(200, identity))
      await expect(api.me()).resolves.toEqual(identity)
      expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/me')
    })

    it('returns null when /api/auth/me is not ok', async () => {
      fetchMock.mockResolvedValueOnce(res(401))
      await expect(api.me()).resolves.toBeNull()
    })
  })

  describe('listPosts', () => {
    it('GETs /api/posts and unwraps { posts } to the array', async () => {
      fetchMock.mockResolvedValueOnce(res(200, { posts: [post] }))

      await expect(api.listPosts()).resolves.toEqual([post])

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/posts')
      expect(init?.method).toBeUndefined()
    })
  })

  describe('createPost', () => {
    it('POSTs the input as JSON body and returns { post }', async () => {
      const input = { body: 'hello', images: [], action: 'draft' as const }
      fetchMock.mockResolvedValueOnce(res(200, { post }))

      await expect(api.createPost(input)).resolves.toEqual(post)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/posts')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(init.body).toBe(JSON.stringify(input))
    })
  })

  describe('updatePost', () => {
    it('PATCHes /api/posts/:id with JSON patch and returns { post }', async () => {
      const patch = { body: 'updated' }
      fetchMock.mockResolvedValueOnce(res(200, { post }))

      await expect(api.updatePost('p1', patch)).resolves.toEqual(post)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/posts/p1')
      expect(init.method).toBe('PATCH')
      expect(init.body).toBe(JSON.stringify(patch))
    })
  })

  describe('deletePost', () => {
    it('DELETEs /api/posts/:id and resolves undefined on 204', async () => {
      fetchMock.mockResolvedValueOnce(res(204))

      await expect(api.deletePost('p1')).resolves.toBeUndefined()

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/posts/p1')
      expect(init.method).toBe('DELETE')
    })
  })

  describe('reorder', () => {
    it('POSTs { orderedIds } and returns { posts }', async () => {
      fetchMock.mockResolvedValueOnce(res(200, { posts: [post] }))

      await expect(api.reorder(['p1', 'p2'])).resolves.toEqual([post])

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/posts/reorder')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ orderedIds: ['p1', 'p2'] }))
    })
  })

  describe('retry', () => {
    it('POSTs /api/posts/:id/retry and returns { post }', async () => {
      fetchMock.mockResolvedValueOnce(res(200, { post }))

      await expect(api.retry('p1')).resolves.toEqual(post)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/posts/p1/retry')
      expect(init.method).toBe('POST')
    })
  })

  describe('getSlots', () => {
    it('GETs /api/slots and unwraps { slots }', async () => {
      fetchMock.mockResolvedValueOnce(res(200, { slots: [slot] }))

      await expect(api.getSlots()).resolves.toEqual([slot])
      expect(fetchMock.mock.calls[0][0]).toBe('/api/slots')
    })
  })

  describe('putSlots', () => {
    it('PUTs { slots } and returns { slots }', async () => {
      const input = [{ weekday: 0, timeLocal: '08:30' }]
      fetchMock.mockResolvedValueOnce(res(200, { slots: [slot] }))

      await expect(api.putSlots(input)).resolves.toEqual([slot])

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/slots')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify({ slots: input }))
    })
  })

  describe('uploadImage', () => {
    it('POSTs the file as raw body with its type as Content-Type and returns the url', async () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
      fetchMock.mockResolvedValueOnce(res(200, { url: 'https://example.com/pic.png' }))

      await expect(api.uploadImage(file)).resolves.toBe('https://example.com/pic.png')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`/api/images?filename=${encodeURIComponent('pic.png')}`)
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ 'Content-Type': 'image/png' })
      expect(init.body).toBe(file)
    })

    describe('on 401', () => {
      let assignMock: ReturnType<typeof vi.fn>

      beforeEach(() => {
        assignMock = vi.fn()
        vi.stubGlobal('location', { ...window.location, assign: assignMock } as unknown as Location)
      })

      it('redirects to /login and throws ApiError(401)', async () => {
        const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })
        fetchMock.mockResolvedValueOnce(res(401))

        await expect(api.uploadImage(file)).rejects.toMatchObject({ status: 401 })
        expect(assignMock).toHaveBeenCalledWith('/login')
      })

      it('rejects with an ApiError instance', async () => {
        const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' })
        fetchMock.mockResolvedValueOnce(res(401))

        await expect(api.uploadImage(file)).rejects.toBeInstanceOf(ApiError)
      })
    })
  })

  describe('401 redirect for non-auth requests', () => {
    let assignMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      assignMock = vi.fn()
      vi.stubGlobal('location', { ...window.location, assign: assignMock } as unknown as Location)
    })

    it('a non-auth GET (listPosts) redirects to /login and throws ApiError(401)', async () => {
      fetchMock.mockResolvedValueOnce(res(401))

      await expect(api.listPosts()).rejects.toMatchObject({ status: 401, message: 'unauthorized' })
      expect(assignMock).toHaveBeenCalledWith('/login')
    })

    it('rejects with an ApiError instance', async () => {
      fetchMock.mockResolvedValueOnce(res(401))
      await expect(api.listPosts()).rejects.toBeInstanceOf(ApiError)
    })
  })
})
