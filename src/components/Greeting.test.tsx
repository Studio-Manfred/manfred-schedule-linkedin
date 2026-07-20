import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Greeting } from './Greeting'

describe('Greeting', () => {
  it('renders an accessible heading with the project name', () => {
    render(<Greeting name="Acme" />)
    expect(
      screen.getByRole('heading', { level: 1, name: /acme/i }),
    ).toBeInTheDocument()
  })
})
