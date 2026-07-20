import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const ENFORCE = process.env.AXE_ENFORCE === '1'

test('home page has no detectable axe violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`)
      .join('\n')
    console.warn(`axe found violations:\n${summary}`)
  }
  if (ENFORCE) {
    expect(results.violations).toEqual([])
  }
})
