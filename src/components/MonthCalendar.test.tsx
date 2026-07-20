import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MonthCalendar, type MonthCalendarProps } from './MonthCalendar'
import type { Post } from '@/lib/types'

const NOW = new Date('2026-07-15T09:00:00.000Z')
function post(id: string, scheduledAt: string | null, extra: Partial<Post> = {}): Post {
  return {
    id,
    body: `body ${id}`,
    images: [],
    firstComment: null,
    status: 'queued',
    pinned: false,
    position: 0,
    scheduledAt,
    zernioPostId: null,
    linkedinUrl: null,
    error: null,
    attempts: 0,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}
const noop = () => {}
function renderCal(over: Partial<MonthCalendarProps> = {}) {
  return render(
    <MonthCalendar
      posts={[]}
      now={NOW}
      onSelectPost={noop}
      onSelectDay={noop}
      onReschedule={noop}
      {...over}
    />,
  )
}

describe('MonthCalendar', () => {
  it('renders 7 weekday column headers and the month title', () => {
    renderCal()
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)
    expect(screen.getByText('July 2026')).toBeInTheDocument()
  })

  it('navigates months with Prev/Next/Today', async () => {
    renderCal()
    await userEvent.click(screen.getByRole('button', { name: /next month/i }))
    expect(screen.getByText('August 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /previous month/i }))
    await userEvent.click(screen.getByRole('button', { name: /previous month/i }))
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^today$/i }))
    expect(screen.getByText('July 2026')).toBeInTheDocument()
  })

  it('shows a post chip on its day and calls onSelectPost when clicked', async () => {
    const onSelectPost = vi.fn()
    renderCal({ posts: [post('p1', '2026-07-16T06:00:00.000Z')], onSelectPost })
    const chip = screen.getByRole('button', { name: /08:00.*body p1/i })
    await userEvent.click(chip)
    expect(onSelectPost).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('offers an add button on a future day and calls onSelectDay', async () => {
    const onSelectDay = vi.fn()
    renderCal({ onSelectDay })
    await userEvent.click(screen.getByRole('button', { name: /add a post on 16 july/i }))
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-16')
  })

  it('has no add button on a past day', () => {
    renderCal()
    expect(screen.queryByRole('button', { name: /add a post on 14 july/i })).not.toBeInTheDocument()
  })

  it('marks queued chips draggable and published chips not', () => {
    renderCal({
      posts: [
        post('q', '2026-07-16T06:00:00.000Z', { status: 'queued' }),
        post('pub', '2026-07-17T06:00:00.000Z', { status: 'published', linkedinUrl: 'https://li/x' }),
      ],
    })
    const q = screen.getByRole('button', { name: /08:00.*body q/i })
    const pub = screen.getByRole('button', { name: /08:00.*body pub/i })
    expect(q).toHaveAttribute('aria-roledescription', 'draggable')
    expect(pub).not.toHaveAttribute('aria-roledescription', 'draggable')
  })
})
