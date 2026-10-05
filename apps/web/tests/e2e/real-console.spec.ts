import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * W10 real Operator Console specs: src/features/agent-runs/RealConsole.tsx.
 *
 * The UI under test is the real-mode component tree (VITE_DATA_MODE=real);
 * the new API is served by controlled route interception so every assertion
 * is deterministic in CI without a backend. The component itself only talks
 * to /api — no fixture fallback exists in app code.
 */

const TIME = '2026-10-02T00:00:00.000Z'
const PROJECT_ID = 'w10-console-project'
const THREAD_ID = '01a0fabd-78b3-7b23-8899-65b9de146d83'

const project = {
  id: PROJECT_ID, workspaceSlug: 'w10-console-fixture', displayName: 'W10 Console Fixture',
  targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true,
  metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null,
  activeAgentCount: null, createdAt: TIME, updatedAt: TIME, source: 'api',
}

const binding = { engagementId: PROJECT_ID, threadId: THREAD_ID, assistantId: 'soundwave', kind: 'planning', createdAt: TIME, updatedAt: TIME }

const snapshot = {
  binding, rawStatus: 'interrupted',
  messages: [
    { role: 'user', content: 'Acknowledge this planning check.', messageId: 'm1' },
    { role: 'assistant', content: 'Acknowledged.', messageId: 'm2' },
  ],
  messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime',
  transcripts: [
    { key: 's1::subagent_end@2026-10-02T01:00:00+00:00', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_end', agent: 'recon', sessionId: 's1', elapsedSeconds: 2.5, status: 'success', truncated: false } },
    { key: 's2::ask_user_question#q1', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'ask_user_question', agent: 'soundwave', questionId: 'q1', question: 'Proceed with the authorized scan?', header: 'Confirm', options: [{ label: 'Yes', description: 'Continue planning' }, { label: 'No', description: 'Stop here' }], multiSelect: false, allowOther: true, truncated: false } },
  ],
  transcriptsTruncated: false,
  pendingQuestion: { questionId: 'q1', question: 'Proceed with the authorized scan?', header: 'Confirm', options: [{ label: 'Yes', description: 'Continue planning' }, { label: 'No', description: 'Stop here' }], multiSelect: false, allowOther: true, source: 'runtime' },
}

async function interceptConsole(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**/api/engagements/${PROJECT_ID}`, route => json(route, project))
  await page.route(`**/api/engagements/${PROJECT_ID}/threads`, route => json(route, { engagementId: PROJECT_ID, threads: [binding], source: 'runtime' }))
  await page.route(`**/api/engagements/${PROJECT_ID}/threads/${THREAD_ID}*`, route => json(route, snapshot))
  await page.route(`**/api/engagements/${PROJECT_ID}/threads/${THREAD_ID}/runs*`, route => json(route, { runs: [], offset: 0, nextOffset: null }))
  await page.route(`**/api/engagements/${PROJECT_ID}/threads/${THREAD_ID}/runs/**`, route => json(route, { error: 'not found in this fixture' }, 404))
  await page.route(`**/api/engagements/${PROJECT_ID}/approvals`, route => json(route, { engagementId: PROJECT_ID, approvals: [], source: 'workspace' }))
}

test('real console renders owned history, thread-level provenance and a restorable answer form without demo data', async ({ page }) => {
  await interceptConsole(page)
  await page.goto(`/projects/${PROJECT_ID}/console`)
  await expect(page.getByText('Execution Timeline')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Bound thread' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Bound thread' }).selectOption(THREAD_ID)
  await expect(page.getByText('OPERATOR', { exact: true })).toBeVisible()
  await expect(page.getByText('Acknowledged.')).toBeVisible()
  await expect(page.getByText('HISTORY', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('PLANNING QUESTION')).toBeVisible()
  await expect(page.getByText('Proceed with the authorized scan?')).toBeVisible()
  await expect(page.getByText('HITL approvals')).toBeVisible()
  await expect(page.getByText('No pending file-backed approval requests for this engagement.')).toBeVisible()
  const sendAnswer = page.getByRole('button', { name: 'Send answer & resume run' })
  await expect(sendAnswer).toBeDisabled()
  await page.getByRole('button', { name: /Yes Continue planning|Yes/ }).first().click()
  await expect(sendAnswer).toBeEnabled()
  await page.getByPlaceholder('Other — type a custom answer…').fill('Custom operator answer')
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(page.getByText('ReconBot-01')).toHaveCount(0)
  await expect(page.getByText('OPSEC')).toHaveCount(0)
  await expect(page.getByText('SESSIONS 1')).toBeVisible()
  await expect(page.getByText('QUESTIONS 1')).toBeVisible()
})

test('composer reflects the auto-selected bound thread and demo phases never appear', async ({ page }) => {
  await interceptConsole(page)
  await page.goto(`/projects/${PROJECT_ID}/console`)
  await expect(page.getByText('Phase 1: Initial Foothold')).toHaveCount(0)
  await expect(page.getByText('impacket-secretsdump')).toHaveCount(0)
  const send = page.getByRole('button', { name: 'Send', exact: true })
  await expect(page.getByRole('combobox', { name: 'Bound thread' })).toHaveValue(THREAD_ID)
  await expect(page.getByText('planning thread', { exact: false })).toBeVisible()
  await expect(send).toBeDisabled()
  await page.getByPlaceholder('Send a root message to the bound assistant…').fill('Prepared operator message')
  await expect(send).toBeEnabled()
})
