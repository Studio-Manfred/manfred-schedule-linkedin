import { MAX_BODY_LENGTH, MAX_IMAGES, type PostImage } from '../../src/lib/types.js'

export interface ValidPostInput {
  body: string
  images: PostImage[]
}

export function validatePostInput(
  input: unknown,
): { ok: true; value: ValidPostInput } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'invalid payload' }
  const { body, images } = input as { body?: unknown; images?: unknown }
  if (typeof body !== 'string' || body.trim().length === 0) return { ok: false, error: 'post text is required' }
  if (body.length > MAX_BODY_LENGTH) return { ok: false, error: `post text exceeds ${MAX_BODY_LENGTH} characters` }
  if (!Array.isArray(images)) return { ok: false, error: 'images must be an array' }
  if (images.length > MAX_IMAGES) return { ok: false, error: `at most ${MAX_IMAGES} images` }
  for (const img of images) {
    if (typeof img !== 'object' || img === null) return { ok: false, error: 'invalid image entry' }
    const { url, alt } = img as { url?: unknown; alt?: unknown }
    if (typeof url !== 'string' || url.length === 0) return { ok: false, error: 'image url is required' }
    if (typeof alt !== 'string') return { ok: false, error: 'image alt text is required' }
  }
  return { ok: true, value: { body, images: images as PostImage[] } }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateSlots(
  input: unknown,
): { ok: true; value: { weekday: number; timeLocal: string }[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'slots must be an array' }
  for (const s of input) {
    const { weekday, timeLocal } = (s ?? {}) as { weekday?: unknown; timeLocal?: unknown }
    if (typeof weekday !== 'number' || weekday < 0 || weekday > 6 || !Number.isInteger(weekday))
      return { ok: false, error: 'weekday must be an integer 0 (Mon) … 6 (Sun)' }
    if (typeof timeLocal !== 'string' || !TIME_RE.test(timeLocal))
      return { ok: false, error: 'timeLocal must be HH:MM (24h)' }
  }
  return { ok: true, value: input as { weekday: number; timeLocal: string }[] }
}
