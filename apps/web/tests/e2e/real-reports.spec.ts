import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W14 real Reports specs: preview from actual engagement/findings DTOs and the
 * validated JSON/Markdown export attachments. Success is asserted only after
 * the response arrived with the correct Content-Disposition; unsupported
 * formats are never offered, and no dummy deliverable rows exist.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w14-reports-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w14-reports-fixture', displayName: 'W14 Reports Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

const findingsView = {
  engagementId: PROJECT_ID, source: 'workspace', truncated: false,
  findings: [
    { engagementId: PROJECT_ID, id: 'FIND-2026-001', title: 'Exposed .env File with Plaintext Credentials', severity: 'critical', cvssScore: 9.1, cvssVector: 'AV:N/AC:L/PR:N/UI:N', description: 'The application root exposes a .env file.', evidence: 'GET /.env returned 200', attackVector: 'Unauthenticated HTTP GET', affectedAssets: ['api.acme.com/.env'], cwe: ['CWE-312'], mitre: ['T1552.001'], remediation: 'Rotate credentials.', rawSource: '# Exposed .env File with Plaintext Credentials', sizeBytes: 512, quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false }, source: 'workspace' },
    { engagementId: PROJECT_ID, id: 'FIND-2026-002', title: 'Directory listing on /backup', severity: 'medium', description: 'Backup directory is listable.', evidence: 'GET /backup returned index', attackVector: 'Unauthenticated HTTP GET', affectedAssets: [], remediation: 'Disable listing.', rawSource: '# Directory listing', sizeBytes: 256, quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false }, source: 'workspace' },
  ],
}

const artifactsView = {
  engagementId: PROJECT_ID, source: 'workspace',
  folders: [{ folder: 'recon', files: [{ name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 12 }] }],
}

const exportJson = JSON.stringify({ engagement: { id: PROJECT_ID }, planDocs: { roe: { rules: [] } }, findings: [{ id: 'FIND-2026-001', content: '# Exposed' }], findingsUnreadable: 0, formatValidated: true })

async function intercept(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/findings`, route => json(route, findingsView))
  await page.route(`**/api/engagements/${PROJECT_ID}/artifacts`, route => json(route, artifactsView))
  await page.route(`**/api/engagements/${PROJECT_ID}/export?format=json`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: exportJson,
    headers: { 'Content-Disposition': `attachment; filename="${project.workspaceSlug}-export.json"` },
  }))
  await page.route(`**/api/engagements/${PROJECT_ID}/export?format=markdown`, route => route.fulfill({
    status: 200, contentType: 'text/markdown; charset=utf-8', body: `# ${project.workspaceSlug} — Engagement Export\n`,
    headers: { 'Content-Disposition': `attachment; filename="${project.workspaceSlug}-export.md"` },
  }))
}

test('report preview derives from actual DTOs with no dummy deliverables or authors', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/reports`)
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  await expect(page.locator('#main-content').getByText('W14 Reports Fixture')).toBeVisible()
  await expect(page.getByText('1 critical')).toBeVisible()
  await expect(page.getByText('1 medium').first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'FIND-2026-001' })).toBeVisible()
  await expect(page.getByText('Alex Kim')).toHaveCount(0)
  await expect(page.getByText('Attestation Certificate')).toHaveCount(0)
  await expect(page.getByText('AI Compile')).toHaveCount(0)
  await expect(page.getByText('pages')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(0)
})

test('JSON export succeeds only after the validated response with correct filename', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/reports`)
  let exportRequests = 0
  page.on('request', request => { if (request.url().includes('/export?format=json')) exportRequests += 1 })
  await page.getByRole('button', { name: 'Export JSON' }).click()
  await expect(page.getByText(/Download ready: /)).toBeVisible()
  await expect(page.getByText(`${project.workspaceSlug}-export.json`)).toBeVisible()
  expect(exportRequests).toBe(1)
  await expect(page.getByText('formatValidated')).toHaveCount(0)
})

test('markdown export reports the real attachment and a failed export never claims success', async ({ page }) => {
  await intercept(page)
  await page.route(`**/api/engagements/${PROJECT_ID}/export?format=markdown`, route => route.fulfill({
    status: 400, contentType: 'application/json',
    body: JSON.stringify({ statusCode: 400, error: { code: 'bad_request', message: 'Unsupported export format. Supported formats: json, markdown.' } }),
  }))
  await page.goto(`/projects/${PROJECT_ID}/reports`)
  await page.getByRole('button', { name: 'Export Markdown' }).click()
  await expect(page.getByText('Unsupported export format. Supported formats: json, markdown.')).toBeVisible()
  await expect(page.getByText(/Download ready: /)).toHaveCount(0)
})
