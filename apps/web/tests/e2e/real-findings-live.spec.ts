import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { test, expect } from '@playwright/test'

/**
 * W12 live findings gate against the real server and the real test workspace:
 * parsed workspace findings appear in the UI with parser-quality provenance,
 * the artifact browser previews real allowlisted files only, other engagements
 * stay invisible and demo data never appears.
 */

const api = 'http://127.0.0.1:5291/api'
const slug = `w12-findings-${Date.now()}`
const findingBody = [
  '# Exposed .env File (Live Gate)',
  '',
  'Severity: critical',
  'CVSS score: 9.1',
  '',
  '## Description',
  'The live gate exposes a `.env` file via HTTP.',
  '',
  '## Evidence',
  '- GET /.env returned 200',
  '',
  '## Affected Assets',
  '- api.acme.invalid/.env',
  '',
].join('\n')

test('live findings parse workspace files, preview real artifacts and stay engagement-scoped without demo data', async ({ page, request }) => {
  test.setTimeout(120000)
  expect((await (await request.get(`${api}/capabilities`)).json()).capabilities.findings).toEqual({ supported: true, available: true })
  const create = await request.post(`${api}/engagements`, { data: { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true } })
  expect(create.status()).toBe(201)
  const project = await create.json()

  const dir = path.join(process.env.W12_TEST_WORKSPACE!, slug)
  await mkdir(path.join(dir, 'findings'), { recursive: true })
  await mkdir(path.join(dir, 'recon'), { recursive: true })
  await writeFile(path.join(dir, 'findings', 'FIND-2026-LIVE.md'), findingBody, 'utf8')
  await writeFile(path.join(dir, 'recon', 'probe.txt'), 'open 80,443', 'utf8')

  try {
    await page.goto(`/projects/${project.id}/findings`)
    await expect(page.getByText('Exposed .env File (Live Gate)')).toBeVisible()
    await expect(page.getByText('FIND-2026-LIVE')).toBeVisible()
    await expect(page.getByText('parsed from file')).toBeVisible()
    await expect(page.getByText('parsed defaults')).toHaveCount(0)
    await expect(page.getByText('Unauthenticated RCE via PHP Deserialization')).toHaveCount(0)

    await page.getByText('Exposed .env File (Live Gate)').click()
    await expect(page.getByText('parser defaults — not analyst-confirmed')).toHaveCount(0)
    await expect(page.getByText('The live gate exposes a `.env` file via HTTP.').first()).toBeVisible()
    await expect(page.getByText('# Exposed .env File (Live Gate)')).toBeVisible()
    await page.getByRole('button', { name: /probe\.txt/ }).first().click()
    await expect(page.getByText('recon/probe.txt • TEXT • 11 B')).toBeVisible()
    await expect(page.getByText('open 80,443')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    const foreign = await request.get(`${api}/engagements/not-a-real-engagement/findings`)
    expect(foreign.status()).toBe(404)
    const view = await request.get(`${api}/engagements/${project.id}/findings`)
    const body = await view.json()
    expect(body.findings).toHaveLength(1)
    expect(body.findings[0].severity).toBe('critical')
    expect(body.findings[0].cvssScore).toBe(9.1)
    expect(body.findings[0].affectedAssets).toEqual(['api.acme.invalid/.env'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  await page.getByRole('button', { name: '↻ Refresh' }).click()
  await expect(page.getByText('No parsed FIND-*.md files in this engagement workspace yet.')).toBeVisible({ timeout: 15000 })
})
