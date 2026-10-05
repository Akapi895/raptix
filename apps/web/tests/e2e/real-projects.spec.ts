import { test, expect, type Page } from '@playwright/test'

/**
 * Real-mode workspace composition specs (W03): src/app/RealApp.tsx behavior.
 *
 * These specs run against the Vite dev server in real mode. The new API may
 * (HEAD gate: controlled server) or may not (standalone) be reachable, so
 * every data-dependent assertion is written to hold in BOTH cases: with the
 * API up, real data may render; with it down, the truthful error state must
 * show. Demo fixtures are unacceptable either way.
 */

async function apiUp(page: Page): Promise<boolean> {
  return page.request.get('/api/health').then(response => response.ok()).catch(() => false)
}

async function gotoHome(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects Management' })).toBeVisible()
}

test('home renders the real projects chrome with truthful states and zero demo data', async ({ page }) => {
  await gotoHome(page)
  await expect(page.getByText('Acme Corp External Assessment', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Alex Kim', { exact: true })).toHaveCount(0)
  if (await apiUp(page)) {
    await expect(page.getByRole('button', { name: 'New Project' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } else {
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert.getByText('Projects unavailable')).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
  }
})

test('deep links to unknown projects show truthful states and retry the root read', async ({ page }) => {
  await page.goto('/projects/no-such-engagement/charter')
  await expect(page.getByRole('button', { name: 'All projects' })).toBeVisible()
  await expect(page.getByText('Acme Corp External Assessment', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'All projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects Management' })).toBeVisible()
})

test('new project form validates locally and makes no server call until valid', async ({ page }) => {
  const posts: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/engagements')) posts.push(request.url())
  })
  await gotoHome(page)
  await page.getByRole('button', { name: 'New Project' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Create Project' }).click()
  await expect(dialog.getByText('Explicit authorization confirmation is required')).toBeVisible()
  await expect(dialog.getByText(/Invalid project name/)).toBeVisible()
  expect(posts).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
