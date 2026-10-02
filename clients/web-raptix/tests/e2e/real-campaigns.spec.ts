import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W17 real Vector Campaigns and C2 specs: persisted drafts, truthful
 * provider jobs (status `unavailable`, never Generated/Delivered), the
 * engagement-scoped C2 unavailable state, and no fabricated wave states.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w17-campaigns-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w17-campaigns-fixture', displayName: 'W17 Campaigns Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

interface CampaignRow {
  id: string
  engagementId: string
  name: string
  vector: string
  status: string
  version: number
  spec: Record<string, unknown>
  jobs: Array<{ id: string; campaignId: string; kind: string; status: string; provider: string | null; error: string | null; createdAt: string }>
  createdAt: string
  updatedAt: string
}

function campaignFixture(id: string, name: string, jobs: CampaignRow['jobs']): CampaignRow {
  return { id, engagementId: PROJECT_ID, name: name.length > 0 ? name : `Draft ${id}`, vector: 'phishing', status: 'draft', version: 1, spec: { scenario: 'it-security-alert' }, jobs, createdAt: TIME, updatedAt: TIME }
}

async function intercept(page: Page): Promise<{ created: unknown[]; jobs: Array<{ campaignId: string; kind: string }> }> {
  const state = { created: [] as unknown[], jobs: [] as Array<{ campaignId: string; kind: string }> }
  const campaigns: CampaignRow[] = []
  let seq = 0
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/campaigns`, route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name?: string; vector?: string; scenario?: string }
      seq += 1
      const row = campaignFixture(`camp-${seq}`, body.name ?? '', [])
      row.vector = body.vector ?? 'phishing'
      row.spec = { scenario: body.scenario ?? null }
      campaigns.push(row)
      state.created.push(body)
      return json(route, row, 201)
    }
    return json(route, { engagementId: PROJECT_ID, campaigns, truncated: false })
  })
  await page.route(`**/api/engagements/${PROJECT_ID}/campaigns/*/generate`, route => {
    const campaignId = route.request().url().split('/campaigns/')[1]?.split('/generate')[0] ?? ''
    state.jobs.push({ campaignId, kind: 'generate' })
    const job = { id: `job-${campaignId}-g`, campaignId, kind: 'generate', status: 'unavailable', provider: null, error: 'campaign provider not configured', createdAt: TIME }
    const row = campaigns.find(entry => entry.id === campaignId)
    if (row) row.jobs = [job, ...row.jobs]
    return json(route, job)
  })
  await page.route(`**/api/engagements/${PROJECT_ID}/campaigns/*/deploy`, route => {
    const campaignId = route.request().url().split('/campaigns/')[1]?.split('/deploy')[0] ?? ''
    state.jobs.push({ campaignId, kind: 'deploy' })
    const job = { id: `job-${campaignId}-d`, campaignId, kind: 'deploy', status: 'unavailable', provider: null, error: 'campaign provider not configured', createdAt: TIME }
    const row = campaigns.find(entry => entry.id === campaignId)
    if (row) row.jobs = [job, ...row.jobs]
    return json(route, job)
  })
  await page.route(`**/api/engagements/${PROJECT_ID}/c2/sessions`, route => json(route, { statusCode: 503, error: { code: 'unavailable', message: 'C2 session provider not configured; no session registry exists in this build' } }, 503))
  return state
}

test('creates a persisted draft through the real form and lists it from the server', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/campaigns`)
  await expect(page.getByRole('heading', { name: 'Vector Campaigns' })).toBeVisible()
  await expect(page.getByText('No campaign drafts yet for this engagement.')).toBeVisible()
  await page.getByLabel('Campaign name').fill('Phishing Wave 1')
  await page.getByLabel('Campaign vector').selectOption('web')
  await page.getByLabel('Campaign scenario').fill('it-security-alert')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByText('Phishing Wave 1')).toBeVisible()
  await expect(page.getByText('status draft')).toBeVisible()
  await expect(page.getByText('No jobs recorded for this campaign.')).toBeVisible()
})

test('generate and deploy record truthful unavailable jobs and the draft stays draft', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/campaigns`)
  await page.getByLabel('Campaign name').fill('Wave A')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByText('Wave A')).toBeVisible()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('recorded with status unavailable')
  await expect(page.getByText('generate:unavailable')).toBeVisible()
  await page.getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect(page.getByText('deploy:unavailable')).toBeVisible()
  await expect(page.getByText('status draft')).toBeVisible()
  await expect(page.getByText(/Generated|Delivered/)).toHaveCount(0)
})

test('C2 sessions state the unavailable provider instead of fabricating sessions', async ({ page }) => {
  await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/sessions`)
  await expect(page.getByRole('heading', { name: 'C2 & Sessions' })).toBeVisible()
  await expect(page.getByText('C2 provider not configured')).toBeVisible()
  await expect(page.getByText('Server answered 503', { exact: false })).toBeVisible()
  await expect(page.getByText('whoami', { exact: false })).toHaveCount(0)
  await expect(page.getByText('hostname', { exact: false })).toHaveCount(0)
})
