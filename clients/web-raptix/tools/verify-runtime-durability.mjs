import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Explicit live gate: recreates the local runtime/API/sandbox and needs an
// existing engagement with a real, validated planning bundle.
const engagement = process.env.IW13_ENGAGEMENT_ID
if (!engagement || !process.argv.includes('--recreate')) throw Error('Set IW13_ENGAGEMENT_ID and pass --recreate for this live gate')
const base = process.env.IW13_BASE_URL ?? 'http://127.0.0.1:3000'
const output = resolve(process.env.IW13_EVIDENCE_DIR ?? 'clients/web-raptix/test-results-deployed/iw13')
mkdirSync(output, { recursive: true })
const checks = []
const check = (name, ok) => { checks.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) throw Error(name) }
const api = async path => {
  const response = await fetch(`${base}/api/engagements/${engagement}${path}`)
  if (!response.ok) throw Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 240000 }).trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const poll = async read => {
  const deadline = Date.now() + 300000
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await sleep(3000) }
  throw Error('Live runtime deadline exceeded')
}
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage()
let planningThread, executionThread, question, resumeRun
const createThread = async kind => {
  const waiting = page.waitForResponse(r => r.url().endsWith('/threads') && r.request().method() === 'POST')
  await page.getByRole('button', { name: `New ${kind} chat`, exact: true }).click()
  const response = await waiting
  check(`${kind} thread create acknowledged`, response.status() === 201)
  const ack = await response.json()
  await page.waitForFunction(id => document.querySelector('select[aria-label="Bound thread"]')?.value === id, ack.threadId, { timeout: 60000 })
  return ack.threadId
}
const send = async (thread, message) => {
  await page.getByPlaceholder('Send a root message to the bound assistant…').fill(message)
  const waiting = page.waitForResponse(r => r.url().endsWith(`/threads/${thread}/runs`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const response = await waiting
  check('Run create acknowledged', response.status() === 202)
  return response.json()
}
try {
  check('Real planning bundle ready', (await api('/plan-docs')).readiness.state === 'ready')
  await page.goto(`${base}/projects/${engagement}/console`)
  planningThread = await createThread('planning')
  await send(planningThread, 'Local persistence check only. Call ask_user_question exactly once to confirm keeping the declared scope unchanged, then pause for my answer. After the answer reply with a short acknowledgement only. Do not generate documents or access any target.')
  question = await poll(async () => (await api(`/threads/${planningThread}`)).pendingQuestion)
  check('Runtime-produced pending question observed', Boolean(question.questionId))
  executionThread = await createThread('execution')
  const ack = await send(executionThread, 'Local history durability check: reply with the exact marker IW13_EXECUTION_HISTORY. Do not invoke tools, delegate, write files, or access any target.')
  await poll(async () => (await api(`/threads/${executionThread}/runs/${ack.runId}`)).rawStatus === 'success')
  const before = await api(`/threads/${executionThread}`)
  check('Execution checkpoint contains actual root history', before.messages.some(m => m.content.includes('IW13_EXECUTION_HISTORY')))

  // Host-side write into the canonical Docker filesystem, preserving Linux names.
  const hostMarker = resolve(output, 'host-marker.txt')
  writeFileSync(hostMarker, 'IW13_HOST_ROUNDTRIP')
  docker(['exec', 'raptix-sandbox', 'mkdir', '-p', '/workspace/iw13-coherence'])
  docker(['cp', hostMarker, 'raptix-sandbox:/workspace/iw13-coherence/host.txt'])
  docker(['exec', 'raptix-web-raptix-api', 'node', '-e', "require('fs').writeFileSync('/workspace/iw13-coherence/api.txt','IW13_API_ROUNDTRIP')"])

  docker(['compose', '-f', 'docker-compose.yml', 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '180', 'langgraph', 'sandbox'])
  docker(['compose', '-f', 'docker-compose.web-raptix.yml', 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'web-raptix-api'])
  const restored = await poll(async () => (await api(`/threads/${planningThread}`)).pendingQuestion)
  check('Same question ID after runtime recreate', restored.questionId === question.questionId)
  const after = await api(`/threads/${executionThread}`)
  check('Execution root history survives recreate', JSON.stringify(after.messages) === JSON.stringify(before.messages))
  check('Run metadata survives recreate', (await api(`/threads/${executionThread}/runs/${ack.runId}`)).rawStatus === 'success')
  for (const container of ['raptix-langgraph', 'raptix-sandbox', 'raptix-web-raptix-api']) {
    check(`${container} sees host marker after recreate`, docker(['exec', container, 'cat', '/workspace/iw13-coherence/host.txt']) === 'IW13_HOST_ROUNDTRIP')
    check(`${container} sees API marker after recreate`, docker(['exec', container, 'cat', '/workspace/iw13-coherence/api.txt']) === 'IW13_API_ROUNDTRIP')
  }
  const copiedBack = resolve(output, 'api-marker.txt')
  docker(['cp', 'raptix-web-raptix-api:/workspace/iw13-coherence/api.txt', copiedBack])
  check('Host reads the same canonical artifact', readFileSync(copiedBack, 'utf8') === 'IW13_API_ROUNDTRIP')

  await page.goto(`${base}/projects/${engagement}/console`)
  await page.locator('select[aria-label="Bound thread"]').selectOption(planningThread)
  const form = page.getByRole('button', { name: 'Send answer & resume run' })
  await form.waitFor({ timeout: 60000 })
  await page.screenshot({ path: resolve(output, 'restored-question.png'), fullPage: true })
  await page.getByPlaceholder('Other — type a custom answer…').fill('Keep the declared scope unchanged. This is a persistence integration check only. Reply with a short acknowledgement; do not generate documents or access targets.')
  const waiting = page.waitForResponse(r => r.url().endsWith(`/threads/${planningThread}/resume`) && r.request().method() === 'POST')
  await form.click()
  const response = await waiting
  check('UI answer/resume accepted after recreate', response.status() === 202)
  resumeRun = (await response.json()).runId
  await poll(async () => (await api(`/threads/${planningThread}/runs/${resumeRun}`)).rawStatus === 'success')
  check('Resumed run reaches success', !(await api(`/threads/${planningThread}`)).pendingQuestion)
  await page.screenshot({ path: resolve(output, 'resumed-run.png'), fullPage: true })
} finally {
  writeFileSync(resolve(output, 'durability.json'), JSON.stringify({ engagementId: engagement, planningThread, executionThread, questionId: question?.questionId, resumeRun, checks }, null, 2))
  await browser.close()
}
