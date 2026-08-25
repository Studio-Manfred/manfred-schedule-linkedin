import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsScreen } from './SettingsScreen'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getSlots: vi.fn(),
      putSlots: vi.fn(),
      getConnection: vi.fn(),
      logout: vi.fn(),
      connectStart: vi.fn(),
      connectConfirm: vi.fn(),
      disconnect: vi.fn(),
    },
  }
})

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getSlots).mockResolvedValue([{ id: 1, weekday: 1, timeLocal: '08:30' }])
    vi.mocked(api.getConnection).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
  })

  it('lists slots and the connected account', async () => {
    render(<SettingsScreen onLogout={vi.fn()} />)
    expect(await screen.findByDisplayValue('08:30')).toBeInTheDocument()
    expect(screen.getByText(/jens wedin/i)).toBeInTheDocument()
  })

  it('adds a slot and saves the full set', async () => {
    vi.mocked(api.putSlots).mockResolvedValue([])
    render(<SettingsScreen onLogout={vi.fn()} />)
    await screen.findByDisplayValue('08:30')
    await userEvent.click(screen.getByRole('button', { name: /add slot/i }))
    await userEvent.click(screen.getByRole('button', { name: /save schedule/i }))
    expect(api.putSlots).toHaveBeenCalledWith([
      { weekday: 1, timeLocal: '08:30' },
      { weekday: 0, timeLocal: '09:00' },
    ])
  })

  it('connects LinkedIn: paste key, find account, confirm', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: false, accountName: null })
    vi.mocked(api.connectStart).mockResolvedValue({ accounts: [{ id: 'a1', name: 'Jens Wedin' }] })
    vi.mocked(api.connectConfirm).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
    render(<SettingsScreen onLogout={vi.fn()} />)
    await screen.findByLabelText(/zernio api key/i)
    await userEvent.type(screen.getByLabelText(/zernio api key/i), 'zk_test')
    await userEvent.click(screen.getByRole('button', { name: /find.*account/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^connect$/i }))
    expect(api.connectConfirm).toHaveBeenCalledWith('zk_test', 'a1')
  })

  it('shows a message when no LinkedIn account is connected in Zernio', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: false, accountName: null })
    vi.mocked(api.connectStart).mockResolvedValue({ accounts: [] })
    render(<SettingsScreen onLogout={vi.fn()} />)
    await screen.findByLabelText(/zernio api key/i)
    await userEvent.type(screen.getByLabelText(/zernio api key/i), 'zk_test')
    await userEvent.click(screen.getByRole('button', { name: /find.*account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no linkedin account is connected/i)
  })

  it('shows an error when finding the account fails', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: false, accountName: null })
    vi.mocked(api.connectStart).mockRejectedValue(new Error('bad key'))
    render(<SettingsScreen onLogout={vi.fn()} />)
    await screen.findByLabelText(/zernio api key/i)
    await userEvent.type(screen.getByLabelText(/zernio api key/i), 'zk_bad')
    await userEvent.click(screen.getByRole('button', { name: /find.*account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bad key')
  })

  it('disconnects LinkedIn', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
    vi.mocked(api.disconnect).mockResolvedValue()
    render(<SettingsScreen onLogout={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /disconnect/i }))
    expect(api.disconnect).toHaveBeenCalled()
  })

  it('shows an error when disconnect fails', async () => {
    vi.mocked(api.getConnection).mockResolvedValue({ connected: true, accountName: 'Jens Wedin' })
    vi.mocked(api.disconnect).mockRejectedValue(new Error('network down'))
    render(<SettingsScreen onLogout={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /disconnect/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i)
  })
})
