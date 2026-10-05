import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W12 real Findings & Evidence specs: src/features/findings-evidence/RealFindings.tsx.
 * Deterministic route interception of the new API; no demo findings, no fake
 * workflow states, no local PoC execution.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w12-findings-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w12-findings-fixture', displayName: 'W12 Findings Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

const finding = {
  engagementId: PROJECT_ID, id: 'FIND-2026-001', title: 'Exposed .env File with Plaintext Credentials',
  severity: 'critical', description: 'The application root exposes a `.env` file via HTTP.',
  evidence: 'GET /.env returned 200 with DB_PASSWORD', attackVector: 'Unauthenticated HTTP GET.',
  affectedAssets: ['api.acme.com/.env'], cvssScore: 9.1, cwe: ['CWE-312'], mitre: ['T1552.001'],
  remediation: 'Rotate credentials; block .env access.',
  quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
  rawSource: '# FIND-2026-001\n\nSeverity: critical', sizeBytes: 512, source: 'workspace',
}

const defaultedFinding = {
  ...finding, id: 'FIND-2026-002', title: 'Untitled finding', severity: 'medium', cvssScore: undefined,
  cwe: undefined, mitre: undefined, remediation: undefined, affectedAssets: [],
  description: 'No description available.', evidence: 'No evidence recorded.',
  quality: { defaultSeverity: true, placeholderDescription: true, placeholderEvidence: true, unreadable: false },
}

const findingsView = { engagementId: PROJECT_ID, findings: [finding, defaultedFinding], truncated: false, source: 'workspace' }
const artifactsView = {
  engagementId: PROJECT_ID, source: 'workspace',
  folders: [{ folder: 'recon', files: [{ name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 5 }] }],
}
const contentView = { engagementId: PROJECT_ID, path: 'recon/nmap.txt', content: 'ports', mediaType: 'text', sizeBytes: 5, truncated: false, source: 'workspace' }

async function interceptFindings(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/findings`, route => json(route, findingsView))
  await page.route(`**/api/engagements/${PROJECT_ID}/artifacts/content*`, route => json(route, contentView))
  await page.route(`**/api/engagements/${PROJECT_ID}/artifacts`, route => json(route, artifactsView))
}

test('findings page renders parsed workspace findings with quality flags and no demo data', async ({ page }) => {
  await interceptFindings(page)
  await page.goto(`/projects/${PROJECT_ID}/findings`)
  await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible()
  await expect(page.getByText('Exposed .env File with Plaintext Credentials')).toBeVisible()
  await expect(page.getByText('FIND-2026-001')).toBeVisible()
  await expect(page.getByText('parsed from file')).toBeVisible()
  await expect(page.getByText('parsed defaults')).toBeVisible()
  await expect(page.getByText('Unauthenticated RCE via PHP Deserialization')).toHaveCount(0)
  await expect(page.getByText('Alex Kim')).toHaveCount(0)
  await expect(page.getByText('Run PoC')).toHaveCount(0)
  await expect(page.getByText('Mark as Verified')).toHaveCount(0)
  await expect(page.getByText('recon (1)')).toBeVisible()
})

test('severity bar filters real rows and the detail modal shows raw source plus artifact preview', async ({ page }) => {
  await interceptFindings(page)
  await page.goto(`/projects/${PROJECT_ID}/findings`)
  await page.getByText('Critical', { exact: true }).first().click()
  await expect(page.getByText('Exposed .env File with Plaintext Credentials')).toBeVisible()
  await expect(page.getByText('Untitled finding')).toHaveCount(0)
  await page.getByText('Critical', { exact: true }).first().click()
  await page.getByText('Exposed .env File with Plaintext Credentials').click()
  await expect(page.getByText('parser defaults — not analyst-confirmed')).toHaveCount(0)
  await expect(page.getByText('Raw source (512 B)')).toBeVisible()
  await expect(page.getByText('# FIND-2026-001')).toBeVisible()
  await expect(page.getByText('recon', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /nmap\.txt/ }).first().click()
  await expect(page.getByText('recon/nmap.txt • TEXT • 5 B')).toBeVisible()
  await expect(page.getByText('Review workflows (verified/assign/report export) need persistence services and are not rendered.')).toBeVisible()
})
