import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W18 real Credentials Vault specs: redacted metadata by default (no
 * plaintext anywhere in the DOM), explicit audited reveal, and audited
 * revocation. No fixture eye-toggle may exist.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w18-vault-project'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w18-vault-fixture', displayName: 'W18 Vault Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

interface SecretRow {
  id: string
  engagementId: string
  kind: string
  label: string
  createdBy: string
  revealCount: number
  lastRevealedAt: string | null
  createdAt: string
  updatedAt: string
}

function secretFixture(id: string, label: string): SecretRow {
  return { id, engagementId: PROJECT_ID, kind: 'api-key', label, createdBy: 'local', revealCount: 0, lastRevealedAt: null, createdAt: TIME, updatedAt: TIME }
}

async function intercept(page: Page): Promise<{ stored: unknown[]; revealed: string[]; revoked: string[] }> {
  const state = { stored: [] as unknown[], revealed: [] as string[], revoked: [] as string[] }
  const secrets: SecretRow[] = []
  let seq = 0
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/vault/secrets`, route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { kind?: string; label?: string; plaintext?: string }
      state.stored.push(body)
      seq += 1
      const row = secretFixture(`sec-${seq}`, body.label ?? '')
      row.kind = body.kind ?? 'note'
      secrets.push(row)
      return json(route, row, 201)
    }
    return json(route, { engagementId: PROJECT_ID, secrets, truncated: false, source: 'db' })
  })
  await page.route(`**/api/engagements/${PROJECT_ID}/vault/secrets/*/reveal`, route => {
    const secretId = route.request().url().split('/vault/secrets/')[1]?.split('/reveal')[0] ?? ''
    state.revealed.push(secretId)
    const row = secrets.find(entry => entry.id === secretId)
    if (row) { row.revealCount += 1; row.lastRevealedAt = TIME }
    return json(route, { secretId, engagementId: PROJECT_ID, plaintext: 'the-revealed-value', revealedAt: TIME })
  })
  await page.route(`**/api/engagements/${PROJECT_ID}/vault/secrets/*`, route => {
    if (route.request().method() !== 'DELETE') return json(route, { error: { message: 'method not handled' } }, 405)
    const secretId = route.request().url().split('/vault/secrets/')[1] ?? ''
    state.revoked.push(secretId)
    const index = secrets.findIndex(entry => entry.id === secretId)
    if (index !== -1) secrets.splice(index, 1)
    return json(route, { ok: true })
  })
  return state
}

test('stores a secret and shows only redacted metadata, never the plaintext', async ({ page }) => {
  const state = await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/credentials`)
  await expect(page.getByRole('heading', { name: 'Credentials Vault' })).toBeVisible()
  await expect(page.getByText('No secrets stored for this engagement.')).toBeVisible()
  await page.getByLabel('Secret label').fill('Grafana admin')
  await page.getByLabel('Secret value').fill('the-stored-value')
  await page.getByRole('button', { name: 'Store secret' }).click()
  await expect(page.getByText('Grafana admin')).toBeVisible()
  await expect(page.getByText('Reveals: 0')).toBeVisible()
  expect(state.stored[0]).toMatchObject({ kind: 'password', label: 'Grafana admin', plaintext: 'the-stored-value' })
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).not.toContain('the-stored-value')
})

test('reveal shows plaintext only after the explicit action and updates the audit metadata', async ({ page }) => {
  const state = await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/credentials`)
  await page.getByLabel('Secret label').fill('Router')
  await page.getByLabel('Secret value').fill('router-value')
  await page.getByRole('button', { name: 'Store secret' }).click()
  await expect(page.getByText('Router')).toBeVisible()
  await expect(page.getByText('Reveals: 0')).toBeVisible()
  await page.getByRole('button', { name: 'Reveal', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('written to the engagement audit log')
  await expect(page.getByRole('status')).toContainText('the-revealed-value')
  await expect(page.getByText('Reveals: 1')).toBeVisible()
  expect(state.revealed).toHaveLength(1)
})

test('revocation removes the secret and keeps the flow truthful', async ({ page }) => {
  const state = await intercept(page)
  await page.goto(`/projects/${PROJECT_ID}/credentials`)
  await page.getByLabel('Secret label').fill('Rotate me')
  await page.getByLabel('Secret value').fill('rotate-value')
  await page.getByRole('button', { name: 'Store secret' }).click()
  await expect(page.getByText('Rotate me')).toBeVisible()
  await page.getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByText('No secrets stored for this engagement.')).toBeVisible()
  expect(state.revoked).toHaveLength(1)
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).not.toContain('rotate-value')
})
