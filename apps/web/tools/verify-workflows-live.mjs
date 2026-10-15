// Real PostgreSQL/API acceptance for tickets 07-17; no database or HTTP mocks.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const prior = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const id = randomUUID().slice(0, 8)
const output = resolve('tests/local/artifacts/workflow-live', id)
mkdirSync(output, { recursive: true })
const state = { id, output, checks: [], database: `raptix_web_workflow_${id}`, container: `raptix-web-workflow-${id}`, slug: prior.slug }
const save = () => writeFileSync(resolve(output, 'state.json'), JSON.stringify(state, null, 2))
const secrets = []
const redact = (text) => secrets.reduce((s, secret) => s.replaceAll(secret, '<REDACTED>'), String(text))
const docker = (args, timeout = 120000) => {
  try { return execFileSync('docker', args, { encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
  catch (e) { throw Error(redact(e.stderr ?? e.message)) }
}
const envOf = (name) => Object.fromEntries(JSON.parse(docker(['inspect', name]))[0].Config.Env.map((entry) => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)] }))
const check = (name, condition) => { assert.ok(condition, name); state.checks.push(name); save(); console.log(`PASS ${name}`) }
const password = randomBytes(24).toString('hex')
const reviewerPassword = randomBytes(24).toString('hex')
secrets.push(password, reviewerPassword)
let apiBase
async function api(endpoint, actor, method = 'GET', body, expected = 200) {
  const response = await fetch(`${apiBase}/api${endpoint}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(actor ? { cookie: actor.cookie, 'x-csrf-token': actor.csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
  const payload = await response.json()
  assert.equal(response.status, expected, `${method} ${endpoint}: ${redact(JSON.stringify(payload))}`)
  return { response, payload }
}
async function login(username, password) {
  const { response, payload } = await api('/auth/login', null, 'POST', { username, password })
  secrets.push(payload.csrfToken)
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: payload.csrfToken, id: payload.actor.id }
}
async function healthy() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { if ((await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return } catch { /* bounded startup probe */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw Error('API health deadline exceeded')
}
try {
  save()
  const postgres = envOf('raptix-postgres')
  secrets.push(postgres.POSTGRES_PASSWORD)
  const runtime = envOf('raptix-langgraph')
  if (runtime.RAPTIX_NEO4J_PASSWORD) secrets.push(runtime.RAPTIX_NEO4J_PASSWORD)
  docker(['exec', 'raptix-postgres', 'psql', '-U', 'raptix', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${state.database}`])
  const runtimeName = prior.containers.find((name) => name.endsWith('-runtime'))
  const sandboxName = prior.containers.find((name) => name.endsWith('-sandbox'))
  const args = ['run', '-d', '--name', state.container, '--label', `raptix.verification=${id}`, '--network', 'raptix_raptix-net', '-p', '127.0.0.1::8081', '-v', `${prior.volume}:/workspaces/${prior.slug}`]
  const env = {
    DATABASE_URL: `postgresql://raptix:${encodeURIComponent(postgres.POSTGRES_PASSWORD)}@postgres:5432/${state.database}`,
    HOST: '0.0.0.0', PORT: '8081', WORKSPACE_PATH: '/workspaces', RAPTIX_WEB_AUTH_MODE: 'multi',
    RAPTIX_WEB_ADMIN_USERNAME: `owner-${id}`, RAPTIX_WEB_ADMIN_PASSWORD: password,
    VAULT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    LANGGRAPH_API_URL: `http://${runtimeName}:2024`, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace',
    RAPTIX_RUNTIME_WORKSPACE_SLUG: prior.slug, RAPTIX_RUNTIME_SANDBOX_URL: `http://${sandboxName}:9999`,
    ...(runtime.RAPTIX_NEO4J_PASSWORD ? { NEO4J_HTTP_URI: 'http://neo4j:7474', NEO4J_PASSWORD: runtime.RAPTIX_NEO4J_PASSWORD } : {}),
  }
  secrets.push(env.VAULT_ENCRYPTION_KEY)
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`)
  args.push('raptix-web-verification-api:20261015')
  docker(args)
  apiBase = `http://127.0.0.1:${docker(['port', state.container, '8081/tcp']).match(/:(\d+)$/)[1]}`
  state.api = apiBase; save()
  await healthy()
  await api('/capabilities', null)
  await api('/engagements', null, 'GET', undefined, 401)
  const owner = await login(`owner-${id}`, password)
  const { payload: project } = await api('/engagements', owner, 'POST', { name: state.slug, displayName: 'Workflow acceptance', targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, brief: 'Authorized local workspace-only acceptance; no remote target access.' }, 201)
  state.engagementId = project.id; save()
  const base = `/engagements/${project.id}`
  await api(`${base}/members`, owner, 'POST', { username: `reviewer-${id}`, password: reviewerPassword, displayName: 'Independent reviewer', role: 'reviewer' })
  const reviewer = await login(`reviewer-${id}`, reviewerPassword)
  const projects = (await api('/engagements', reviewer)).payload
  check('Invited reviewer sees the engagement in the real portfolio', projects.some((p) => p.id === project.id))
  await api(base, reviewer)
  await api(`${base}/plans`, reviewer, 'POST', { objective: 'role forgery', role: 'owner' }, 403)
  await api(`${base}/plans`, { ...owner, csrf: 'forged' }, 'POST', { objective: 'invalid csrf' }, 403)
  check('Server refuses forged roles and CSRF directly over HTTP', true)
  const roe = { windows: [], emergencyContacts: ['local@example.invalid'], restrictions: ['No remote target access'] }
  const revision = (await api(`${base}/scope/revisions`, owner, 'POST', { diff: { added: ['https://authorized.invalid'], removed: [], rationale: 'Local workspace-only acceptance' }, roe })).payload
  await api(`${base}/scope/revisions/${revision.id}/decision`, owner, 'POST', { decision: 'approved' }, 403)
  await api(`${base}/scope/revisions/${revision.id}/decision`, reviewer, 'POST', { decision: 'approved' })
  await api(`${base}/assets/inventory/import`, owner, 'POST', { identifiers: ['https://authorized.invalid', 'https://outside.invalid'], kind: 'web_url' })
  const assets = (await api(`${base}/assets/inventory`, owner)).payload.assets
  await api(`${base}/assets/inventory/${assets.find((a) => a.identifier.includes('outside')).id}`, owner, 'PATCH', { classification: 'in_scope' }, 409)
  await api(`${base}/assets/inventory/${assets.find((a) => a.identifier.includes('authorized')).id}`, owner, 'PATCH', { classification: 'in_scope' })
  check('Real scope approval refuses uncovered assets and allows covered assets', true)
  await api(base, owner, 'PATCH', { handoffConfirmed: true })
  const threadAck = (await api(`${base}/threads`, owner, 'POST', { kind: 'execution', requestId: randomUUID() }, 201)).payload
  state.threadId = threadAck.threadId; save()
  await api(`${base}/threads/${state.threadId}/runs`, owner, 'POST', { requestId: randomUUID(), message: 'Do not execute: this must be refused without a bound approval.' }, 409)
  const plan = (await api(`${base}/plans`, owner, 'POST', { objective: 'Local workspace marker only', methods: ['filesystem'] })).payload
  await api(`${base}/plans/${plan.id}/propose`, owner, 'POST')
  await api(`${base}/plans/${plan.id}/decision`, owner, 'POST', { decision: 'approved' }, 403)
  await api(`${base}/plans/${plan.id}/decision`, reviewer, 'POST', { decision: 'approved' })
  await api(`${base}/bindings`, owner, 'POST', { planId: plan.id, threadId: state.threadId })
  state.planId = plan.id; save()
  check('Execution refuses an unbound thread; an independent approval can be bound', true)
  const finding = (await api(`${base}/curated-findings`, owner, 'POST', { title: 'Local pipeline claim', severity: 'informational', detail: 'Not a vulnerability' })).payload
  await api(`${base}/curated-findings/${finding.id}/transition`, owner, 'POST', { to: 'review' })
  await api(`${base}/curated-findings/${finding.id}/transition`, reviewer, 'POST', { to: 'confirmed' })
  check('Independent reviewer confirms a real curated finding', true)
  const report = (await api(`${base}/report-records`, owner, 'POST', { title: 'Acceptance report', summary: 'Actual reviewed report body' })).payload
  const edits = await Promise.all(['A', 'B'].map((summary) => fetch(`${apiBase}/api${base}/report-records/${report.id}`, { method: 'PATCH', headers: { cookie: owner.cookie, 'x-csrf-token': owner.csrf, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, summary }), signal: AbortSignal.timeout(30000) })))
  check('Concurrent report edits cannot both overwrite version 1', edits.map((r) => r.status).sort().join(',') === '200,409')
  const current = (await api(`${base}/report-records`, owner)).payload.reports.find((r) => r.id === report.id)
  await api(`${base}/report-records/${report.id}/review`, owner, 'POST', { action: 'submit' })
  await api(`${base}/report-records/${report.id}/review`, reviewer, 'POST', { decision: 'approved', comment: 'Checked the exact report version', expectedVersion: current.version })
  const artifact = (await api(`${base}/report-records/${report.id}/export?format=markdown`, owner)).payload
  check('Report export includes the exact reviewed version and content digest', artifact.version === current.version && artifact.content.includes(`Report ${report.id}`) && /^[a-f0-9]{64}$/.test(artifact.digest))
  await api(`${base}/report-records/${report.id}/deliveries`, owner, 'POST', { kind: 'delivery', format: 'markdown', requestId: randomUUID() }, 400)
  const delivery = { kind: 'delivery', format: 'markdown', requestId: randomUUID(), expectedVersion: current.version, recipient: 'Local verifier', receipt: `MANUAL-RECEIPT-${id}` }
  await api(`${base}/report-records/${report.id}/deliveries`, owner, 'POST', delivery)
  await api(`${base}/report-records/${report.id}/deliveries`, owner, 'POST', delivery)
  const delivered = (await api(`${base}/report-records`, reviewer)).payload.reports.find((r) => r.id === report.id)
  check('Manual delivery requires receipt and retries do not duplicate delivery', delivered.status === 'delivered' && delivered.deliveries.length === 1)
  state.reportId = report.id; save()
  const settings = (await api('/workspace/settings', owner)).payload.settings
  const setting = settings.find((s) => s.key === 'policy.c2_grant_max_hours')
  await api(`/workspace/settings/${setting.key}`, owner, 'PUT', { expectedVersion: setting.version, value: 1, reason: 'Local acceptance policy' })
  await api(`/workspace/settings/${setting.key}`, owner, 'PUT', { expectedVersion: setting.version, value: 2, reason: 'Stale edit' }, 409)
  await api(`${base}/c2/grants`, owner, 'POST', { sessionId: 'not-a-provider-session', expiresAt: new Date(Date.now() + 7200000).toISOString(), reason: 'must be refused by policy' }, 400)
  check('Persisted C2 TTL policy propagates and stale policy writes are refused', true)
  const notices = (await api('/notices', owner)).payload
  check('Workflow decisions produce actual persisted actor notices', notices.notices.length > 0)
  const closure = (await api(`${base}/closure/request`, owner, 'POST', { reason: 'All local acceptance work completed' })).payload
  await api(`${base}/closure/decision`, owner, 'POST', { decision: 'confirmed' }, 403)
  await api(`${base}/closure/decision`, reviewer, 'POST', { decision: 'confirmed' })
  await api(`${base}/curated-findings`, owner, 'POST', { title: 'must not persist', severity: 'low' }, 409)
  check('Independent closure succeeds and refuses subsequent mutations', closure.status === 'requested' && (await api(`${base}/closure`, owner)).payload.readOnly)
  docker(['restart', '-t', '1', state.container], 5000)
  // Docker Desktop re-allocates the ephemeral host port on restart; re-resolve it.
  apiBase = `http://127.0.0.1:${docker(['port', state.container, '8081/tcp']).match(/:(\d+)$/)[1]}`
  state.api = apiBase; save()
  await healthy()
  check('Records and sessions survive an actual API container restart', (await api(`${base}/report-records`, reviewer)).payload.reports.some((r) => r.id === report.id && r.status === 'delivered'))
  state.passed = true
  // Browser verification can reuse the trusted deployment, without writing credentials.
  console.log(`Workflow evidence: ${resolve(output, 'state.json')}`)
} catch (e) { state.passed = false; state.failure = redact(e.message); console.error(state.failure); process.exitCode = 1 }
finally { save() }
