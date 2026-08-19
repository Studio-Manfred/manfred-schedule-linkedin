import type { Post, PostImage, Slot } from '@/lib/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body && !(init.body instanceof File) ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    window.location.assign('/login')
    throw new ApiError(401, 'unauthorized')
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, data.error ?? `request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface Me {
  email: string
  name: string | null
  linkedinConnected: boolean
}

export const api = {
  async logout(): Promise<void> {
    await request<void>('/api/auth/logout', { method: 'POST' })
  },
  async me(): Promise<Me | null> {
    const res = await fetch('/api/auth/me')
    return res.ok ? ((await res.json()) as Me) : null
  },
  async listPosts(): Promise<Post[]> {
    return (await request<{ posts: Post[] }>('/api/posts')).posts
  },
  async createPost(input: { body: string; images: PostImage[]; firstComment?: string; action: 'draft' | 'queue' | 'pin'; scheduledAt?: string }): Promise<Post> {
    return (await request<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify(input) })).post
  },
  async updatePost(id: string, patch: { body?: string; images?: PostImage[]; firstComment?: string; action?: 'draft' | 'queue' | 'pin'; scheduledAt?: string }): Promise<Post> {
    return (await request<{ post: Post }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).post
  },
  async deletePost(id: string): Promise<void> {
    await request<void>(`/api/posts/${id}`, { method: 'DELETE' })
  },
  async reorder(orderedIds: string[]): Promise<Post[]> {
    return (await request<{ posts: Post[] }>('/api/posts/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) })).posts
  },
  async retry(id: string): Promise<Post> {
    return (await request<{ post: Post }>(`/api/posts/${id}/retry`, { method: 'POST' })).post
  },
  async getSlots(): Promise<Slot[]> {
    return (await request<{ slots: Slot[] }>('/api/slots')).slots
  },
  async putSlots(slots: { weekday: number; timeLocal: string }[]): Promise<Slot[]> {
    return (await request<{ slots: Slot[] }>('/api/slots', { method: 'PUT', body: JSON.stringify({ slots }) })).slots
  },
  async uploadImage(file: File): Promise<string> {
    const res = await fetch(`/api/images?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (res.status === 401) {
      window.location.assign('/login')
      throw new ApiError(401, 'unauthorized')
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, data.error ?? 'upload failed')
    }
    return ((await res.json()) as { url: string }).url
  },
  async getConnection(): Promise<{ connected: boolean; accountName: string | null }> {
    return request('/api/connection')
  },
}
