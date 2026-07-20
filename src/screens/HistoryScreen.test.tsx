import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HistoryScreen } from './HistoryScreen'
import { api } from '@/api/client'
import type { Post } from '@/lib/types'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, listPosts: vi.fn(), retry: vi.fn() } }
})

const base: Post = {
  id: 'x', body: '', images: [], status: 'published', pinned: false, position: null,
  scheduledAt: '2026-07-14T06:30:00.000Z', zernioPostId: 'z1', linkedinUrl: null,
  error: null, attempts: 1, createdAt: '', updatedAt: '',
}

describe('HistoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPosts).mockResolvedValue([
      { ...base, id: 'ok', body: 'went out', linkedinUrl: 'https://linkedin.com/feed/1' },
      { ...base, id: 'bad', body: 'broke', status: 'failed', error: 'zernio 500' },
    ])
  })

  it('shows published posts with the LinkedIn link and failed posts with the error', async () => {
    render(<MemoryRouter><HistoryScreen /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: /view on linkedin/i })).toHaveAttribute(
      'href',
      'https://linkedin.com/feed/1',
    )
    expect(screen.getByText(/zernio 500/)).toBeInTheDocument()
  })

  it('retries a failed post', async () => {
    vi.mocked(api.retry).mockResolvedValue({ ...base, id: 'bad', status: 'queued' })
    render(<MemoryRouter><HistoryScreen /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }))
    expect(api.retry).toHaveBeenCalledWith('bad')
  })
})
