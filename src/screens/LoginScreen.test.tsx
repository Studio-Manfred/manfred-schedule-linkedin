import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LoginScreen } from './LoginScreen'
import { api, ApiError } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>()
  return { ...mod, api: { ...mod.api, login: vi.fn() } }
})

describe('LoginScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('submits the password and calls onSuccess', async () => {
    vi.mocked(api.login).mockResolvedValue()
    const onSuccess = vi.fn()
    render(<MemoryRouter><LoginScreen onSuccess={onSuccess} /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(api.login).toHaveBeenCalledWith('hunter2')
    expect(onSuccess).toHaveBeenCalled()
  })

  it('shows an error message on wrong password', async () => {
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, 'wrong password'))
    render(<MemoryRouter><LoginScreen onSuccess={vi.fn()} /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/password/i), 'nope')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong password/i)
  })
})
