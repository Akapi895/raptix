// Real LangGraph + hardened sandbox + current Web API/browser acceptance flow.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SseDecoder } from '@raptix/streaming'
import { isPublicStreamEvent } from '@raptix/web-contracts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const secrets = []
const redact = text => secrets.reduce((s, secret) => s.replaceAll(secret, '<REDACTED>'), String(text))
function docker(args, timeout = 120000) {
  try { return execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
  catch (error) { throw Error(redact(`docker ${args[0]} failed: ${error.stderr ?? error.code ?? 'unknown'}`)) }
}
const inspect = name => JSON.parse(docker(['inspect', name]))[0]
const environment = container => Object.fromEntries(container.Config.Env.map(entry => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)] }))
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function poll(read, seconds = 240) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await sleep(1500) }
  throw Error('Bounded live verification deadline exceeded')
}
const port = (name, inner) => Number(docker(['port', name, `${inner}/tcp`]).match(/:(\d+)$/)?.[1])
const statePath = process.argv[3]
let state
function save() { writeFileSync(state.path, JSON.stringify(state, null, 2)) }

async function start() {
  const id = randomUUID().slice(0, 8)
  const output = resolve(root, 'tests/local/artifacts/integration-live', id)
  mkdirSync(output, { recursive: true })
  state = { id, slug: `web-acceptance-${id}`, output, path: resolve(output, 'state.json'), containers: [], checks: [], database: `raptix_web_acceptance_${id}`, volume: `raptix-web-acceptance-${id}`, image: 'raptix-web-verification-api:20261014' }
  save()
  console.log(`Evidence state: ${state.path}`)
  const postgres = environment(inspect('raptix-postgres'))
  const runtime = inspect('raptix-langgraph')
  const env = environment(runtime)
  const proxy = environment(inspect('raptix-litellm'))
  for (const [key, value] of Object.entries({ ...env, ...postgres, ...proxy })) if (/KEY|PASSWORD|TOKEN|SECRET/.test(key) && value.length > 7) secrets.push(value)
  docker(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${state.database}`])
  docker(['volume', 'create', state.volume])
  const sandboxName = `raptix-web-acceptance-${id}-sandbox`
  const sandboxArgs = ['run', '-d', '--name', sandboxName, '--label', `raptix.verification=${id}`, '--network', 'raptix_sandbox-net', '--init', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=4g', '--pids-limit=4096']
  for (const capability of ['NET_RAW', 'NET_ADMIN', 'NET_BIND_SERVICE', 'SYS_PTRACE', 'SETUID', 'SETGID', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'KILL']) sandboxArgs.push('--cap-add', capability)
  sandboxArgs.push('-v', `${state.volume}:/workspace`, '-e', 'SANDBOX_DAEMON=1', '-e', `RAPTIX_ENGAGEMENT=${state.slug}`, '-e', 'RAPTIX_WORKSPACE_ISOLATED=1', '-e', 'NEO4J_URI=bolt://neo4j:7687', '-e', 'NEO4J_USER=neo4j', '-e', `NEO4J_PASSWORD=${env.RAPTIX_NEO4J_PASSWORD}`, 'ghcr.io/akapi895/raptix-sandbox:stable')
  docker(sandboxArgs); state.containers.push(sandboxName); save()

  const runtimeName = `raptix-web-acceptance-${id}-runtime`
  const runtimeEnv = { ...env, RAPTIX_ENGAGEMENT: state.slug, RAPTIX_WORKSPACE_ISOLATED: '1', SANDBOX_URL: `http://${sandboxName}:9999`, RAPTIX_LLM__PROXY_URL: 'http://litellm:4000', RAPTIX_LLM__PROXY_API_KEY: proxy.LITELLM_MASTER_KEY }
  const args = ['run', '-d', '--name', runtimeName, '--label', `raptix.verification=${id}`, '--network', 'raptix_raptix-net', '-p', '127.0.0.1::2024', '-v', `${state.volume}:/workspace`]
  for (const mount of runtime.Mounts.filter(m => m.Destination.includes('.credentials.json') || m.Destination.includes('auth.json'))) args.push('-v', `${mount.Source}:${mount.Destination}:ro`)
  for (const [key, value] of Object.entries(runtimeEnv)) args.push('-e', `${key}=${value}`)
  args.push(runtime.Config.Image, 'langgraph', 'dev', '--host', '0.0.0.0', '--port', '2024', '--no-browser', '--allow-blocking')
  docker(args); state.containers.push(runtimeName); save()
  docker(['network', 'connect', 'raptix_sandbox-net', runtimeName])
  state.runtime = `http://127.0.0.1:${port(runtimeName, 2024)}`
  state.runtimeImageId = inspect(runtimeName).Image
  save()
  await poll(async () => { try { return (await fetch(`${state.runtime}/ok`, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } })
  console.log('Real LangGraph runtime healthy')
  const apiName = `raptix-web-acceptance-${id}-api`
  const url = `postgresql://raptix:${encodeURIComponent(postgres.POSTGRES_PASSWORD)}@postgres:5432/${state.database}`
  docker(['run', '-d', '--name', apiName, '--label', `raptix.verification=${id}`, '--network', 'raptix_raptix-net', '-p', '127.0.0.1::8081', '-v', `${state.volume}:/workspaces/${state.slug}`, '-e', `DATABASE_URL=${url}`, '-e', 'HOST=0.0.0.0', '-e', 'PORT=8081', '-e', 'WORKSPACE_PATH=/workspaces', '-e', `LANGGRAPH_API_URL=http://${runtimeName}:2024`, '-e', 'RAPTIX_RUNTIME_WORKSPACE_ROOT=/workspace', '-e', `RAPTIX_RUNTIME_WORKSPACE_SLUG=${state.slug}`, '-e', `RAPTIX_RUNTIME_SANDBOX_URL=http://${sandboxName}:9999`, state.image])
  state.containers.push(apiName)
  state.api = `http://127.0.0.1:${port(apiName, 8081)}`; save()
  await poll(async () => { try { return (await fetch(`${state.api}/api/health`, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } }, 120)
  console.log(`API ready: ${state.api}; runtime: ${state.runtime}`)
}

async function flow() {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
  const require = createRequire(resolve(process.env.RAPTIX_VERIFICATION_TOOLS, 'package.json'))
  const { chromium } = require('playwright')
  const checks = state.checks
  const check = (name, ok) => { checks.push({ name, ok }); save(); assert.ok(ok, name); console.log(`PASS ${name}`) }
  async function api(endpoint, method = 'GET', body, expected = 200) {
    const response = await fetch(`${state.api}/api${endpoint}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
    const payload = await response.json()
    assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(payload)}`)
    return payload
  }
  const appRequire = createRequire(resolve(root, 'apps/web/package.json'))
  const viteCli = resolve(dirname(appRequire.resolve('vite/package.json')), 'bin/vite.js')
  const vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '5297', '--strictPort'], { cwd: resolve(root, 'apps/web'), env: { ...process.env, RAPTIX_WEB_BACKEND_URL: state.api, VITE_DATA_MODE: 'real' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let viteLog = ''
  vite.stdout.on('data', chunk => { viteLog += chunk })
  vite.stderr.on('data', chunk => { viteLog += chunk })
  state.vitePid = vite.pid; state.viteCommand = 'node vite --port 5297 --strictPort'; save()
  let browser, page
  const errors = []
  try {
    await poll(async () => { try { return (await fetch('http://127.0.0.1:5297/api/health', { signal: AbortSignal.timeout(1000) })).ok } catch { return false } }, 30)
    browser = await chromium.launch()
    page = await browser.newPage()
    page.setDefaultTimeout(20000)
    page.on('pageerror', e => errors.push(e.message))
     page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) errors.push(message.text()) })
    page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`))
    page.on('response', async reply => {
      if (reply.request().method() !== 'POST' || !reply.url().includes('/api/')) return
      const body = await reply.json().catch(() => ({}))
      state.lastCommand = { url: reply.url(), status: reply.status(), requestId: body.requestId, runId: body.runId, error: body.error }
      save()
    })
    await page.goto('http://127.0.0.1:5297/?dataMode=real#/projects')
    const project = state.engagementId ? await api(`/engagements/${state.engagementId}`) : await api('/engagements', 'POST', { name: state.slug, displayName: 'Real runtime acceptance', targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, brief: 'Authorized local workspace-only acceptance. No remote target access. Informational pipeline output only.' }, 201)
    state.engagementId = project.id; save()
    const base = `/engagements/${project.id}`
    await page.goto(`http://127.0.0.1:5297/?dataMode=real#/ai-operator/${project.id}`)
    let ack = state.planningThread ? { state: 'accepted', threadId: state.planningThread } : null
    if (!ack) {
    const [threadResponse] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/threads') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'New planning thread', exact: true }).click(),
    ])
    ack = await threadResponse.json()
    }
    assert.equal(ack.state, 'accepted'); state.planningThread = ack.threadId; save()
    check('Browser creates actual Soundwave planning thread', !!ack.threadId)
    if ((await api(`${base}/plan-docs`)).readiness.state !== 'ready') {
    const schemas = JSON.parse(readFileSync(resolve(root, 'apps/web/server/src/services/planning-schemas.json'), 'utf8'))
    const compact = JSON.stringify(Object.fromEntries(Object.entries(schemas).filter(([name]) => name !== 'opplan')), (key, value) => ['title', 'description', 'default', 'examples'].includes(key) ? undefined : value)
    const startDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const instruction = `Local integration acceptance, not a target assessment. Engagement ${state.slug}. Client Local acceptance operator, authorization WEB-ACCEPTANCE-${state.id}; written authorization is already confirmed. Scope only https://authorized.invalid as a dummy metadata target; DO NOT access it or any network target. All execution is local workspace read/write. Dates ${startDate} through ${endDate} UTC, testing window any time within those dates. Prohibit external network probing, exploitation, credential access, deletion and persistence. First call ask_user_question once to confirm this local-only scope, with an Other answer allowed, then wait for my answer. After my answer, create all eight valid planning documents under /workspace/plan/{roe,conops,deconfliction,threat-profile,contact,data-handling,abort,cleanup}.json using your real filesystem tools. Every engagement_name must equal ${state.slug}; RoE must include authorization_reference WEB-ACCEPTANCE-${state.id} and in_scope target https://authorized.invalid. Use only fictional local contacts at example.invalid. Success criterion: an informational local evidence marker read back from disk, not a vulnerability. Use these actual schema contracts for validation: ${compact}`
    assert.ok(Buffer.byteLength(instruction) <= 16000, 'Planning message fits the API byte limit')
    await page.getByLabel('Workspace message').fill(instruction)
    const [runResponse] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/threads/${ack.threadId}/runs`) && r.request().method() === 'POST'), page.getByRole('button', { name: 'Send', exact: true }).click()])
    const runAck = await runResponse.json(); state.planningRun = runAck.runId; save()
    const question = await poll(async () => (await api(`${base}/threads/${ack.threadId}`)).pendingQuestion, 300)
    state.questionId = question.questionId; save()
    check('Real planner produces a checkpointed graph interrupt', !!question.interruptId)
    await page.reload()
    await page.getByText(question.question, { exact: true }).waitFor()
    check('Browser refresh restores the same pending question', (await api(`${base}/threads/${ack.threadId}`)).pendingQuestion.questionId === question.questionId)
    await page.getByLabel('Other answer').fill('Confirmed: only local workspace writes and reads; no target/network access. Generate the eight documents now using the provided schemas and authorization; retain evidence until this test is reviewed.')
    const [resumed] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/resume') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Answer', exact: true }).click()])
    const resume = await resumed.json(); state.planningResume = resume.runId; save()
    await poll(async () => {
      const run = await api(`${base}/threads/${ack.threadId}/runs/${resume.runId}`)
      if (['error', 'timeout'].includes(run.rawStatus)) throw Error(`Planner ended ${run.rawStatus}`)
      return (await api(`${base}/plan-docs`)).readiness.state === 'ready'
    }, 480)
    check('Real planner filesystem output makes server readiness ready', true)
    }
    await page.goto(`http://127.0.0.1:5297/?dataMode=real#/project/${project.id}`)
    await page.getByRole('tab', { name: 'Planning', exact: true }).click()
    if (!(await api(base)).handoffConfirmedAt) await Promise.all([page.waitForResponse(r => r.url().endsWith(`/engagements/${project.id}`) && r.request().method() === 'PATCH'), page.getByRole('button', { name: 'Confirm planning handoff', exact: true }).click()])
    check('Browser confirms ready handoff on actual server', !!(await api(base)).handoffConfirmedAt)
    await page.goto(`http://127.0.0.1:5297/?dataMode=real#/ai-operator/${project.id}`)
    let execution = state.executionThread ? { threadId: state.executionThread } : null
    if (!execution) {
      const [execCreate] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/threads') && r.request().method() === 'POST'), page.getByRole('button', { name: 'New execution thread', exact: true }).click()])
      execution = await execCreate.json(); state.executionThread = execution.threadId; save()
    } else {
      await page.getByRole('button', { name: 'execution', exact: true }).click()
      await page.getByRole('button', { name: new RegExp(execution.threadId) }).click()
    }
    await page.getByText('Server-verified runtime context', { exact: true }).waitFor()
    const context = await api(`${base}/runtime-context?kind=execution&threadId=${execution.threadId}`)
    check('Execution context verifies binding and real planning readiness', context.threadVerified && context.executionReady)
    let execAck = state.executionRun ? await api(`${base}/threads/${execution.threadId}/runs/${state.executionRun}`) : null
    if (!execAck) {
      await page.getByLabel('Workspace message').fill(`Execute the approved LOCAL-ONLY acceptance objective now. Do not contact any target or delegate network work. Use your real write_file tool to produce /workspace/findings/FIND-WEB-ACCEPTANCE.md with title Local acceptance marker, Severity: informational, a Description explicitly stating this is a pipeline check not a vulnerability, and Evidence containing marker WEB_ACCEPTANCE_${state.id}. Read it back from disk with read_file to verify actual creation, then finish. The source is your local filesystem tool; do not merely quote the proposed file in chat. Respect the stored RoE.`)
      const [execSend] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/threads/${execution.threadId}/runs`) && r.request().method() === 'POST'), page.getByRole('button', { name: 'Send', exact: true }).click()])
      execAck = await execSend.json(); assert.equal(execAck.state, 'accepted', JSON.stringify(execAck)); state.executionRun = execAck.runId; save()
    }
    await page.reload()
    await page.getByText('Server-verified runtime context', { exact: true }).waitFor()
    await poll(async () => {
      const run = await api(`${base}/threads/${execution.threadId}/runs/${execAck.runId}`)
      if (['error', 'timeout'].includes(run.rawStatus)) throw Error(`Execution ended ${run.rawStatus}`)
      return run.rawStatus === 'success'
    }, 300)
    const findings = await api(`${base}/findings`)
    const produced = findings.findings.find(f => f.id === 'FIND-WEB-ACCEPTANCE')
    check('Real execution produces an informational finding on disk', produced?.severity === 'informational' && produced.evidence.includes(`WEB_ACCEPTANCE_${state.id}`) && !produced.quality.defaultSeverity)
    const content = await api(`${base}/artifacts/content?path=${encodeURIComponent('findings/FIND-WEB-ACCEPTANCE.md')}`)
    check('Actual artifact inspector endpoint returns runtime-generated bytes', content.content.includes(`WEB_ACCEPTANCE_${state.id}`))
    await api(`${base}/artifacts/content?path=${encodeURIComponent('../../.env')}`, 'GET', undefined, 400)
    await api(`${base}/artifacts/content?path=${encodeURIComponent('findings/NO-SUCH-FILE.md')}`, 'GET', undefined, 404)
    await api(`/engagements/${randomUUID()}/threads/${state.executionThread}`, 'GET', undefined, 404)
    check('Actual API rejects traversal, missing artifacts and wrong engagement scope', true)
    const timeline = await api(`${base}/timeline`)
    check('Actual timeline preserves observed-source labels', timeline.source === 'mixed' && timeline.entries.every(e => ['runtime', 'checkpoint', 'workspace'].includes(e.source)))
    const native = await fetch(`${state.runtime}/threads/${execution.threadId}/runs?limit=100`).then(r => r.json())
    check('Refresh/recovery did not dispatch another execution run', native.filter(r => r.metadata?.ui_request_id === execAck.requestId).length === 1)
    const replay = await fetch(`${state.api}/api${base}/threads/${execution.threadId}/runs/${execAck.runId}/events?cursor=-1`, { signal: AbortSignal.timeout(30000) })
    assert.equal(replay.status, 200)
    const frames = new SseDecoder().push(await replay.text())
    const events = frames.filter(frame => frame.event === 'run-event').map(frame => JSON.parse(frame.data))
    check('Actual native SSE replay preserves validated run/thread/engagement scope', events.length > 0 && events.every(e => isPublicStreamEvent(e) && e.engagementId === project.id && e.threadId === execution.threadId && e.streamRunId === execAck.runId))
    check('Actual native SSE replay ends with a recovery control frame', frames.some(frame => frame.event === 'control' && JSON.parse(frame.data).recoveryRequired === true))
    await page.goto(`http://127.0.0.1:5297/?dataMode=real#/project/${project.id}`)
    await page.getByRole('tab', { name: 'Findings', exact: true }).click()
    await page.getByText(produced.title, { exact: true }).waitFor()
    await page.getByRole('button', { name: new RegExp('findings/FIND-WEB-ACCEPTANCE.md') }).click()
    await page.getByTestId('artifact-viewer').getByText(new RegExp(`WEB_ACCEPTANCE_${state.id}`)).waitFor()
    await page.screenshot({ path: resolve(state.output, 'produced-findings.png'), fullPage: true })
    check('New browser UI renders produced output without mock interception', errors.length === 0)
    writeFileSync(resolve(state.output, 'observed-output.json'), JSON.stringify({
      engagement: await api(base), planning: await api(`${base}/plan-docs`),
      planningThread: await api(`${base}/threads/${state.planningThread}`),
      planningRun: await api(`${base}/threads/${state.planningThread}/runs/${state.planningRun}`),
      planningResume: await api(`${base}/threads/${state.planningThread}/runs/${state.planningResume}`),
      executionThread: await api(`${base}/threads/${state.executionThread}`),
      executionRun: await api(`${base}/threads/${state.executionThread}/runs/${state.executionRun}`),
      findings, content, timeline,
      nativeRunIdentities: native.map(r => ({ runId: r.run_id, requestId: r.metadata?.ui_request_id, status: r.status })),
      replayEvents: events.map(e => ({ eventId: e.eventId, cursor: e.upstreamCursor, source: e.source, runId: e.runId, type: e.payload.type, tool: e.payload.name })),
    }, null, 2))
    state.passed = true; delete state.failure; save()
  } catch (error) {
    state.passed = false; state.failure = redact(error.message); state.browserErrors = errors
    if (page) {
      writeFileSync(resolve(state.output, 'failure-body.txt'), redact(await page.locator('body').innerText().catch(() => 'Body unavailable')))
      writeFileSync(resolve(state.output, 'failure-page.html'), redact(await page.content().catch(() => 'Page unavailable')))
      await page.screenshot({ path: resolve(state.output, 'failure.png'), fullPage: true }).catch(() => {})
    }
    writeFileSync(resolve(state.output, 'vite.log'), redact(viteLog)); save(); throw error
  } finally {
    if (browser) await Promise.race([browser.close(), sleep(5000)])
    vite.kill()
    await Promise.race([new Promise(r => vite.once('exit', r)), sleep(5000)])
    state.viteStopped = vite.exitCode !== null || vite.signalCode !== null; save()
  }
}

function stop() {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
  const selected = process.argv[4]
  if (selected) assert.ok(state.containers.includes(selected), 'Cleanup target belongs to this verification session')
  for (const name of [...state.containers].reverse().filter(name => !selected || name === selected)) {
    const container = inspect(name)
    assert.equal(container.Config.Labels['raptix.verification'], state.id)
    try { docker(['rm', '-f', name], 5000); console.log(`Stopped owned container ${name}`) }
    catch { console.error(`Cleanup exceeded 5s/failed: ${name}; retained for inspection`) }
  }
  // Keep the dedicated database and workspace volume as durable evidence.
}

try {
  if (process.argv[2] === '--start') await start()
  else if (process.argv[2] === '--flow') await flow()
  else if (process.argv[2] === '--stop') stop()
  else throw Error('Use --start, --flow <state.json>, or --stop <state.json>')
} catch (error) { console.error(redact(error.message)); process.exitCode = 1 }
