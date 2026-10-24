// Resumable M1 acceptance against the deployed browser/API/runtime, without transport/model mocks.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.M1_BASE_URL ?? 'http://127.0.0.1:3001'
const output = resolve('tests/local/artifacts/operational-m1/acceptance')
mkdirSync(output, { recursive: true })
const statePath = resolve(output, 'state.json')
const credentialsPath = resolve(output, 'credentials.json')
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { id: randomUUID().slice(0, 8), slug: process.env.WEB_RUNTIME_SLUG ?? 'web-m1-20261016', checks: [] }
const credentials = existsSync(credentialsPath) ? JSON.parse(readFileSync(credentialsPath, 'utf8')) : { owner: { username: `m1-owner-${state.id}`, password: randomBytes(24).toString('hex') }, reviewer: { username: `m1-reviewer-${state.id}`, password: randomBytes(24).toString('hex') } }
writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 })
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2))
const check = (name, passed) => { state.checks.push({ name, passed, at: new Date().toISOString() }); save(); assert.ok(passed, name); console.log(`PASS ${name}`) }
const redact = message => Object.values(credentials).reduce((text, actor) => text.replaceAll(actor.password, '<redacted>'), String(message))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function poll(read, seconds = 360) {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) { const value = await read(); if (value) return value; await wait(2000) }
  throw Error('M1 acceptance deadline exceeded; reconcile saved IDs before retrying')
}

async function signIn(browser, actor) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${base}/#/projects`)
  await page.getByLabel('Username', { exact: true }).fill(actor.username)
  await page.getByLabel('Password', { exact: true }).fill(actor.password)
  const pending = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  assert.equal((await pending).status(), 200, 'Browser login succeeds through nginx')
  const session = await context.request.get(`${base}/api/auth/session`).then(response => response.json())
  return { context, page, csrf: session.csrfToken, id: session.actor.id }
}
async function api(actor, path, method = 'GET', body, expected = 200) {
  const response = await actor.context.request.fetch(`${base}/api${path}`, { method, headers: { origin: base, 'x-csrf-token': actor.csrf }, ...(body === undefined ? {} : { data: body }) })
  const payload = await response.json()
  assert.equal(response.status(), expected, redact(`${method} ${path}: ${JSON.stringify(payload)}`))
  return payload
}

const browser = await chromium.launch({ headless: true })
let owner, reviewer
try {
  if (process.argv[2] === '--prepare' && !state.ownerBootstrapped) {
    const source = `import {readFileSync} from 'node:fs';import{createDbClient}from './dist/db/client.js';import{ensureBootstrapAdmin}from './dist/http/routes/auth.routes.js';const a=JSON.parse(readFileSync(0,'utf8'));const db=createDbClient({connectionString:process.env.DATABASE_URL});try{await ensureBootstrapAdmin(db,a.username,a.password,'M1 Acceptance Owner')}finally{await db.$disconnect()}`
    execFileSync('docker', ['exec', '-i', 'raptix-web-raptix-api', 'node', '--input-type=module', '-e', source], { input: JSON.stringify(credentials.owner), timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] })
    state.ownerBootstrapped = true; save()
  }
  owner = await signIn(browser, credentials.owner)
  if (process.argv[2] === '--prepare') {
    if (!state.engagementId) {
      await owner.page.goto(`${base}/#/project-new`)
      await owner.page.getByPlaceholder('e.g. Q1 External Assessment').fill('M1 Operational Acceptance')
      await owner.page.getByPlaceholder('q1-external-assessment').fill(state.slug)
      await owner.page.getByPlaceholder('https://target.example.test or 10.20.0.0/24').fill('https://authorized.invalid')
      await owner.page.getByPlaceholder('Business context, known constraints, expected outcome…').fill('Authorized local workspace-only M1 pipeline check. No remote target access. Produce an informational marker, not a vulnerability.')
      await owner.page.getByRole('checkbox').check()
      const created = owner.page.waitForResponse(response => response.url().endsWith('/api/engagements') && response.request().method() === 'POST')
      await owner.page.getByRole('button', { name: 'Create Engagement', exact: true }).click()
      const response = await created
      assert.equal(response.status(), 201)
      const project = await response.json()
      assert.equal(project.workspaceSlug, state.slug)
      state.engagementId = project.id; save()
      check('Real browser creates a new engagement with the pinned Web workspace identity', true)
    }
    if (!state.reviewerId) {
      const invited = await api(owner, `/engagements/${state.engagementId}/members`, 'POST', { ...credentials.reviewer, displayName: 'M1 Independent Reviewer', role: 'reviewer' })
      state.reviewerId = invited.memberId; save()
    }
    reviewer = await signIn(browser, credentials.reviewer)
    check('Two distinct browser sessions authenticate as owner and independent reviewer', reviewer.id !== owner.id)
    check('Reviewer reads only the authorized project', (await api(reviewer, '/engagements')).some(project => project.id === state.engagementId))
    await owner.page.screenshot({ path: resolve(output, 'created-project.png'), fullPage: true })
  } else if (process.argv[2] === '--planning') {
    const path = `/engagements/${state.engagementId}`
    await owner.page.goto(`${base}/#/ai-operator/${state.engagementId}`)
    if (!state.planningThread) {
      const pending = owner.page.waitForResponse(response => response.url().endsWith('/threads') && response.request().method() === 'POST')
      await owner.page.getByRole('button', { name: 'New planning thread', exact: true }).click()
      const ack = await (await pending).json()
      assert.equal(ack.state, 'accepted'); state.planningThread = ack.threadId; save()
    }
    if (!state.planningRun) {
      const schemas = JSON.parse(readFileSync('apps/web/server/src/services/planning-schemas.json', 'utf8'))
      const compact = JSON.stringify(Object.fromEntries(Object.entries(schemas).filter(([name]) => name !== 'opplan')), (key, value) => ['title', 'description', 'default', 'examples'].includes(key) ? undefined : value)
      const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const end = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      const instruction = `Authorized LOCAL-ONLY M1 pipeline acceptance, not a target assessment. Engagement ${state.slug}, client Local acceptance operator, authorization M1-${state.id}. Dummy metadata target https://authorized.invalid: DO NOT contact it or any target. Only local workspace filesystem writes/reads are allowed. Dates ${start} to ${end} UTC, any time within those dates. No network probing, exploitation, credential access, deletion, or persistence. Contact local@example.invalid. First call ask_user_question exactly once to confirm this local-only scope, allow Other, then WAIT. After the operator answer, use your real filesystem tools to create eight valid JSON documents /workspace/plan/{roe,conops,deconfliction,threat-profile,contact,data-handling,abort,cleanup}.json. Every engagement_name equals ${state.slug}. RoE must include authorization_reference M1-${state.id}, in_scope https://authorized.invalid. Success criterion is an informational local evidence marker. Validate using these exact schemas: ${compact}`
      assert.ok(Buffer.byteLength(instruction) <= 16000)
      await owner.page.getByLabel('Workspace message').fill(instruction)
      const pending = owner.page.waitForResponse(response => response.url().endsWith(`/threads/${state.planningThread}/runs`) && response.request().method() === 'POST')
      await owner.page.getByRole('button', { name: 'Send', exact: true }).click()
      const ack = await (await pending).json()
      assert.equal(ack.state, 'accepted'); state.planningRun = ack.runId; save()
    }
    if (!state.planningResume) {
      const question = await poll(async () => {
        const snapshot = await api(owner, `${path}/threads/${state.planningThread}`)
        const run = await api(owner, `${path}/threads/${state.planningThread}/runs/${state.planningRun}`)
        if (['error', 'timeout'].includes(run.rawStatus)) throw Error(`Planning ended ${run.rawStatus}`)
        return snapshot.pendingQuestions?.[0] ?? snapshot.pendingQuestion
      })
      state.questionId = question.questionId; save()
      await owner.page.reload()
      await owner.page.getByText(question.question, { exact: true }).waitFor()
      check('Real model question survives browser refresh with the same interrupt identity', !!question.interruptId)
      await owner.page.getByLabel('Other answer').fill('Confirmed. Only local workspace file writes/reads, no target/network contact. Generate and validate all eight documents now using the supplied schemas; retain evidence.')
      const pending = owner.page.waitForResponse(response => response.url().endsWith('/resume') && response.request().method() === 'POST')
      await owner.page.getByRole('button', { name: 'Answer', exact: true }).click()
      const ack = await (await pending).json()
      assert.equal(ack.state, 'accepted'); state.planningResume = ack.runId; save()
    }
    await poll(async () => {
      const run = await api(owner, `${path}/threads/${state.planningThread}/runs/${state.planningResume}`)
      if (['error', 'timeout'].includes(run.rawStatus)) throw Error(`Planning resume ended ${run.rawStatus}`)
      return (await api(owner, `${path}/plan-docs`)).readiness.state === 'ready'
    }, 600)
    check('Real Soundwave filesystem output validates as a ready planning bundle through the API', true)
    await owner.page.screenshot({ path: resolve(output, 'planning-ready.png'), fullPage: true })
  } else if (process.argv[2] === '--request-hitl') {
    const path = `/engagements/${state.engagementId}`
    const prior = await api(owner, `${path}/threads/${state.executionThread}/runs/${state.executionRun}`)
    assert.equal(prior.rawStatus, 'success', 'Only request a new, explicit intent after the prior run settled')
    if (state.hitlRun) {
      assert.ok(process.argv.includes('--retry-settled'), 'Reconcile the saved HITL intent instead of dispatching a duplicate')
      const previous = await api(owner, `${path}/threads/${state.executionThread}/runs/${state.hitlRun}`)
      assert.ok(['success', 'error', 'timeout', 'interrupted'].includes(previous.rawStatus), 'The previous intent must have an authoritative terminal result')
      state.hitlAttempts ??= []
      state.hitlAttempts.push({ runId: state.hitlRun, requestId: state.hitlDispatch, marker: state.hitlMarker, status: previous.rawStatus }); save()
    }
    state.hitlMarker = `M1_HITL_${state.id}_${randomUUID().slice(0, 8)}`; save()
    await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=ai-workspace`)
    await owner.page.getByLabel('Workspace message').fill(`This is a NEW explicit operator intent with a NEW output marker: ${state.hitlMarker}. Use a NEW dispatch_id for this new intent; do not reuse a completed dispatch. Submit the ACTUAL bash tool invocation printf ${state.hitlMarker} now. Do not say approval is pending in prose: only runtime HITL creates the request and pauses BEFORE execution. You are authorized to submit this benign local-only call FOR approval; never bypass the middleware or approve it yourself. If bash is not exposed to you, use task to delegate ONLY this exact local printf invocation to recon, with no target/network access or other work. Then report the actual result. The marker file is already verified; do not rewrite it.`)
    const pending = owner.page.waitForResponse(response => response.url().endsWith(`/threads/${state.executionThread}/runs`) && response.request().method() === 'POST')
    state.hitlRequestedAt = Date.now() / 1000; save()
    await owner.page.getByRole('button', { name: 'Send', exact: true }).click()
    const response = await pending; const ack = await response.json()
    assert.equal(response.status(), 202, JSON.stringify(ack))
    state.hitlRun = ack.runId; state.hitlDispatch = ack.requestId; save()
  } else if (process.argv[2] === '--execution') {
    const path = `/engagements/${state.engagementId}`
    reviewer = await signIn(browser, credentials.reviewer)
    if (!(await api(owner, `${path}/members`)).members.some(member => member.id === state.reviewerId)) {
      await api(owner, `${path}/members`, 'POST', { ...credentials.reviewer, displayName: 'M1 Independent Reviewer', role: 'reviewer' })
    }
    await poll(async () => {
      const run = await api(owner, `${path}/threads/${state.planningThread}/runs/${state.planningResume}`)
      if (['error', 'timeout'].includes(run.rawStatus)) throw Error(`Planning finalization ended ${run.rawStatus}`)
      return ['success', 'interrupted'].includes(run.rawStatus)
    })
    if (!(await api(owner, path)).handoffConfirmedAt) {
      await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=planning`)
      const pending = owner.page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'PATCH')
      await owner.page.getByRole('button', { name: 'Confirm planning handoff', exact: true }).click()
      assert.equal((await pending).status(), 200)
    }
    check('Browser confirms planning handoff only after real readiness', !!(await api(owner, path)).handoffConfirmedAt)
    if (!state.scopeId) {
      const scope = await api(owner, `${path}/scope/revisions`, 'POST', { diff: { added: ['https://authorized.invalid'], removed: [], rationale: 'Local workspace-only M1 evidence marker' }, roe: { windows: [], emergencyContacts: ['local@example.invalid'], restrictions: ['No network or target access; local workspace file operations and a benign printf approval check only.'] } })
      state.scopeId = scope.id; save()
      await api(owner, `${path}/scope/revisions/${scope.id}/decision`, 'POST', { decision: 'approved' }, 403)
      await api(reviewer, `${path}/scope/revisions/${scope.id}/decision`, 'POST', { decision: 'approved' })
      check('Independent scope approval succeeds and self-approval is refused', true)
    }
    if (!state.executionThread) {
      const existing = (await api(owner, `${path}/threads`)).threads.find(thread => thread.kind === 'execution')
      state.executionThread = existing?.threadId ?? (await api(owner, `${path}/threads`, 'POST', { kind: 'execution', requestId: randomUUID() }, 201)).threadId; save()
    }
    if (!state.planId) {
      await api(owner, `${path}/threads/${state.executionThread}/runs`, 'POST', { requestId: randomUUID(), message: 'This must be refused: the execution thread has no approved plan binding.' }, 409)
      const plan = await api(owner, `${path}/plans`, 'POST', { objective: 'Local-only informational evidence marker, filesystem readback and benign HITL printf', methods: ['filesystem', 'local printf'] })
      await api(owner, `${path}/plans/${plan.id}/propose`, 'POST')
      await api(owner, `${path}/plans/${plan.id}/decision`, 'POST', { decision: 'approved' }, 403)
      await api(reviewer, `${path}/plans/${plan.id}/decision`, 'POST', { decision: 'approved' })
      await api(owner, `${path}/bindings`, 'POST', { planId: plan.id, threadId: state.executionThread })
      state.planId = plan.id; save()
      check('Unbound execution is refused; an independently approved plan binds the owned thread', true)
    }
    await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=ai-workspace`)
    if (!state.executionRun) {
      const instruction = `Execute only the approved LOCAL workspace acceptance objective. Do not contact targets or delegate network work. First use write_file to produce /workspace/findings/FIND-M1-ACCEPTANCE.md with title Local M1 pipeline marker, Severity: informational, a Description saying this is a pipeline check NOT a vulnerability, and Evidence containing M1_ACCEPTANCE_${state.id}. Read it back using read_file. Then exactly once invoke bash with this exact harmless local command: printf M1_HITL_${state.id}. It only prints a marker, no filesystem or network effects. Wait for real operator HITL approval; never bypass or auto-approve. Finish after the operator decision and summarize the actual output.`
      await owner.page.getByLabel('Workspace message').fill(instruction)
      const pending = owner.page.waitForResponse(response => response.url().endsWith(`/threads/${state.executionThread}/runs`) && response.request().method() === 'POST')
      await owner.page.getByRole('button', { name: 'Send', exact: true }).click()
      const response = await pending
      const ack = await response.json()
      state.lastDispatch = { status: response.status(), state: ack.state, error: ack.error }; save()
      assert.equal(response.status(), 202, redact(JSON.stringify(ack)))
      assert.equal(ack.state, 'accepted'); state.executionRun = ack.runId; state.executionRequest = ack.requestId; save()
    }
    if (!state.hitlAllowed) {
      const approval = await poll(async () => {
        const request = (await api(owner, `${path}/approvals`)).approvals.find(approval => approval.createdAtSeconds >= (state.hitlRequestedAt ?? 0))
        if (request) return request
        const run = await api(owner, `${path}/threads/${state.executionThread}/runs/${state.hitlRun ?? state.executionRun}`)
        if (['error', 'timeout', 'success'].includes(run.rawStatus)) throw Error(`Execution ended ${run.rawStatus} without the expected actual HITL request`)
      }, 480)
      assert.equal(approval.toolName, 'bash')
      assert.equal(approval.toolArgsRedacted.command, `printf ${state.hitlMarker ?? `M1_HITL_${state.id}`}`, 'Only the exact benign acceptance command may be approved')
      state.hitlRequest = approval.requestId; save()
      if (!state.liveRevocation) {
        const cookies = (await reviewer.context.cookies(base)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
        const response = await fetch(`${base}/api${path}/threads/${state.executionThread}/runs/${state.hitlRun ?? state.executionRun}/events`, { headers: { cookie: cookies }, signal: AbortSignal.timeout(45000) })
        assert.equal(response.status, 200)
        const reader = response.body.getReader()
        let observed = ''
        try {
          const first = await reader.read(); observed += new TextDecoder().decode(first.value)
          await api(owner, `${path}/members/${state.reviewerId}`, 'DELETE')
          state.membershipRevokedAt = new Date().toISOString(); save()
          while (!observed.includes('stream_closed')) {
            const next = await reader.read(); if (next.done) break
            observed += new TextDecoder().decode(next.value)
          }
          check('Membership revocation closes an actual scoped runtime SSE observation', observed.includes('stream_closed'))
          await api(reviewer, `${path}/threads/${state.executionThread}/runs/${state.hitlRun ?? state.executionRun}`, 'GET', undefined, 404)
        } finally {
          state.revocationObservation = { control: observed.includes('stream_closed'), characters: observed.length }; save()
          void reader.cancel()
          if (!(await api(owner, `${path}/members`)).members.some(member => member.id === state.reviewerId)) await api(owner, `${path}/members`, 'POST', { ...credentials.reviewer, displayName: 'M1 Independent Reviewer', role: 'reviewer' })
        }
        state.liveRevocation = true; save()
      }
      await owner.page.locator('li').filter({ hasText: approval.requestId }).getByRole('button', { name: 'Allow', exact: true }).click()
      state.hitlAllowed = true; save()
      check('Browser allows the real runtime-produced benign tool approval', true)
    }
    await poll(async () => {
      const run = await api(owner, `${path}/threads/${state.executionThread}/runs/${state.hitlRun ?? state.executionRun}`)
      if (['error', 'timeout'].includes(run.rawStatus)) throw Error(`Execution ended ${run.rawStatus}`)
      return run.rawStatus === 'success'
    }, 480)
    const artifact = await api(owner, `${path}/artifacts/content?path=${encodeURIComponent('findings/FIND-M1-ACCEPTANCE.md')}`)
    check('Actual execution writes and reads back informational evidence bytes', artifact.content.includes(`M1_ACCEPTANCE_${state.id}`))
    await owner.page.reload()
    const runs = await api(owner, `${path}/threads/${state.executionThread}/runs`)
    check('Browser refresh retains exactly one run for the dispatch identity', runs.runs.filter(run => run.requestId === state.executionRequest).length === 1)
    await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=operations`)
    await owner.page.getByRole('button', { name: /^tool_call · checkpoint/ }).first().click()
    const dialog = owner.page.getByRole('dialog', { name: /Tool Event Inspector/ })
    await dialog.waitFor()
    const box = await dialog.boundingBox()
    check('Real tool activity opens a centered modal with checkpoint attribution', Math.abs(box.x + box.width / 2 - 800) < 20 && await dialog.getByText('Unknown — thread history').isVisible())
    await owner.page.screenshot({ path: resolve(output, 'execution-modal.png'), fullPage: true })
    await owner.page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  } else if (process.argv[2] === '--vault') {
    const path = `/engagements/${state.engagementId}`
    const label = `M1 vault token ${state.id}`
    const plaintext = `m1-vault-${randomUUID()}`
    await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=vault`)
    if (!state.vaultStored) {
      await owner.page.getByLabel('Kind', { exact: true }).fill('api-key')
      await owner.page.getByLabel('Label', { exact: true }).fill(label)
      await owner.page.getByLabel('Secret value', { exact: true }).fill(plaintext)
      const created = owner.page.waitForResponse(response => response.url().endsWith(`${path}/vault/secrets`) && response.request().method() === 'POST')
      await owner.page.getByRole('button', { name: /Store encrypted/ }).click()
      assert.equal((await created).status(), 201)
      state.vaultStored = true; save()
    }
    await owner.page.getByText(label, { exact: true }).waitFor()
    const listBody = () => owner.page.locator('body').innerText()
    assert.ok(!(await listBody()).includes(plaintext), 'Secret list never renders plaintext before reveal')
    await owner.page.getByRole('button', { name: `Reveal ${label}` }).click()
    await owner.page.getByText(plaintext, { exact: true }).waitFor()
    await owner.page.getByRole('button', { name: `Hide ${label}` }).click()
    await owner.page.getByText(plaintext, { exact: true }).waitFor({ state: 'detached' })
    check('Real vault stores metadata-only, reveals, and hides plaintext in-session', !(await listBody()).includes(plaintext))
    await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=audit`)
    await poll(async () => (await owner.page.locator('body').innerText()).includes('vault.secret_created'))
    check('Vault lifecycle is recorded in the real audit surface', (await listBody()).includes('vault.secret_revealed'))
    await owner.page.goto(`${base}/#/project/${state.engagementId}?tab=vault`)
    const revoked = owner.page.waitForResponse(response => response.url().includes(`${path}/vault/secrets/`) && response.request().method() === 'DELETE')
    await owner.page.getByRole('button', { name: `Revoke ${label}` }).click()
    assert.equal((await revoked).status(), 200)
    await owner.page.getByText(label, { exact: true }).waitFor({ state: 'detached' })
    check('Real vault revokes and deletes the stored secret', !(await listBody()).includes(label))
    await owner.page.screenshot({ path: resolve(output, 'vault.png'), fullPage: true })
  } else if (process.argv[2] === '--inspect') {
    const path = `/engagements/${state.engagementId}`
    const snapshot = await api(owner, `${path}/threads/${state.executionThread}`)
    console.log(JSON.stringify({ status: snapshot.rawStatus, assistantMessages: snapshot.messages.filter(message => message.role === 'assistant').map(message => message.content.slice(-1600)), events: snapshot.transcripts?.map(entry => ({ type: entry.payload.type, tool: entry.payload.name ?? entry.payload.tool, status: entry.payload.status })), pendingQuestions: snapshot.pendingQuestions?.map(question => question.question), approvals: (await api(owner, `${path}/approvals`)).approvals.length }, null, 2))
  } else throw Error('Pass --prepare, --planning, --execution, --vault or --inspect')
  delete state.failure; save()
} catch (error) {
  state.failure = redact(error.message); save()
  if (owner) await owner.page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(state.failure); process.exitCode = 1
} finally {
  await browser.close()
  console.log(`M1 evidence: ${statePath}`)
}
