import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoginScreen } from './LoginScreen'

describe('LoginScreen', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('offers an accessible Google sign-in link', () => {
    render(<LoginScreen />)
    const link = screen.getByRole('link', { name: /sign in with google/i })
    expect(link).toHaveAttribute('href', '/api/auth/google/start')
  })

  it('shows no error alert when ?error= is absent', () => {
    render(<LoginScreen />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a friendly error message when ?error= is present', () => {
    window.history.pushState({}, '', '/login?error=access_denied')
    render(<LoginScreen />)
    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in failed/i)
  })
})
