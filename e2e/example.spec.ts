import { test, expect } from '@playwright/test'

test('home renders the greeting and the primary action', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /get started/i })).toBeVisible()
})
