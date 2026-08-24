import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      me: vi.fn(),
      logout: vi.fn(),
      listPosts: vi.fn(),
      getSlots: vi.fn(),
      getConnection: vi.fn(),
    },
  }
})

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPosts).mockResolvedValue([])
    vi.mocked(api.getSlots).mockResolvedValue([])
    vi.mocked(api.getConnection).mockResolvedValue({ connected: false, accountName: null })
  })

  it('shows the login screen when unauthenticated', async () => {
    vi.mocked(api.me).mockResolvedValue(null)
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('renders the DS header with nav landmark, links and logout when authenticated', async () => {
    vi.mocked(api.me).mockResolvedValue({ email: 'jens@studiomanfred.com', name: 'Jens Wedin', linkedinConnected: true })
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /queue/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manfred home/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument()
  })

  it('falls back to the email when the identity has no name', async () => {
    vi.mocked(api.me).mockResolvedValue({ email: 'jens@studiomanfred.com', name: null, linkedinConnected: false })
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.getByText('jens@studiomanfred.com')).toBeInTheDocument()
  })

  it('falls back to the login screen when api.me() rejects (e.g. a network failure)', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('network down'))
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument()
  })
})
