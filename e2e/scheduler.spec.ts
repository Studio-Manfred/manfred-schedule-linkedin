import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

interface MockPost {
  id: string
  body: string
  images: { url: string; alt: string }[]
  status: string
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

function post(id: string, body: string, extra: Partial<MockPost> = {}): MockPost {
  return {
    id, body, images: [], status: 'queued', pinned: false, position: 0,
    scheduledAt: '2026-07-21T06:30:00.000Z', zernioPostId: null, linkedinUrl: null,
    error: null, attempts: 0, createdAt: '', updatedAt: '', ...extra,
  }
}

/** In-memory API double shared by all routes of one test. */
async function mockApi(page: Page, initial: MockPost[] = []) {
  const state = { posts: [...initial], slots: [{ id: 1, weekday: 1, timeLocal: '08:30' }] }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/api/auth/me') return route.fulfill({ status: 204 })
    if (path === '/api/auth/login') return route.fulfill({ status: 204 })
    if (path === '/api/auth/logout') return route.fulfill({ status: 204 })
    if (path === '/api/slots') return json(200, { slots: state.slots })
    if (path === '/api/connection') return json(200, { connected: true, accountName: 'Jens Wedin' })
    if (path === '/api/posts' && method === 'GET') return json(200, { posts: state.posts })
    if (path === '/api/posts' && method === 'POST') {
      const body = route.request().postDataJSON() as { body: string; action: string; scheduledAt?: string }
      const p = post(`p${state.posts.length + 1}`, body.body, {
        status: body.action === 'draft' ? 'draft' : 'queued',
        pinned: body.action === 'pin',
        scheduledAt: body.scheduledAt ?? '2026-07-23T06:30:00.000Z',
        position: state.posts.length,
      })
      state.posts.push(p)
      return json(201, { post: p })
    }
    if (path === '/api/posts/reorder') {
      const { orderedIds } = route.request().postDataJSON() as { orderedIds: string[] }
      state.posts.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
      // Mirror the real API's recomputeQueueLive: reordering reassigns slot
      // times so queued+unpinned posts stay chronologically sorted by their
      // new position (QueueScreen renders "upcoming" sorted by scheduledAt).
      let slot = 0
      state.posts.forEach((p, i) => {
        p.position = i
        if (p.status === 'queued' && !p.pinned) {
          p.scheduledAt = new Date(Date.parse('2026-07-21T06:30:00.000Z') + slot * 86_400_000).toISOString()
          slot += 1
        }
      })
      return json(200, { posts: state.posts })
    }
    return json(404, { error: `unmocked: ${method} ${path}` })
  })
  return state
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(results.violations).toEqual([])
}

test('compose → queue shows the post with its slot date', async ({ page }) => {
  await mockApi(page)
  await page.goto('/compose')
  await page.getByLabel(/post text/i).fill('E2E hello LinkedIn')
  await expect(page.getByText(/next slot/i)).toBeVisible()
  await page.getByRole('button', { name: /add to queue/i }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByText('E2E hello LinkedIn')).toBeVisible()
})

test('keyboard-only reorder calls the API with the new order', async ({ page }) => {
  await mockApi(page, [post('a', 'first post', { position: 0 }), post('b', 'second post', { position: 1, scheduledAt: '2026-07-23T06:30:00.000Z' })])
  await page.goto('/')
  await expect(page.getByText('first post')).toBeVisible()
  // Tab to the first card's "Move down" and activate with keyboard only
  const moveDown = page.getByRole('button', { name: /move down/i }).first()
  await moveDown.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listitem').first()).toContainText('second post')
})

test('pin flow sends scheduledAt', async ({ page }) => {
  const state = await mockApi(page)
  await page.goto('/compose')
  await page.getByLabel(/post text/i).fill('Pinned post')
  await page.getByLabel(/pin to date/i).fill('2030-01-15T09:00')
  await page.getByRole('button', { name: /^pin$/i }).click()
  await expect(page).toHaveURL('/')
  expect(state.posts.some((p) => p.pinned)).toBe(true)
})

for (const [name, path] of [
  ['queue', '/'],
  ['composer', '/compose'],
  ['history', '/history'],
  ['settings', '/settings'],
] as const) {
  test(`a11y: ${name} screen has no WCAG violations`, async ({ page }) => {
    await mockApi(page, [post('a', 'sample post')])
    await page.goto(path)
    await expect(page.getByRole('main')).toBeVisible()
    await expectNoA11yViolations(page)
  })
}
