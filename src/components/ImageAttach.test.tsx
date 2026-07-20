import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageAttach } from './ImageAttach'
import type { PostImage } from '@/lib/types'

describe('ImageAttach', () => {
  it('renders an English "Add images" button and the image count', () => {
    render(<ImageAttach images={[]} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /add images/i })).toBeInTheDocument()
    expect(screen.getByText(/images \(0\/20\)/i)).toBeInTheDocument()
  })

  it('renders a description field and a Remove button per image', () => {
    const images: PostImage[] = [{ url: 'https://blob.test/a.png', alt: 'a chart' }]
    render(<ImageAttach images={images} onChange={() => {}} />)
    expect(screen.getByLabelText(/add a description to the image/i)).toHaveValue('a chart')
    expect(screen.getByRole('button', { name: /remove image 1/i })).toBeInTheDocument()
  })

  it('edits alt text and removes an image via onChange', async () => {
    const onChange = vi.fn()
    const images: PostImage[] = [{ url: 'https://blob.test/a.png', alt: '' }]
    render(<ImageAttach images={images} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText(/add a description/i), 'x')
    expect(onChange).toHaveBeenCalledWith([{ url: 'https://blob.test/a.png', alt: 'x' }])
    onChange.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /remove image 1/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
