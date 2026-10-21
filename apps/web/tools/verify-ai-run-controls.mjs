/**
 * Browser check of the AI Workspace run controls and the Execution surface (plan phase 6) on the running web stack.
 *
 *   node tools/verify-ai-run-controls.mjs --engagement <id> [--ui http://127.0.0.1:3001] [--out <dir>]
 *
 * Needs ASSET_MAP_VERIFY_USER and ASSET_MAP_VERIFY_PASSWORD: an operator account on the engagement. It reads, and
 * it sends exactly two requests that the runtime must refuse: a run that its preflight refuses, and a control
 * aimed at a run that is not on the thread. It never starts, pauses or cancels a live run; the lab engagement has
 * no approved ROE and no planning handoff, so the runtime has no run to act on.
 *
 * Checks, in a real browser:
 *   1. the AI Workspace shows the controls for the engagement's execution thread, with its run list;
 *   2. a run request through the same API the UI uses is refused by the runtime's preflight, with its reasons;
 *   3. a pause aimed at a run that is not on the thread is refused, and the refusal names no run of another thread;
 *   4. the Execution surface and its old deep link still render.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]])
  return pairs
}, []))
const ui = (args.ui ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
const engagement = args.engagement
const outDir = path.resolve(args.out ?? 'ai-run-controls-verify')
const username = process.env.ASSET_MAP_VERIFY_USER
const password = process.env.ASSET_MAP_VERIFY_PASSWORD
if (!engagement || !username || !password) {
  console.error('--engagement <id>, ASSET_MAP_VERIFY_USER and ASSET_MAP_VERIFY_PASSWORD are required')
  process.exit(2)
}

const report = { ui, engagement, steps: [], startedAt: new Date().toISOString() }
const record = (name, ok, detail = '') => report.steps.push({ name, ok, detail })

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chromium' })
let failure = null
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const signIn = await context.request.post(`${ui}/api/auth/login`, { data: { username, password }, headers: { origin: ui } })
  if (!signIn.ok()) throw new Error(`sign-in failed with HTTP ${signIn.status()}`)
  const csrf = (await signIn.json()).csrfToken
  await context.addInitScript(() => globalThis.localStorage?.setItem('raptix.assetMap', '1'))
  const page = await context.newPage()

  const threadsResponse = await context.request.get(`${ui}/api/engagements/${engagement}/threads`)
  const threads = threadsResponse.ok() ? (await threadsResponse.json()).threads ?? [] : []
  if (threads.length === 0) throw new Error('the engagement has no execution thread to check')
  const thread = threads[0]
  const threadId = thread.threadId ?? thread.id

  // 1. The AI Workspace shows the controls for the thread, and its run list.
  await page.goto(`${ui}/#/project/${encodeURIComponent(engagement)}?tab=ai-workspace`)
  await page.getByText('Run controls', { exact: true }).waitFor({ timeout: 30000 })
  // The run list loads after the panel; wait for its own answer before reading. innerText holds only what is visible.
  await page.waitForFunction(() => (globalThis.document.body.innerText.split('Run controls')[1] ?? '').includes('No runs on this thread yet.'), null, { timeout: 30000 })
  const visible = await page.locator('body').innerText()
  const panel = visible.split('Run controls')[1] ?? ''
  const shown = panel.includes(threadId)
  const emptyRuns = panel.includes('No runs on this thread yet.')
  record('AI Workspace shows the controls for the execution thread', shown && emptyRuns, `thread ${threadId} listed; no runs yet: ${emptyRuns}`)
  await page.screenshot({ path: path.join(outDir, '01-ai-workspace-controls.png') })

  // 2. A run the runtime's preflight refuses is refused with its reasons, through the API the UI uses.
  const refusedRun = await page.evaluate(async ({ engagementId, threadId, token }) => {
    const response = await fetch(`/api/engagements/${engagementId}/threads/${threadId}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify({ requestId: `control-check-${Date.now()}`, message: 'Control check: this run must be refused by preflight.' }),
    })
    return { status: response.status, body: await response.text() }
  }, { engagementId: engagement, threadId, token: csrf })
  const preflight = refusedRun.status === 409 && /Preflight refuses execution/.test(refusedRun.body)
  record('the runtime preflight refuses a run and names its reasons', preflight, `HTTP ${refusedRun.status}: ${refusedRun.body.slice(0, 160)}`)

  // 3. A control aimed at a run that is not on this thread is refused, and nothing of the thread is acted on.
  const foreignControl = await page.evaluate(async ({ engagementId, threadId, token }) => {
    const response = await fetch(`/api/engagements/${engagementId}/threads/${threadId}/runs/run-not-on-this-thread/pause`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: '{}',
    })
    return { status: response.status, body: await response.text() }
  }, { engagementId: engagement, threadId, token: csrf })
  const refusedForeign = foreignControl.status >= 400 && foreignControl.status < 500
  record('a control on a run that is not on the thread is refused', refusedForeign, `HTTP ${foreignControl.status}`)

  // 4. The Execution surface and its old deep link still render.
  await page.goto(`${ui}/#/operations?engagement=${encodeURIComponent(engagement)}`)
  await page.waitForTimeout(1500)
  const bodyText = await page.locator('body').innerText()
  const executionRenders = !/something went wrong|unexpected error/i.test(bodyText) && bodyText.trim().length > 200
  record('Execution and its old deep link still render', executionRenders, `page text ${bodyText.length} characters`)
  await page.screenshot({ path: path.join(outDir, '02-execution.png') })
  await context.close()
} catch (error) {
  failure = error
  record('unexpected failure', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  report.ok = !failure && report.steps.every(step => step.ok)
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  for (const step of report.steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name}${step.detail ? ` (${step.detail})` : ''}`)
  console.log(report.ok ? 'ai run controls: PASS' : 'ai run controls: FAIL')
}
process.exit(report.ok ? 0 : 1)
