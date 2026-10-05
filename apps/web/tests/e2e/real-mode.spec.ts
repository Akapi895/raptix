import { test, expect } from '@playwright/test'

// W03 real guard: the real branch now renders the real workspace composition
// (src/app/RealApp.tsx) instead of the old "backend unavailable" placeholder.
// Demo fixture data must never appear in real mode, before or after reload.
test('real mode renders the real workspace chrome and never silently renders demo project data', async ({ page }) => {
  await page.goto('/projects/1/overview')
  // 'overview' is not one of the 13 pages: real mode shows a truthful
  // not-found state with a root read, never demo content.
  await expect(page.getByRole('button', { name: 'All projects' })).toBeVisible()
  await expect(page.getByText('Acme Corp External Assessment', { exact: true })).toHaveCount(0)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects Management' })).toBeVisible()
  await expect(page.getByText('Acme Corp External Assessment', { exact: true })).toHaveCount(0)
  // No fake source owner identity anywhere in the real chrome.
  await expect(page.getByText('Alex Kim', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projects Management' })).toBeVisible()
})
