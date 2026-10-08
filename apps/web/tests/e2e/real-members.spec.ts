import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W19 real Members specs: the truthful local single-user topology with the
 * stated-absent invite/RBAC reason. No imported demo people, no role
 * dropdown, no fake Owner/Viewer hierarchy.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w19-members-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w19-members-fixture', displayName: 'W19 Members Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

const membersView = {
  engagementId: PROJECT_ID, mode: 'local-single-user',
  members: [{ id: 'local', label: 'Local Operator', role: 'operator', source: 'local' }],
  inviteSupported: false,
  reason: 'Memberships require an authentication strategy (hosted multi-user auth with sessions, CSRF and origin policy, enforced on every scoped API) that this build does not have. The deployment stays a localhost-only single-user topology.',
  source: 'db',
}

async function intercept(page: Page): Promise<{ invited: number }> {
  const state = { invited: 0 }
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/members`, route => {
    if (route.request().method() !== 'GET') { state.invited += 1; return json(route, { statusCode: 503, error: { code: 'unavailable', message: 'Inviting members is not supported. Memberships require an authentication strategy that this build does not have.' } }, 503) }
    return json(route, membersView)
  })
  return state
}

test('renders the local single-user members view from the real API', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/members`)
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Local Operator' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Alex Kim' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Sarah Rowe' })).toHaveCount(0)
})

test('states the invite/RBAC absence with the server reason and never fakes a role dropdown', async ({ page }) => {
  const state = await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/members`)
  await expect(page.getByText('Not available in this build')).toBeVisible()
  await expect(page.getByText('Memberships require an authentication strategy', { exact: false })).toBeVisible()
  await expect(page.getByLabel(/role/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /invite|add member/i })).toHaveCount(0)
  expect(state.invited).toBe(0)
})
