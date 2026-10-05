import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W13 real Infrastructure & Assets specs: scoped public graph projection and
 * derived assets, served by controlled route interception. Redaction already
 * happened server-side; these specs assert the browser renders only public
 * data and never fabricates compromise claims or source counter constants.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w13-graph-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w13-graph-fixture', displayName: 'W13 Graph Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

const graphView = {
  engagementId: PROJECT_ID, source: 'graph', truncated: false,
  nodes: [
    { id: '4:a:1', labels: ['Host'], properties: { hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows Server 2022', engagement: 'w13-graph-fixture' } },
    { id: '4:a:2', labels: ['WebUrl'], properties: { url: 'https://api.corp/v1', title: 'API v1' } },
    { id: '4:a:3', labels: ['Identity'], properties: { username: 'CORP\\svc_backup' } },
  ],
  edges: [
    { id: '5:a:1', source: '4:a:1', target: '4:a:2', type: 'OPEN_PORT', properties: { port: 443 } },
  ],
}

const assetsView = {
  engagementId: PROJECT_ID, source: 'graph', truncated: false,
  assets: [
    { id: '4:a:1', type: 'Host', label: 'dc01.corp', hostname: 'dc01.corp', ip: '10.0.1.5', os: 'Windows Server 2022', ports: ['445'], services: [], relatedFindingIds: [], source: 'graph' },
    { id: '4:a:2', type: 'Web', label: 'https://api.corp/v1', url: 'https://api.corp/v1', ports: [], services: [], relatedFindingIds: ['FIND-2026-001'], source: 'graph' },
    { id: '4:a:3', type: 'Identity', label: 'CORP\\svc_backup', ports: [], services: [], relatedFindingIds: [], source: 'graph' },
  ],
}

async function interceptGraph(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/graph`, route => json(route, graphView))
  await page.route(`**/api/engagements/${PROJECT_ID}/assets`, route => json(route, assetsView))
}

test('infrastructure renders the scoped public projection with node detail and no raw secrets or fabricated compromise', async ({ page }) => {
  await interceptGraph(page)
  await page.goto(`/projects/${PROJECT_ID}/infrastructure`)
  await expect(page.getByRole('heading', { name: 'Infrastructure & Data' })).toBeVisible()
  await expect(page.getByText('3 nodes • 1 edges')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'dc01.corp' })).toBeVisible()
  await expect(page.getByText('Knowledge graph unavailable (503)')).toHaveCount(0)
  await expect(page.getByText('Compromised')).toHaveCount(0)
  await page.getByRole('cell', { name: 'dc01.corp' }).click()
  await expect(page.getByText('Public properties (server-redacted)')).toBeVisible()
  await expect(page.getByText('Credential-like fields are removed server-side before this response.')).toBeVisible()
})

test('assets derives counters from the projection and never shows source constants or mutation docks', async ({ page }) => {
  await interceptGraph(page)
  await page.goto(`/projects/${PROJECT_ID}/assets`)
  await expect(page.getByRole('heading', { name: 'Assets & Inventory' })).toBeVisible()
  await expect(page.getByText('Total Assets')).toBeVisible()
  await expect(page.getByText('134')).toHaveCount(0)
  await expect(page.getByText('Tag Selected')).toHaveCount(0)
  await expect(page.getByText('Update Scope')).toHaveCount(0)
  await expect(page.getByText('Export CSV')).toHaveCount(0)
  await expect(page.getByText('1 linked')).toBeVisible()
  await page.getByRole('button', { name: 'Web & API' }).click()
  await expect(page.getByRole('cell', { name: 'https://api.corp/v1' }).first()).toBeVisible()
  await expect(page.getByText('CORP\\svc_backup')).toHaveCount(0)
  await page.getByRole('button', { name: 'Inspect' }).click()
  await expect(page.getByText('Related findings')).toBeVisible()
  await expect(page.getByText('FIND-2026-001')).toBeVisible()
  await expect(page.getByText('Compromise or pivot claims are never fabricated from presence alone.')).toBeVisible()
})
