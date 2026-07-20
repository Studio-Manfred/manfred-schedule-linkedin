import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostCard } from './PostCard'
import type { Post } from '@/lib/types'

const base: Post = {
  id: '1',
  body: 'hello world',
  images: [],
  firstComment: null,
  status: 'queued',
  pinned: false,
  position: 0,
  scheduledAt: '2026-07-21T06:30:00.000Z',
  zernioPostId: null,
  linkedinUrl: null,
  error: null,
  attempts: 0,
  createdAt: '',
  updatedAt: '',
}

describe('PostCard', () => {
  it('renders the body, scheduled time and pinned badge', () => {
    render(<PostCard post={{ ...base, pinned: true }} />)
    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(screen.getByText(/pinned/i)).toBeInTheDocument()
    // The scheduled time renders inside a <time> element.
    expect(document.querySelector('time')).toHaveAttribute('datetime', base.scheduledAt!)
  })

  it('renders up to four image thumbnails with alt text and a +N overflow', () => {
    const images = Array.from({ length: 6 }, (_, i) => ({ url: `https://blob.test/${i}.png`, alt: `image ${i}` }))
    render(<PostCard post={{ ...base, images }} />)
    expect(screen.getByAltText('image 0')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('renders the error text and the actions slot', () => {
    render(<PostCard post={{ ...base, error: 'zernio 500' }} actions={<button type="button">Retry</button>} />)
    expect(screen.getByText('zernio 500')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('marks the content region as a drag handle when dragHandle is provided', () => {
    render(
      <PostCard
        post={base}
        dragHandle={{
          ref: () => {},
          attributes: {
            role: 'button',
            tabIndex: 0,
            'aria-roledescription': 'sortable',
            'aria-disabled': false,
            'aria-pressed': undefined,
            'aria-describedby': 'dnd',
          },
          listeners: {},
        }}
      />,
    )
    expect(screen.getByText(/drag to reorder/i)).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-roledescription', 'sortable')
  })
})
