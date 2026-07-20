export const TIMEZONE = 'Europe/Stockholm'
export const MAX_BODY_LENGTH = 3000
export const MAX_IMAGES = 20
export const MAX_ATTEMPTS = 3
export const MISSED_WINDOW_MINUTES = 60
export const STUCK_PUBLISHING_MINUTES = 10

export type PostStatus =
  | 'draft'
  | 'queued'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'missed'

export interface PostImage {
  url: string
  alt: string
}

export interface Post {
  id: string
  body: string
  images: PostImage[]
  status: PostStatus
  pinned: boolean
  position: number | null
  scheduledAt: string | null
  zernioPostId: string | null
  linkedinUrl: string | null
  error: string | null
  attempts: number
  createdAt: string
  updatedAt: string
}

/** weekday: 0 = Monday … 6 = Sunday (ISO). timeLocal: 'HH:MM' in Europe/Stockholm. */
export interface Slot {
  id: number
  weekday: number
  timeLocal: string
}
