import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { test, expect } from '@playwright/test'

/**
 * W14 live gate: the operations timeline merges labeled workspace markers into
 * the real UI, the export attachments return the actual engagement payload with
 * correct headers, unsupported formats are rejected server-side and demo data
 * never appears. The runtime is intentionally not seeded with runs, so the
 * timeline is empty-and-truthful for run/checkpoint sources while workspace
 * markers appear.
 */

const api = 'http://127.0.0.1:5295/api'
const slug = `w14-logs-${Date.now()}`

test('live timeline shows workspace markers, exports real attachments and rejects unsupported formats', async ({ page, request }) => {
  test.setTimeout(120000)
  const capabilities = (await (await request.get(`${api}/capabilities`)).json()).capabilities
  expect(capabilities.timeline).toEqual({ supported: true, available: true })
  expect(capabilities.reports).toEqual({ supported: true, available: true })
  const create = await request.post(`${api}/engagements`, { data: { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true } })
  expect(create.status()).toBe(201)
  const project = await create.json()

  const dir = path.join(process.env.W14_TEST_WORKSPACE!, slug)
  await mkdir(path.join(dir, 'recon'), { recursive: true })
  await mkdir(path.join(dir, 'findings'), { recursive: true })
  await writeFile(path.join(dir, 'recon', 'probe.txt'), 'open 80,443', 'utf8')
  await writeFile(path.join(dir, 'findings', 'FIND-2026-LIVE.md'), '# Exposed .env (W14 live)\n\nSeverity: high\n', 'utf8')

  try {
    const timelineResponse = await request.get(`${api}/engagements/${project.id}/timeline`)
    expect(timelineResponse.status()).toBe(200)
    const timeline = await timelineResponse.json()
    expect(timeline.source).toBe('mixed')
    const workspaceEntries = timeline.entries.filter((entry: { source: string }) => entry.source === 'workspace')
    expect(workspaceEntries.map((entry: { id: string }) => entry.id).sort()).toEqual(['workspace:findings/FIND-2026-LIVE.md', 'workspace:recon/probe.txt'])

    const badFormat = await request.get(`${api}/engagements/${project.id}/export?format=pdf`)
    expect(badFormat.status()).toBe(400)
    expect((await badFormat.json()).error.message).toContain('json, markdown')

    const jsonExport = await request.get(`${api}/engagements/${project.id}/export?format=json`)
    expect(jsonExport.status()).toBe(200)
    expect(jsonExport.headers()['content-disposition']).toBe(`attachment; filename="${slug}-export.json"`)
    const payload = await jsonExport.json()
    expect(payload.engagement.id).toBe(project.id)
    expect(payload.findings.map((finding: { id: string }) => finding.id)).toEqual(['FIND-2026-LIVE'])

    const foreign = await request.get(`${api}/engagements/not-a-real-engagement/timeline`)
    expect(foreign.status()).toBe(404)

    await page.goto(`/projects/${project.id}/logs`)
    await expect(page.getByRole('heading', { name: 'Operations Log' })).toBeVisible()
    await expect(page.getByText('2 entries', { exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Artifact updated: recon/probe.txt' })).toBeVisible()
    await expect(page.getByText('● Live')).toHaveCount(0)
    await page.getByRole('cell', { name: 'Artifact updated: recon/probe.txt' }).click()
    await expect(page.getByText('it is not an exact tool execution time')).toBeVisible()
    await page.getByRole('button', { name: 'Close log entry detail' }).click()

    await page.goto(`/projects/${project.id}/reports`)
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
    await expect(page.getByText('1 high').first()).toBeVisible()
    await page.getByRole('button', { name: 'Export JSON' }).click()
    await expect(page.getByText(new RegExp(`Download ready: .*${slug}-export\\.json`))).toBeVisible({ timeout: 15000 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  await page.goto(`/projects/${project.id}/logs`)
  await expect(page.getByText('No log entries match. An empty log is a truthful state')).toBeVisible({ timeout: 15000 })
})
