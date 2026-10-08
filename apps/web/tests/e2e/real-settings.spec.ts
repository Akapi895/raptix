import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W15 real Settings specs: persisted general fields with save/reload
 * acknowledgement, the up-front target-change policy, stated-absent unsupported
 * feature areas, and the danger delete with truthful scope. No "Test
 * Connected" or unacknowledged "Saved" toasts may appear.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w15-settings-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w15-settings-fixture', displayName: 'W15 Settings Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

function settingsView(lifecycleStatus: string): Record<string, unknown> {
  const locked = lifecycleStatus !== 'draft'
  return {
    engagementId: PROJECT_ID, displayName: project.displayName, name: project.workspaceSlug,
    targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
    lifecycleStatus, targetChange: locked
      ? { allowed: false, reason: 'Target changes are only allowed while the project is in draft' }
      : { allowed: true, reason: null },
    source: 'db',
  }
}

async function intercept(page: Page, lifecycleStatus = 'planning', patchStatus = 200): Promise<{ patches: unknown[]; deleted: boolean }> {
  const state = { patches: [] as unknown[], deleted: false }
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => {
    if (route.request().method() === 'DELETE') { state.deleted = true; return json(route, { ok: true, workspaceRetained: true }) }
    if (route.request().method() === 'PATCH') {
      state.patches.push(route.request().postDataJSON())
      return json(route, { ...project, displayName: (route.request().postDataJSON() as { displayName?: string }).displayName })
    }
    return json(route, project)
  })
  await page.route(`**/api/engagements/${PROJECT_ID}/settings`, route => json(route, settingsView(lifecycleStatus), patchStatus === 0 ? 200 : 200))
  return state
}

test('settings edits persisted fields with server-acknowledged save and reload', async ({ page }) => {
  const state = await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/settings`)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Project name (workspace slug, immutable)')).toBeVisible()
  const slugInput = page.locator('input[disabled], input[readonly]').first()
  await expect(slugInput).toHaveValue('w15-settings-fixture')
  await page.getByLabel('Display name').fill('Renamed Engagement')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved — reloaded from the server.')
  expect(state.patches).toHaveLength(1)
  expect(state.patches[0]).toMatchObject({ displayName: 'Renamed Engagement' })
  await expect(page.getByText('Test Connected')).toHaveCount(0)
})

test('the target-change policy is stated up front when the lifecycle locks targets', async ({ page }) => {
  await intercept(page, 'planning')
  await page.goto(`/projects/${PROJECT_ID}/settings`)
  await expect(page.getByText('Target locked: Target changes are only allowed while the project is in draft.')).toBeVisible()
  await expect(page.getByLabel('Target value')).toBeDisabled()
  await expect(page.getByLabel('Target type')).toBeDisabled()
  await expect(page.getByLabel('Display name')).toBeEnabled()
})

test('unsupported feature areas are stated with reasons, never faked as connectable', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/settings`)
  await expect(page.getByText('AI provider / model / runtime')).toBeVisible()
  await expect(page.getByText('Integrations & keys')).toBeVisible()
  await expect(page.getByText(/Credentials Vault provides encrypted secret storage/)).toBeVisible()
  await expect(page.getByText(/No integration registry or secret storage service exists/)).toHaveCount(0)
  await expect(page.getByText('Notification delivery')).toBeVisible()
  await expect(page.getByText('Report templates')).toBeVisible()
  await expect(page.getByRole('button', { name: /Connect|Test|Save key/i })).toHaveCount(0)
})

test('danger delete names its scope and navigates home after acknowledgement', async ({ page }) => {
  const state = await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/settings`)
  await expect(page.getByText(/retained/).first()).toBeVisible()
  await expect(page.getByText(/Workspace artifacts on disk are/)).toBeVisible()
  await page.getByRole('button', { name: 'Delete engagement' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page).toHaveURL(/\/projects$/)
  expect(state.deleted).toBe(true)
})
