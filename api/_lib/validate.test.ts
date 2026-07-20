// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validatePostInput, validateSlots } from './validate'

describe('validatePostInput', () => {
  it('accepts a valid text post', () => {
    const r = validatePostInput({ body: 'hello', images: [] })
    expect(r).toEqual({ ok: true, value: { body: 'hello', images: [], firstComment: null } })
  })

  it('accepts an optional first comment and normalises blank to null', () => {
    const withComment = validatePostInput({ body: 'hi', images: [], firstComment: 'Link: https://x.dev' })
    expect(withComment).toEqual({
      ok: true,
      value: { body: 'hi', images: [], firstComment: 'Link: https://x.dev' },
    })
    // omitted, empty and whitespace-only all collapse to null
    for (const fc of [undefined, '', '   ']) {
      const r = validatePostInput({ body: 'hi', images: [], firstComment: fc })
      expect(r).toEqual({ ok: true, value: { body: 'hi', images: [], firstComment: null } })
    }
  })

  it('rejects a non-string or over-limit first comment', () => {
    expect(validatePostInput({ body: 'hi', images: [], firstComment: 123 }).ok).toBe(false)
    expect(validatePostInput({ body: 'hi', images: [], firstComment: 'x'.repeat(1251) }).ok).toBe(false)
    expect(validatePostInput({ body: 'hi', images: [], firstComment: 'x'.repeat(1250) }).ok).toBe(true)
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

describe('validateSlots', () => {
  it('accepts valid slots', () => {
    expect(validateSlots([{ weekday: 0, timeLocal: '08:30' }, { weekday: 6, timeLocal: '23:59' }]).ok).toBe(true)
  })
  it('rejects bad weekday, bad time format, non-array', () => {
    expect(validateSlots([{ weekday: 7, timeLocal: '08:30' }]).ok).toBe(false)
    expect(validateSlots([{ weekday: -1, timeLocal: '08:30' }]).ok).toBe(false)
    expect(validateSlots([{ weekday: 1, timeLocal: '8:30' }]).ok).toBe(false)
    expect(validateSlots([{ weekday: 1, timeLocal: '25:00' }]).ok).toBe(false)
    expect(validateSlots('x').ok).toBe(false)
  })
})
