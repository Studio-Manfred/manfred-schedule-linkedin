import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueueScreen } from './QueueScreen'
import { api } from '@/api/client'
import type { Post } from '@/lib/types'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, listPosts: vi.fn(), reorder: vi.fn(), deletePost: vi.fn() } }
})

const queued = (id: string, position: number, extra: Partial<Post> = {}): Post => ({
  id, body: `post ${id}`, images: [], status: 'queued', pinned: false, position,
  scheduledAt: `2026-07-2${1 + position}T06:30:00.000Z`, zernioPostId: null, linkedinUrl: null,
  error: null, attempts: 0, createdAt: '', updatedAt: '', ...extra,
})

describe('QueueScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPosts).mockResolvedValue([
      queued('a', 0),
      queued('b', 1),
      queued('pin', 0, { pinned: true, position: null }),
      queued('d', 0, { status: 'draft', scheduledAt: null }),
    ])
  })

  it('renders queued posts in order with dates and a pinned badge', async () => {
    render(<MemoryRouter><QueueScreen /></MemoryRouter>)
    const items = await screen.findAllByRole('listitem')
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(/post a/)).toBeInTheDocument()
    expect(screen.getByText(/pinned/i)).toBeInTheDocument()
  })

  it('moves a post down via keyboard button and calls reorder', async () => {
    vi.mocked(api.reorder).mockResolvedValue([])
    render(<MemoryRouter><QueueScreen /></MemoryRouter>)
    await screen.findByText(/post a/)
    const first = screen.getAllByRole('listitem')[0]!
    await userEvent.click(within(first).getByRole('button', { name: /move down/i }))
    expect(api.reorder).toHaveBeenCalledWith(['b', 'a'])
  })

  it('shows drafts under the Drafts tab', async () => {
    render(<MemoryRouter><QueueScreen /></MemoryRouter>)
    await screen.findByText(/post a/)
    await userEvent.click(screen.getByRole('tab', { name: /drafts/i }))
    expect(screen.getByText(/post d/)).toBeInTheDocument()
  })
})
