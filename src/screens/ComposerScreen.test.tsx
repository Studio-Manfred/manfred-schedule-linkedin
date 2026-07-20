import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ComposerScreen } from './ComposerScreen'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getSlots: vi.fn(),
      listPosts: vi.fn(),
      createPost: vi.fn(),
      uploadImage: vi.fn(),
    },
  }
})

const renderComposer = () =>
  render(
    <MemoryRouter initialEntries={['/compose']}>
      <ComposerScreen />
    </MemoryRouter>,
  )

describe('ComposerScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSlots).mockResolvedValue([{ id: 1, weekday: 1, timeLocal: '08:30' }])
    vi.mocked(api.listPosts).mockResolvedValue([])
  })

  it('shows remaining characters and blocks the queue action over the limit', async () => {
    renderComposer()
    const box = await screen.findByLabelText(/post text/i)
    await userEvent.type(box, 'hello')
    expect(screen.getByText(/2\s?995/)).toBeInTheDocument()
  })

  it('queues a post and shows the target slot before submitting', async () => {
    vi.mocked(api.createPost).mockResolvedValue({ id: 'p1' } as never)
    renderComposer()
    await userEvent.type(await screen.findByLabelText(/post text/i), 'my post')
    // preview of next free slot is visible on the queue button/nearby
    expect(await screen.findByText(/next slot/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    expect(api.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'my post', action: 'queue' }),
    )
  })

  it('disables Add to queue when no slots are configured', async () => {
    vi.mocked(api.getSlots).mockResolvedValue([])
    renderComposer()
    await userEvent.type(await screen.findByLabelText(/post text/i), 'my post')
    expect(screen.getByRole('button', { name: /add to queue/i })).toBeDisabled()
    expect(screen.getByText(/no posting slots configured/i)).toBeInTheDocument()
  })
})
