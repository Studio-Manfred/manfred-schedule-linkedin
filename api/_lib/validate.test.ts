// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validatePostInput } from './validate'

describe('validatePostInput', () => {
  it('accepts a valid text post', () => {
    const r = validatePostInput({ body: 'hello', images: [] })
    expect(r).toEqual({ ok: true, value: { body: 'hello', images: [] } })
  })

  it('rejects empty body and over-limit body', () => {
    expect(validatePostInput({ body: '', images: [] }).ok).toBe(false)
    expect(validatePostInput({ body: 'x'.repeat(3001), images: [] }).ok).toBe(false)
    expect(validatePostInput({ body: 'x'.repeat(3000), images: [] }).ok).toBe(true)
  })

  it('rejects more than 20 images and images without url or alt field', () => {
    const img = { url: 'https://blob.test/a.png', alt: 'desc' }
    expect(validatePostInput({ body: 'x', images: Array(21).fill(img) }).ok).toBe(false)
    expect(validatePostInput({ body: 'x', images: Array(20).fill(img) }).ok).toBe(true)
    expect(validatePostInput({ body: 'x', images: [{ url: 'https://a' }] }).ok).toBe(false)
    expect(validatePostInput({ body: 'x', images: [{ alt: 'no url' }] }).ok).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(validatePostInput(null).ok).toBe(false)
    expect(validatePostInput('str').ok).toBe(false)
  })
})
