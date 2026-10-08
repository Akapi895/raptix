import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W14 real Operations Log specs: the merged server timeline rendered with
 * distinct source labels, payload-derived filters and truthful bounded/empty
 * states. No "Live" indicator and no synthetic telemetry may appear.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w14-logs-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w14-logs-fixture', displayName: 'W14 Logs Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

const timeline = {
  engagementId: PROJECT_ID, source: 'mixed', truncated: false,
  entries: [
    { id: 'run:run-9', at: '2026-10-01T08:00:00.000Z', source: 'runtime', kind: 'run', label: 'Planning run success', runId: 'run-9', status: 'success' },
    { id: 'checkpoint:0', at: '2026-10-01T09:30:00.000Z', source: 'checkpoint', kind: 'tool_call', label: 'tool call', agent: 'soundwave' },
    { id: 'workspace:recon/nmap.txt', at: '2026-10-01T10:00:00.000Z', source: 'workspace', kind: 'artifact', label: 'Artifact updated: recon/nmap.txt', tool: 'recon' },
  ],
}

async function intercept(page: Page, entries: typeof timeline.entries = timeline.entries, truncated = false): Promise<void> {
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/timeline`, route => json(route, { ...timeline, entries, truncated }))
}

test('operations log renders merged entries with distinct source labels and payload-derived filters', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/logs`)
  await expect(page.getByRole('heading', { name: 'Operations Log' })).toBeVisible()
  await expect(page.getByText('3 entries', { exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Planning run success' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Artifact updated: recon/nmap.txt' })).toBeVisible()
  await expect(page.getByText('● Live')).toHaveCount(0)
  await page.getByLabel('Filter by agent').selectOption('soundwave')
  await expect(page.getByRole('cell', { name: 'Planning run success' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'tool call' })).toBeVisible()
  await page.getByLabel('Filter by agent').selectOption('all')
  await page.getByLabel('Filter by source').selectOption('workspace')
  await expect(page.getByRole('cell', { name: 'tool call' })).toHaveCount(0)
})

test('entry detail keeps provenance: artifact mtime is not a tool execution time', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/logs`)
  await page.getByRole('cell', { name: 'Artifact updated: recon/nmap.txt' }).click()
  await expect(page.getByText('Workspace marker: the file timestamp records when the artifact was last written; it is not an exact tool execution time.')).toBeVisible()
  await page.getByRole('button', { name: 'Close log entry detail' }).click()
  await page.getByRole('cell', { name: 'tool call' }).click()
  await expect(page.getByText('Checkpoint transcript: durable thread-level history.')).toBeVisible()
})

test('bounded history is stated, empty log stays truthful', async ({ page }) => {
  await intercept(page, timeline.entries.slice(0, 1), true)
  await page.goto(`/projects/${PROJECT_ID}/logs`)
  await expect(page.getByText(/bounded — older entries hidden by the server/)).toBeVisible()
  await expect(page.getByText('Trace completeness is limited, not lost silently.')).toBeVisible()
})

test('an empty timeline renders as a truthful empty state, not fabricated activity', async ({ page }) => {
  await intercept(page, [])
  await page.goto(`/projects/${PROJECT_ID}/logs`)
  await expect(page.getByText('No log entries match. An empty log is a truthful state')).toBeVisible()
})
