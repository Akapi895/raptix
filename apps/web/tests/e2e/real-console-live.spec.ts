import { test, expect } from '@playwright/test'

/**
 * W10 real Operator Console live gate: the real-mode component tree drives the
 * compiled new API (5285) against actual PostgreSQL + LangGraph 2400. The only
 * intent submitted is a context-only acknowledgement request — no tools,
 * delegation, target access or file writes. Every card on the timeline must
 * come from server-acknowledged run data or owned checkpoint history; the
 * source demo timeline (ReconBot-01/OPSEC/HITL approve) must never render.
 */

test('console creates a planning thread, submits a root run, renders live/public history and recovers over reload', async ({ page, request }) => {
  test.setTimeout(300000)
  const api = 'http://127.0.0.1:5285/api'
  expect((await (await request.get(`${api}/capabilities`)).json()).capabilities.runs).toEqual({ supported: true, available: true })
  const slug = `w10-console-${Date.now()}`
  const create = await request.post(`${api}/engagements`, { data: { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true } })
  expect(create.status()).toBe(201)
  const project = await create.json()

  await page.goto(`/projects/${project.id}/console`)
  await expect(page.getByText('Execution Timeline')).toBeVisible()
  await expect(page.getByText('ReconBot-01')).toHaveCount(0)
  await expect(page.getByText('OPSEC', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(page.getByText('Select a bound thread or create a new planning chat.')).toBeVisible()
  await expect(page.getByText('NO ACTIVE RUN')).toBeVisible()

  await page.getByRole('button', { name: 'New planning chat' }).click()
  const selector = page.getByRole('combobox', { name: 'Bound thread' })
  await expect(selector).not.toHaveValue('', { timeout: 60000 })
  await expect(page.getByText('planning thread', { exact: false })).toBeVisible()

  const listed = await (await request.get(`${api}/engagements/${project.id}/threads`)).json()
  expect(listed.source).toBe('runtime')
  expect(listed.threads).toHaveLength(1)
  expect(listed.threads[0].kind).toBe('planning')
  const threadId = listed.threads[0].threadId as string
  await expect(selector).toHaveValue(threadId)

  const intent = `W10 console check ${slug}: acknowledge receiving this message only. Do not invoke tools, delegate, access targets or write files.`
  const composer = page.getByPlaceholder('Send a root message to the bound assistant…')
  await composer.fill(intent)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(intent)).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('RUN', { exact: false }).first()).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('AGENT', { exact: true }).first()).toBeVisible({ timeout: 240000 })
  await expect(page.getByText('RUN SUCCESS', { exact: true })).toBeVisible({ timeout: 240000 })

  const page1 = await (await request.get(`${api}/engagements/${project.id}/threads/${threadId}/runs?limit=10`)).json()
  expect(page1.runs).toHaveLength(1)
  expect(page1.runs[0].rawStatus).toBe('success')

  await page.reload()
  const selectorAfterReload = page.getByRole('combobox', { name: 'Bound thread' })
  await expect(selectorAfterReload).toHaveValue(threadId, { timeout: 60000 })
  await expect(page.getByText(intent)).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('AGENT', { exact: true }).first()).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('HISTORY', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('NO ACTIVE RUN')).toBeVisible()
  await expect(page.getByText('ReconBot-01')).toHaveCount(0)
  await expect(page.getByText('OPSEC', { exact: false })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('w10-real-console-live.png'), fullPage: true })
})
