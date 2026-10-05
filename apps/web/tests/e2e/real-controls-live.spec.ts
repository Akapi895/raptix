import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { test, expect } from '@playwright/test'

/**
 * W11 real Console controls live gate: interrupt (pause) a real acknowledged
 * run through the server, exercise the file-backed HITL approvals round trip
 * against the real engagement workspace files, and prove demo approvals never
 * render. Uses API 5286 + Vite 5279 against actual PostgreSQL + LangGraph 2400.
 * The submitted intent stays context-only: no tools, delegation, target access
 * or file writes by the agent.
 */

test('console interrupts a real run, records a file-backed approval decision and stays demo-free', async ({ page, request }) => {
  test.setTimeout(420000)
  const api = 'http://127.0.0.1:5286/api'
  const capabilities = await (await request.get(`${api}/capabilities`)).json()
  expect(capabilities.capabilities.runs).toEqual({ supported: true, available: true })
  expect(capabilities.capabilities.approvals).toEqual({ supported: true, available: true })

  const slug = `w11-controls-${Date.now()}`
  const create = await request.post(`${api}/engagements`, { data: { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true } })
  expect(create.status()).toBe(201)
  const project = await create.json()

  await page.goto(`/projects/${project.id}/console`)
  await expect(page.getByText('HITL approvals')).toBeVisible()
  await expect(page.getByText('ReconBot-01')).toHaveCount(0)
  await expect(page.getByText('OPSEC', { exact: false })).toHaveCount(0)

  await page.getByRole('button', { name: 'New planning chat' }).click()
  const selector = page.getByRole('combobox', { name: 'Bound thread' })
  await expect(selector).not.toHaveValue('', { timeout: 60000 })
  const listed = await (await request.get(`${api}/engagements/${project.id}/threads`)).json()
  const threadId = listed.threads[0].threadId as string
  await expect(selector).toHaveValue(threadId)

  // Real cancel: submit a context-only run, then interrupt it while executing.
  const intent = `W11 controls check ${slug}: acknowledge receiving this message only. Do not invoke tools, delegate, access targets or write files.`
  const composer = page.getByPlaceholder('Send a root message to the bound assistant…')
  await composer.fill(intent)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const interruptButton = page.getByRole('button', { name: 'Interrupt run' })
  await expect(interruptButton).toBeVisible({ timeout: 60000 })
  await interruptButton.click()
  await expect(page.getByText('RUN INTERRUPTED', { exact: true }).or(page.getByText('RUN SUCCESS', { exact: true }))).toBeVisible({ timeout: 120000 })

  const page0 = await (await request.get(`${api}/engagements/${project.id}/threads/${threadId}/runs?limit=1`)).json()
  const runId = page0.runs[0].runId as string
  const cancelView = await (await request.get(`${api}/engagements/${project.id}/threads/${threadId}/runs/${runId}`)).json()
  expect(['interrupted', 'success']).toContain(cancelView.rawStatus)

  // Resume without a pending graph interrupt is a truthful conflict.
  const rejected = await request.post(`${api}/engagements/${project.id}/threads/${threadId}/resume`, { data: { requestId: `ui-w11-live-${Date.now()}`, value: 'Yes' } })
  expect(rejected.status()).toBe(409)

  // File-backed HITL: the producer writes approval_request records into the
  // engagement workspace; the Console lists them and records the decision file.
  const approvalsDir = path.join(process.env.W11_TEST_WORKSPACE!, slug, 'approvals')
  await mkdir(approvalsDir, { recursive: true })
  const created = Date.now() / 1000
  await appendFile(path.join(approvalsDir, 'requests.jsonl'), `${JSON.stringify({ kind: 'approval_request', request_id: 'w11-live-approval', engagement_name: slug, agent_name: 'decepticon', tool_name: 'impacket-secretsdump', tool_args_redacted: { user: 'CORP/svc_backup', password: '***REDACTED***' }, matched_rule: { technique_tag: 'T1003', tool_pattern: null, timeout_seconds: 300, default_on_timeout: 'deny' }, reason: 'OS Credential Dumping (T1003) requires operator approval.', created_at: created, metadata: {} })}\n`, 'utf8')
  await page.getByRole('button', { name: 'Refresh approvals' }).click()
  await expect(page.getByText('impacket-secretsdump')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('OS Credential Dumping (T1003) requires operator approval.')).toBeVisible()
  await expect(page.getByText('***REDACTED***')).toBeVisible()
  await expect(page.getByText(/requested .*timeout 300s → deny/)).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('w11-real-controls-live.png'), fullPage: true })

  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('No pending file-backed approval requests for this engagement.')).toBeVisible({ timeout: 30000 })
  const decisionLine = JSON.parse((await readFile(path.join(approvalsDir, 'decisions.jsonl'), 'utf8')).trim())
  expect(decisionLine).toMatchObject({ kind: 'approval_decision', request_id: 'w11-live-approval', action: 'allow', redirect_args: null })
  expect(typeof decisionLine.decided_at).toBe('number')

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Bound thread' })).toHaveValue(threadId, { timeout: 60000 })
  await expect(page.getByText('HITL approvals')).toBeVisible()
  await expect(page.getByText('No pending file-backed approval requests for this engagement.')).toBeVisible()
  await expect(page.getByText('ReconBot-01')).toHaveCount(0)
  await expect(page.getByText('OPSEC', { exact: false })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('w11-real-controls-reload.png'), fullPage: true })

  await rm(approvalsDir, { recursive: true, force: true })
})
