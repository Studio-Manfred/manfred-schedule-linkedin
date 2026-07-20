import { MAX_BODY_LENGTH, MAX_IMAGES, type PostImage } from '../../src/lib/types'

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
