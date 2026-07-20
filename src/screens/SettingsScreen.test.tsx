import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsScreen } from './SettingsScreen'
import { api } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return {
    ...mod,
    api: { ...mod.api, getSlots: vi.fn(), putSlots: vi.fn(), getConnection: vi.fn(), logout: vi.fn() },
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
})
