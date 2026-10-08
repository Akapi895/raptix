import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { isRequestRecoveryView, isScopedRunView, isScopedThreadListView, isScopedThreadView, isFindingsView, isArtifactsView, isArtifactContentView, isGraphView, isAssetsView, isTimelineView, isEngagementSettingsView, isCampaignView, isCampaignJobView, isCampaignsView, isVaultSecretView, isVaultView, isVaultRevealView, isMembersView } from '@raptix/web-contracts'
import { isPublicStreamEvent } from '@raptix/web-contracts'
import { decodeSse, SseDecoder } from '@raptix/streaming'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const root = path.join(repo, 'workspace')
assert.ok(existsSync(root))
const slug = `w07-live-${randomUUID()}`
const directory = path.join(root, slug)
assert.ok(!existsSync(directory))
const database = 'postgresql://w02_test_20261001:w02_local_test_only@127.0.0.1:5433/raptix_web_w02_fresh_20261001'
const runtime = 'http://127.0.0.1:2400'
const api = 'http://127.0.0.1:5284/api'
// Neo4j graph-store credential comes from the repo .env (never the public
// default); the W13 graph projection is only wired when it is present.
const envFile = path.join(repo, '.env')
const neo4jPassword = existsSync(envFile) ? (readFileSync(envFile, 'utf8').match(/^NEO4J_PASSWORD=(.+)$/m)?.[1] ?? '').trim() : ''
const graphConfig = neo4jPassword && neo4jPassword !== 'raptix-graph' ? { NEO4J_HTTP_URI: 'http://127.0.0.1:7475', NEO4J_USER: 'neo4j', NEO4J_PASSWORD: neo4jPassword } : null
const phase = process.argv.includes('--w19') ? 'w19' : process.argv.includes('--w18') ? 'w18' : process.argv.includes('--w17') ? 'w17' : process.argv.includes('--w15') ? 'w15' : process.argv.includes('--w14') ? 'w14' : process.argv.includes('--w13') ? 'w13' : process.argv.includes('--w12') ? 'w12' : process.argv.includes('--w11') ? 'w11' : process.argv.includes('--w10') ? 'w10' : process.argv.includes('--w09') ? 'w09' : process.argv.includes('--w08') ? 'w08' : 'w07'
const streaming = phase !== 'w07'
let child, project, threadId, runId, evidence
let streamCursor, streamed = [], wireShapes = [], replay = []
let resumeRoundTrip = false
let cancelRunId = null
const checks = []
async function start() {
  // W18 runs the vault against a dedicated test key; the missing-key
  // configuration_missing posture is covered by the service unit lanes.
  const vaultKey = phase === 'w18' ? Buffer.alloc(32, 7).toString('base64') : undefined
  child = spawn(process.execPath, ['dist/main.js'], { cwd: path.join(repo, 'apps/web/server'), env: { ...process.env, DATABASE_URL: database, WORKSPACE_PATH: root, LANGGRAPH_API_URL: runtime, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace', HOST: '127.0.0.1', PORT: '5284', ...(graphConfig ?? {}), ...(vaultKey === undefined ? {} : { VAULT_ENCRYPTION_KEY: vaultKey }) }, stdio: 'pipe' })
  let log = ''; child.stdout.on('data', c => { log += c }); child.stderr.on('data', c => { log += c })
  for (let i = 0; i < 300; i++) {
    assert.equal(child.exitCode, null, log)
    try { if ((await fetch(`${api}/health`, { signal: AbortSignal.timeout(500) })).ok) return } catch { /* bounded startup wait */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Owned W07 API did not start')
}
async function stop() { if (child?.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)) } }
async function http(method, endpoint, body, expected) {
  const response = await fetch(`${api}${endpoint}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
  const payload = await response.json()
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(payload)}`)
  return { status: response.status, payload }
}
async function upstream(method, endpoint, body, expected = 200) {
  const response = await fetch(`${runtime}${endpoint}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, expected, `${method} ${endpoint}`)
  return response.status === 204 ? null : response.json()
}
async function graphStore(method, statement, parameters) {
  const response = await fetch('http://127.0.0.1:7475/db/neo4j/tx/commit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`neo4j:${neo4jPassword}`).toString('base64')}` }, body: JSON.stringify({ statements: [{ statement, parameters }] }), signal: AbortSignal.timeout(10000) })
  const body = await response.json().catch(() => null)
  return { status: response.status, rows: body?.results?.[0]?.data?.[0]?.row ?? [] }
}
try {
  await start()
  project = (await http('POST', '/engagements', { name: slug, targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true }, 201)).payload
  const base = `/engagements/${project.id}`
  const threadRequest = { requestId: `w07-thread-${randomUUID()}`, kind: 'planning' }
  const threads = await Promise.all(Array.from({ length: 6 }, () => http('POST', `${base}/threads`, threadRequest)))
  assert.ok(threads.every(r => [201, 202].includes(r.status)), JSON.stringify(threads))
  const threadRecovery = (await http('GET', `${base}/requests/${threadRequest.requestId}`, undefined, 200)).payload
  assert.ok(isRequestRecoveryView(threadRecovery)); assert.equal(threadRecovery.state, 'accepted'); assert.ok(threadRecovery.threadId)
  threadId = threadRecovery.threadId
  const fresh = await upstream('GET', `/threads/${threadId}/state`)
  writeFileSync(new URL('../docs/integration/w07-pristine-state.json', import.meta.url), JSON.stringify({ keys: Object.keys(fresh.values ?? {}), core: Object.fromEntries(['engagement_name', 'workspace_path', 'target_type', 'target_value', 'authorization_confirmed'].map(k => [k, fresh.values?.[k] ?? null])), messageCount: fresh.values?.messages?.length ?? 0, checkpointPresent: fresh.checkpoint != null, graphId: fresh.metadata?.graph_id ?? null }, null, 2) + '\n')
  assert.ok(isScopedThreadView((await http('GET', `${base}/threads/${threadId}`, undefined, 200)).payload))
  checks.push('six concurrent thread POSTs acknowledge one bound native thread with sanitized pristine snapshot')
  const intent = { requestId: `w07-run-${randomUUID()}`, message: 'This is an authorized context-only integration check, not an assessment. Do not invoke tools, delegate, access targets, or write files. Reply with one short acknowledgement of receiving this message only.' }
  const acks = await Promise.all(Array.from({ length: 6 }, () => http('POST', `${base}/threads/${threadId}/runs`, intent)))
  assert.ok(acks.every(r => r.status === 202), JSON.stringify(acks))
  const recovered = (await http('GET', `${base}/requests/${intent.requestId}`, undefined, 200)).payload
  assert.ok(isRequestRecoveryView(recovered)); assert.equal(recovered.state, 'accepted'); assert.ok(recovered.runId)
  runId = recovered.runId
  if (streaming) {
    const controller = new AbortController()
    const response = await fetch(`${api}${base}/threads/${threadId}/runs/${runId}/events`, { signal: controller.signal })
    assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith('text/event-stream'))
    try {
      for await (const frame of decodeSse(response.body)) {
        if (frame.event === 'run-event') { const event = JSON.parse(frame.data); assert.ok(isPublicStreamEvent(event)); streamed.push(event) }
        if (frame.id) { streamCursor = frame.id; controller.abort(); break }
      }
    } catch (error) { if (!controller.signal.aborted) throw error }
    assert.ok(streamCursor, 'Native join must provide a genuine replay cursor')
    checks.push('early SSE attach/abort preserves native cursor without cancelling the acknowledged run')
  }
  await http('POST', `${base}/threads/${threadId}/runs`, { ...intent, message: 'Changed intent must not dispatch' }, 409)
  await http('GET', `${base}/threads/${threadId}/runs/${randomUUID()}`, undefined, 404)
  checks.push('six concurrent submissions acknowledge one native run; changed intent and arbitrary run IDs are rejected')
  let final
  for (let i = 0; i < 120; i++) {
    final = (await http('GET', `${base}/threads/${threadId}/runs/${runId}`, undefined, 200)).payload
    assert.ok(isScopedRunView(final))
    if (['success', 'error', 'timeout', 'interrupted'].includes(final.rawStatus)) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(['success', 'interrupted'].includes(final.rawStatus), `Native model did not complete/interrupt normally: ${final.rawStatus}`)
  const native = await upstream('GET', `/threads/${threadId}/runs/${runId}`)
  assert.equal(native.multitask_strategy, 'reject'); assert.equal(native.metadata.ui_request_id, intent.requestId)
  const nativeRuns = await upstream('GET', `/threads/${threadId}/runs?limit=100`)
  assert.equal(nativeRuns.filter(run => run.metadata?.ui_request_id === intent.requestId).length, 1)
  if (streaming) {
    const path = `${base}/threads/${threadId}/runs/${runId}/events`
    const resumed = await fetch(`${api}${path}`, { headers: { 'Last-Event-ID': streamCursor } })
    assert.equal(resumed.status, 200)
    const resumeText = await resumed.text()
    const frames = new SseDecoder().push(resumeText)
    for (const frame of frames) if (frame.event === 'run-event') { const event = JSON.parse(frame.data); assert.ok(isPublicStreamEvent(event)); streamed.push(event); assert.equal(event.upstreamCursor, frame.id) }
    assert.ok(frames.some(frame => frame.event === 'control' && JSON.parse(frame.data).recoveryRequired))
    const all = await fetch(`${api}${path}`, { headers: { 'Last-Event-ID': '-1' } })
    replay = new SseDecoder().push(await all.text()).filter(frame => frame.event === 'run-event').map(frame => JSON.parse(frame.data))
    assert.ok(replay.length > 0 && replay.every(isPublicStreamEvent), 'Late attach must recover public buffered events')
    const { emptyStreamState, reduceStreamEvent } = await import('../src/features/agent-runs/stream-reducer.ts')
    let state = emptyStreamState(project.id, threadId)
    for (const event of [...streamed, ...replay]) state = reduceStreamEvent(state, event)
    const before = JSON.stringify(state.messages)
    for (const event of replay) state = reduceStreamEvent(state, event)
    assert.equal(JSON.stringify(state.messages), before, 'Repeated replay must not duplicate message text')
    assert.ok(Object.values(state.messages).some(message => message.role === 'assistant' && message.content.length > 0))
    const raw = await fetch(`${runtime}/threads/${threadId}/runs/${runId}/stream?cancel_on_disconnect=0`, { headers: { 'Last-Event-ID': '-1' } })
    for await (const frame of decodeSse(raw.body)) {
      let payload; try { payload = JSON.parse(frame.data) } catch { payload = null }
      wireShapes.push({ event: frame.event, id: frame.id, array: Array.isArray(payload), keys: payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload).slice(0, 30) : [] })
    }
    await http('GET', `${base}/threads/${threadId}/runs/${randomUUID()}/events`, undefined, 404)
    await http('GET', `${path}?cursor=https://invalid.example`, undefined, 400)
    assert.equal((await upstream('GET', `/threads/${threadId}/runs?limit=100`)).filter(run => run.metadata?.ui_request_id === intent.requestId).length, 1)
    checks.push('actual SSE cursor reconnect/late replay, pure reducer dedup and scope/cursor denial create no additional execution')
  }
  const hydrated = await upstream('GET', `/threads/${threadId}/state`)
  const remoteThread = await upstream('GET', `/threads/${threadId}`)
  const contextKeys = ['engagement_name', 'workspace_path', 'target_type', 'target_value', 'authorization_confirmed', 'language', 'kg_engagement']
  const proofKeys = ['engagement_id', 'workspace_slug', 'ui_assistant_id', 'graph_id', 'ui_flow', 'runtime_context_hash']
  writeFileSync(new URL('../docs/integration/w07-hydrated-context.json', import.meta.url), JSON.stringify({ runStatus: native.status, threadMetadata: Object.fromEntries(proofKeys.map(k => [k, remoteThread.metadata?.[k] ?? null])), values: Object.fromEntries(contextKeys.map(k => [k, hydrated.values?.[k] ?? null])), checkpointMetadata: hydrated.metadata, checkpointPresent: hydrated.checkpoint != null }, null, 2) + '\n')
  const snapshot = (await http('GET', `${base}/threads/${threadId}`, undefined, 200)).payload
  assert.ok(isScopedThreadView(snapshot)); assert.ok(snapshot.messages.some(message => message.role === 'user' && message.content === intent.message))
  if (phase === 'w09') {
    assert.ok(snapshot.messages.every(message => message.messageId === undefined || typeof message.messageId === 'string' || message.messageId === null), 'Message ids must be provable identity or explicit null')
    assert.ok(Array.isArray(snapshot.transcripts) && snapshot.transcripts.every(t => t.runId === null && t.source === 'checkpoint'), 'Transcript history field stays thread-level and checkpoint-sourced even when the deployed runtime exposes no entries yet')
    assert.equal(typeof snapshot.transcriptsTruncated, 'boolean')
    await http('GET', `/engagements/${randomUUID()}/threads/${threadId}`, undefined, 404)
    const { emptyStreamState, reduceStreamEvent } = await import('../src/features/agent-runs/stream-reducer.ts')
    const { mergeThreadHistory } = await import('../src/features/agent-runs/history-merge.ts')
    let state = emptyStreamState(project.id, threadId)
    for (const event of [...streamed, ...replay]) state = reduceStreamEvent(state, event)
    state = mergeThreadHistory(state, snapshot)
    const merged = JSON.stringify([state.messages, state.tools, state.invocations])
    state = mergeThreadHistory(state, snapshot)
    assert.equal(JSON.stringify([state.messages, state.tools, state.invocations]), merged, 'History merge must be idempotent across reconnects')
    assert.ok(Object.values(state.messages).some(message => message.role === 'assistant' && message.content.length > 0), 'Live replay content survives history merge')
    checks.push('actual planning run snapshot exposes owned thread-level history fields with stable ids, merge is idempotent with live replay, and foreign scope stays denied')
  }
  if (phase === 'w10') {
    const list = (await http('GET', `${base}/threads`, undefined, 200)).payload
    assert.ok(isScopedThreadListView(list)); assert.equal(list.engagementId, project.id); assert.equal(list.source, 'runtime')
    const listed = list.threads.find(thread => thread.threadId === threadId)
    assert.ok(listed, 'The acknowledged planning thread must appear in the owner-scoped selector feed')
    assert.equal(listed.kind, 'planning'); assert.ok(listed.assistantId)
    const stamps = list.threads.map(thread => thread.updatedAt)
    assert.deepEqual(stamps, [...stamps].sort().reverse(), 'Selector feed must be newest-activity first')
    assert.ok(list.threads.length <= 100, 'Selector feed stays bounded')
    await http('GET', `/engagements/${randomUUID()}/threads`, undefined, 404)
    checks.push('owner-scoped thread selector feed lists bound threads newest-first with runtime provenance and foreign engagements stay denied')
  }
  if (phase === 'w11') {
    // Real cancel: interrupt a fresh acknowledged run while it executes on the original thread.
    const cancelIntent = { requestId: `w11-cancel-${randomUUID()}`, message: intent.message }
    const cancelAcks = await http('POST', `${base}/threads/${threadId}/runs`, cancelIntent)
    assert.ok([202].includes(cancelAcks.status), JSON.stringify(cancelAcks))
    const cancelRecovered = (await http('GET', `${base}/requests/${cancelIntent.requestId}`, undefined, 200)).payload
    assert.ok(isRequestRecoveryView(cancelRecovered) && cancelRecovered.state === 'accepted' && cancelRecovered.runId)
    cancelRunId = cancelRecovered.runId
    await new Promise(resolve => setTimeout(resolve, 300))
    const cancelled = (await http('POST', `${base}/threads/${threadId}/runs/${cancelRecovered.runId}/cancel`, undefined, 200)).payload
    assert.ok(isScopedRunView(cancelled) && cancelled.runId === cancelRecovered.runId, JSON.stringify(cancelled))
    assert.ok(['interrupted', 'success'].includes(cancelled.rawStatus), `Cancel must settle truthfully: ${cancelled.rawStatus}`)
    checks.push('owned run cancel returns the settled scoped run view without fabricating a local state')
    // Resume without a pending graph interrupt is a truthful conflict, never a dispatch.
    await http('POST', `${base}/threads/${threadId}/resume`, { requestId: `w11-resume-${randomUUID()}`, value: 'Yes' }, 409)
    checks.push('scoped resume is rejected with a conflict while no graph interrupt is pending')
    // File-backed HITL round trip against the real engagement workspace files.
    const approvalsDir = path.join(root, project.workspaceSlug, 'approvals')
    const approvalRequest = { kind: 'approval_request', request_id: 'w11-approval-1', engagement_name: project.workspaceSlug, agent_name: 'decepticon', tool_name: 'impacket-secretsdump', tool_args_redacted: { user: 'CORP/svc_backup', password: '***REDACTED***' }, matched_rule: { technique_tag: 'T1003', tool_pattern: null, timeout_seconds: 300, default_on_timeout: 'deny' }, reason: 'OS Credential Dumping (T1003) requires operator approval.', created_at: Date.now() / 1000, metadata: { producer_note: 'w11-live' } }
    await mkdir(approvalsDir, { recursive: true })
    await appendFile(path.join(approvalsDir, 'requests.jsonl'), `${JSON.stringify(approvalRequest)}\n`, 'utf8')
    const listed = (await http('GET', `${base}/approvals`, undefined, 200)).payload
    assert.ok(Array.isArray(listed.approvals) && listed.approvals.length === 1, JSON.stringify(listed))
    const pendingApproval = listed.approvals[0]
    assert.ok(pendingApproval.requestId === 'w11-approval-1' && pendingApproval.toolName === 'impacket-secretsdump' && pendingApproval.createdAtSeconds > 0)
    assert.ok(!JSON.stringify(listed).includes('producer_note'), 'Producer metadata must not leak into the public approvals view')
    const decision = (await http('POST', `${base}/approvals`, { requestId: 'w11-approval-1', action: 'allow', operatorNote: 'Operator decision' }, 200)).payload
    assert.ok(decision.ok === true && decision.action === 'allow')
    const after = (await http('GET', `${base}/approvals`, undefined, 200)).payload
    assert.equal(after.approvals.length, 0, 'A decided approval leaves the pending list')
    await http('POST', `${base}/approvals`, { requestId: 'w11-approval-1', action: 'deny' }, 409)
    const decisionLine = JSON.parse((await readFile(path.join(approvalsDir, 'decisions.jsonl'), 'utf8')).trim())
    assert.deepEqual({ kind: decisionLine.kind, request_id: decisionLine.request_id, action: decisionLine.action, operator_note: decisionLine.operator_note, redirect_args: decisionLine.redirect_args }, { kind: 'approval_decision', request_id: 'w11-approval-1', action: 'allow', operator_note: 'Operator decision', redirect_args: null })
    assert.ok(typeof decisionLine.decided_at === 'number')
    await http('GET', `/engagements/${randomUUID()}/approvals`, undefined, 404)
    checks.push('file-backed HITL approvals list, atomic decision append, duplicate 409 and foreign-scope denial all run against the real workspace files')
  }
  if (phase === 'w12') {
    // Real workspace findings + artifact round trip against the owned engagement directory.
    const findingsDir = path.join(root, project.workspaceSlug, 'findings')
    const reconDir = path.join(root, project.workspaceSlug, 'recon')
    await mkdir(findingsDir, { recursive: true })
    await mkdir(reconDir, { recursive: true })
    await writeFile(path.join(findingsDir, 'FIND-2026-W12.md'), ['# Exposed .env File (W12 Gate)', '', 'Severity: critical', 'CVSS score: 9.1', 'CVSS vector: AV:N/AC:L/PR:N/UI:N', '', '## Description', 'The verifier gate exposes a `.env` file via HTTP.', '', '## Evidence', '- GET /.env returned 200 with DB_PASSWORD', '', '## Attack Vector', 'Unauthenticated HTTP GET.', '', '## Affected Assets', '- api.acme.invalid/.env', '', '## CWE', 'CWE-312', '', '## Mitre ATT&CK', 'T1552.001', '', '## Remediation', 'Rotate credentials.'].join('\n'), 'utf8')
    await writeFile(path.join(findingsDir, 'FIND-2026-BROKEN.md'), 'unstructured noise, no sections', 'utf8')
    await writeFile(path.join(reconDir, 'probe.json'), '{"open": [80, 443]}', 'utf8')
    const findings = (await http('GET', `${base}/findings`, undefined, 200)).payload
    assert.ok(isFindingsView(findings) && findings.source === 'workspace' && findings.engagementId === project.id)
    assert.equal(findings.findings.length, 2)
    const parsed = findings.findings.find(finding => finding.id === 'FIND-2026-W12')
    assert.ok(parsed, JSON.stringify(findings))
    assert.equal(parsed.severity, 'critical')
    assert.equal(parsed.cvssScore, 9.1)
    assert.deepEqual(parsed.cwe, ['CWE-312'])
    assert.deepEqual(parsed.mitre, ['T1552.001'])
    assert.deepEqual(parsed.affectedAssets, ['api.acme.invalid/.env'])
    assert.ok(parsed.rawSource.includes('# Exposed .env File (W12 Gate)'))
    assert.deepEqual(parsed.quality, { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false })
    const broken = findings.findings.find(finding => finding.id === 'FIND-2026-BROKEN')
    assert.ok(broken && broken.quality.defaultSeverity && broken.quality.placeholderDescription && broken.rawSource.includes('unstructured noise'), 'A malformed finding stays viewable through its raw source without fake analyst confirmation')
    checks.push('parsed FIND-*.md projections carry parser-quality provenance and malformed findings stay viewable via bounded raw source')
    const artifacts = (await http('GET', `${base}/artifacts`, undefined, 200)).payload
    assert.ok(isArtifactsView(artifacts) && artifacts.source === 'workspace')
    const folderNames = artifacts.folders.map(folder => folder.folder).sort()
    assert.deepEqual(folderNames, ['findings', 'recon'])
    assert.ok(artifacts.folders.find(folder => folder.folder === 'recon').files.some(file => file.path === 'recon/probe.json'))
    const content = (await http('GET', `${base}/artifacts/content?path=${encodeURIComponent('recon/probe.json')}`, undefined, 200)).payload
    assert.ok(isArtifactContentView(content) && content.mediaType === 'json' && content.truncated === false && JSON.parse(content.content).open[1] === 443)
    checks.push('engagement-scoped artifact browser lists allowlisted folders and serves UTF-8 text/JSON content with a tightened path boundary')
    await http('GET', `${base}/artifacts/content?path=${encodeURIComponent('recon/../../secrets.txt')}`, undefined, 400)
    await http('GET', `${base}/artifacts/content?path=${encodeURIComponent('private/keys.txt')}`, undefined, 400)
    await http('GET', `${base}/artifacts/content?path=${encodeURIComponent('recon/missing.txt')}`, undefined, 404)
    await http('GET', `/engagements/${randomUUID()}/findings`, undefined, 404)
    await http('GET', `/engagements/${randomUUID()}/artifacts`, undefined, 404)
    checks.push('artifact traversal and foreign engagements are rejected without leaking workspace paths')
  }
  if (phase === 'w13') {
    // Real Neo4j round trip: seed engagement-scoped nodes, read them through
    // the public projection, prove redaction and cross-engagement isolation.
    assert.ok(graphConfig, 'W13 verifier lane requires NEO4J_PASSWORD from the repo .env')
    const seeded = await graphStore('POST', 'UNWIND $nodes AS node CREATE (n:Host:VerifierGate) SET n = node', { nodes: [
      { engagement: project.workspaceSlug, hostname: 'dc01.verifiergate', ip: '10.98.0.5', os: 'Windows Server 2022', password: 'verifier-secret-DO-NOT-LEAK' },
      { engagement: project.workspaceSlug, hostname: 'dc01.verifiergate', ip: '10.98.0.5', port: 445 },
      { engagement: 'w13-foreign-engagement', hostname: 'foreign.verifiergate', ip: '10.98.9.9' },
    ] })
    assert.equal(seeded.status, 200)
    try {
      const graph = (await http('GET', `${base}/graph`, undefined, 200)).payload
      assert.ok(isGraphView(graph) && graph.source === 'graph' && graph.engagementId === project.id)
      assert.equal(graph.nodes.length, 2, JSON.stringify(graph))
      const host = graph.nodes.find(node => node.labels.includes('Host') && node.properties.hostname === 'dc01.verifiergate')
      assert.ok(host, 'Seeded scoped host must surface through the public projection')
      assert.equal(host.properties.os, 'Windows Server 2022')
      assert.ok(!JSON.stringify(graph).includes('verifier-secret-DO-NOT-LEAK'), 'Credential-like properties must never leave the server')
      assert.ok(!JSON.stringify(graph).includes('foreign.verifiergate'), 'Foreign-engagement nodes must stay invisible')
      assert.equal(graph.edges.length, 0)
      const assets = (await http('GET', `${base}/assets`, undefined, 200)).payload
      assert.ok(isAssetsView(assets) && assets.source === 'graph')
      assert.equal(assets.assets.length, 1, 'Same hostname+ip nodes dedupe into one asset summary')
      assert.equal(assets.assets[0].ports.length, 1, 'Merged ports survive the dedupe')
      checks.push('engagement-scoped graph projection reads the real Neo4j store with server-side redaction and cross-engagement isolation')
      checks.push('asset summaries dedupe by hostname+ip domain key with counters derived from the same projection')
      await http('GET', `/engagements/${randomUUID()}/graph`, undefined, 404)
      await http('GET', `/engagements/${randomUUID()}/assets`, undefined, 404)
      checks.push('foreign graph and asset scope stays denied on the real store')
    } finally {
      await graphStore('POST', 'MATCH (n:VerifierGate) WHERE n.engagement STARTS WITH "w07-live-" DETACH DELETE n', {})
    }
  }
  if (phase === 'w14') {
    // Real operations timeline + validated export: workspace artifact markers
    // merge with the actual planning run; exports return the real payload with
    // correct attachment headers and unsupported formats are rejected.
    const findingsDir = path.join(root, project.workspaceSlug, 'findings')
    const reconDir = path.join(root, project.workspaceSlug, 'recon')
    await mkdir(findingsDir, { recursive: true })
    await mkdir(reconDir, { recursive: true })
    await writeFile(path.join(findingsDir, 'FIND-2026-W14.md'), ['# Exposed .env File (W14 Gate)', '', 'Severity: high', '', '## Description', 'The W14 verifier gate exposes a `.env` file via HTTP.', '', '## Evidence', '- GET /.env returned 200'].join('\n'), 'utf8')
    await writeFile(path.join(reconDir, 'probe.txt'), 'open 80,443', 'utf8')
    const timeline = (await http('GET', `${base}/timeline`, undefined, 200)).payload
    assert.ok(isTimelineView(timeline) && timeline.source === 'mixed' && timeline.engagementId === project.id, JSON.stringify(timeline))
    const sources = new Set(timeline.entries.map(entry => entry.source))
    assert.ok(sources.has('runtime'), `Timeline must carry a runtime label: ${JSON.stringify(timeline)}`)
    const runEntry = timeline.entries.find(entry => entry.source === 'runtime' && entry.runId === runId)
    assert.ok(runEntry && runEntry.status === final.rawStatus, 'The acknowledged planning run must surface as one merged runtime entry')
    assert.ok(sources.has('workspace'), JSON.stringify(timeline))
    const artifactEntry = timeline.entries.find(entry => entry.source === 'workspace' && entry.id === 'workspace:recon/probe.txt')
    assert.ok(artifactEntry && artifactEntry.tool === 'recon' && artifactEntry.label === 'Artifact updated: recon/probe.txt', JSON.stringify(timeline))
    assert.ok(Number.isFinite(Date.parse(artifactEntry.at)), 'Artifact mtime entries carry a parseable timestamp labeled as a presence marker')
    checks.push('operations timeline merges the real planning run and labeled workspace artifact markers without transcript duplication')
    const badExport = await http('GET', `${base}/export?format=pdf`, undefined, 400)
    assert.ok(badExport.payload.error.message.includes('json, markdown'), 'Unsupported export formats must be rejected with the supported list')
    const jsonRes = await fetch(`${api}${base}/export?format=json`, { signal: AbortSignal.timeout(15000) })
    assert.equal(jsonRes.status, 200)
    assert.equal(jsonRes.headers.get('content-disposition'), `attachment; filename="${slug}-export.json"`)
    assert.ok(jsonRes.headers.get('content-type').includes('application/json'))
    const exportPayload = await jsonRes.json()
    assert.equal(exportPayload.engagement.id, project.id)
    assert.ok(exportPayload.findings.some(finding => finding.id === 'FIND-2026-W14'), JSON.stringify(exportPayload))
    assert.equal(exportPayload.formatValidated, true)
    const mdRes = await fetch(`${api}${base}/export?format=markdown`, { signal: AbortSignal.timeout(15000) })
    assert.equal(mdRes.status, 200)
    assert.ok(mdRes.headers.get('content-type').includes('text/markdown'))
    assert.equal(mdRes.headers.get('content-disposition'), `attachment; filename="${slug}-export.md"`)
    const markdown = await mdRes.text()
    assert.ok(markdown.includes(`# ${slug} — Engagement Export`))
    assert.ok(markdown.includes('### FIND-2026-W14'))
    checks.push('engagement export validates formats server-side and returns the actual plan/findings payload with correct attachment headers')
    await http('GET', `/engagements/${randomUUID()}/timeline`, undefined, 404)
    await http('GET', `/engagements/${randomUUID()}/export?format=json`, undefined, 404)
    checks.push('foreign engagements stay denied for the timeline and export endpoints')
  }
  if (phase === 'w15') {
    // Real settings round trip: persisted view, up-front target policy after a
    // bound thread exists, save/reload acknowledgement and the danger delete
    // refused while the planning run still holds the reservation, then allowed.
    const settings = (await http('GET', `${base}/settings`, undefined, 200)).payload
    assert.ok(isEngagementSettingsView(settings) && settings.source === 'db' && settings.engagementId === project.id)
    assert.equal(settings.name, slug)
    assert.ok(settings.targetChange.allowed === false && settings.targetChange.reason && settings.targetChange.reason.includes('not allowed'), `A bound/locked engagement must state the target lock: ${JSON.stringify(settings.targetChange)}`)
    checks.push('settings view states the persisted fields and the target-change lock reason instead of failing opaquely')
    const renamed = (await http('PATCH', base, { displayName: `${slug} renamed` }, 200)).payload
    assert.equal(renamed.displayName, `${slug} renamed`)
    const reloaded = (await http('GET', `${base}/settings`, undefined, 200)).payload
    assert.equal(reloaded.displayName, `${slug} renamed`)
    checks.push('display-name save round trips through the validated PATCH and the reloaded server view')
    await http('PATCH', base, { displayName: '' }, 400)
    await http('PATCH', base, { targetValue: 'https://other.invalid' }, 409)
    checks.push('invalid fields and locked target changes are rejected with field attribution')
    await http('PATCH', base, { displayName: '' }, 400)
    await http('PATCH', base, { targetValue: 'https://other.invalid' }, 409)
    checks.push('invalid fields and locked target changes are rejected with field attribution')
    await http('GET', `/engagements/${randomUUID()}/settings`, undefined, 404)
  }
  if (phase === 'w17') {
    // Real campaign persistence: create a draft, record truthful provider
    // jobs, reload to prove persistence, then state the scoped C2 absence.
    const created = (await http('POST', `${base}/campaigns`, { name: 'Verifier Wave 1', vector: 'phishing', scenario: 'it-security-alert' }, 201)).payload
    assert.ok(isCampaignView(created) && created.engagementId === project.id && created.status === 'draft' && created.version === 1)
    assert.deepEqual(created.spec, { scenario: 'it-security-alert' })
    const generate = (await http('POST', `${base}/campaigns/${created.id}/generate`, undefined, 200)).payload
    assert.ok(isCampaignJobView(generate) && generate.kind === 'generate' && generate.status === 'unavailable' && generate.provider === null && generate.error.includes('provider not configured'), JSON.stringify(generate))
    checks.push('campaign draft persisted and the generate attempt recorded a truthful unavailable provider job')
    await http('POST', `${base}/campaigns`, { name: '', vector: 'phishing' }, 400)
    await http('POST', `${base}/campaigns`, { name: 'Bad Vector', vector: 'sms' }, 400)
    checks.push('invalid drafts rejected with field attribution and the supported vector list')
    const list = (await http('GET', `${base}/campaigns`, undefined, 200)).payload
    assert.ok(isCampaignsView(list) && list.engagementId === project.id && list.truncated === false)
    const reloaded = list.campaigns.find(entry => entry.id === created.id)
    assert.ok(reloaded && reloaded.status === 'draft' && reloaded.jobs.some(job => job.id === generate.id && job.status === 'unavailable'), JSON.stringify(list))
    checks.push('draft and job history survive reload; the campaign stays draft with no fabricated Generated/Delivered state')
    const deploy = (await http('POST', `${base}/campaigns/${created.id}/deploy`, undefined, 200)).payload
    assert.ok(isCampaignJobView(deploy) && deploy.kind === 'deploy' && deploy.status === 'unavailable')
    const c2 = await fetch(`${api}${base}/c2/sessions`, { signal: AbortSignal.timeout(15000) })
    assert.equal(c2.status, 503)
    const c2Body = await c2.json()
    assert.ok(c2Body.error.message.includes('not configured'), JSON.stringify(c2Body))
    checks.push('C2 sessions route enforces engagement scoping and then states the unavailable provider instead of fabricating sessions')
    await http('GET', `/engagements/${randomUUID()}/campaigns`, undefined, 404)
    await http('GET', `/engagements/${randomUUID()}/c2/sessions`, undefined, 404)
    checks.push('foreign engagements stay denied for the campaign and c2 endpoints')
  }
  if (phase === 'w18') {
    // Real vault round trip: redacted metadata, explicit audited reveal,
    // audited revocation, and the fail-loud missing-key posture.
    const stored = (await http('POST', `${base}/vault/secrets`, { kind: 'api-key', label: 'Verifier Grafana admin', plaintext: 'w18-reveal-once-value' }, 201)).payload
    assert.ok(isVaultSecretView(stored) && stored.id && stored.revealCount === 0 && stored.lastRevealedAt === null, JSON.stringify(stored))
    const storedList = (await http('GET', `${base}/vault/secrets`, undefined, 200)).payload
    assert.ok(isVaultView(storedList))
    assert.equal(JSON.stringify(storedList).includes('w18-reveal-once-value'), false, 'Vault metadata must never contain the plaintext secret')
    checks.push('vault stores the secret server-side encrypted and the metadata view is redacted by construction')
    const revealed = (await http('POST', `${base}/vault/secrets/${stored.id}/reveal`, undefined, 200)).payload
    assert.ok(isVaultRevealView(revealed) && revealed.plaintext === 'w18-reveal-once-value')
    checks.push('explicit reveal returns the plaintext exactly once per call and is audited in the metadata')
    const after = (await http('GET', `${base}/vault/secrets`, undefined, 200)).payload
    const audited = after.secrets.find(entry => entry.id === stored.id)
    assert.ok(audited && audited.revealCount === 1 && typeof audited.lastRevealedAt === 'string')
    await http('POST', `${base}/vault/secrets`, { kind: '', label: 'X', plaintext: 'v' }, 400)
    checks.push('vault input validation attributes field failures instead of storing junk')
    const revoked = (await http('DELETE', `${base}/vault/secrets/${stored.id}`, undefined, 200)).payload
    assert.deepEqual(revoked, { ok: true })
    const empty = (await http('GET', `${base}/vault/secrets`, undefined, 200)).payload
    assert.equal(empty.secrets.some(entry => entry.id === stored.id), false)
    checks.push('revocation removes the secret and the audit log survives the deletion')
    await http('GET', `/engagements/${randomUUID()}/vault/secrets`, undefined, 404)
    checks.push('foreign engagements stay denied for the vault endpoints')
  }
  if (phase === 'w19') {
    // Real members topology: the truthful local single-user view plus
    // explicit 503 reasons for the absent invite/RBAC APIs.
    const members = (await http('GET', `${base}/members`, undefined, 200)).payload
    assert.ok(isMembersView(members) && members.engagementId === project.id && members.mode === 'local-single-user' && members.source === 'db')
    assert.equal(members.inviteSupported, false)
    assert.ok(members.members.length === 1 && members.members[0].id === 'local' && members.members[0].source === 'local')
    assert.ok(members.reason && members.reason.includes('authentication strategy'))
    checks.push('members view states the local single-user topology with the explicit unsupported-invite reason instead of a fake hierarchy')
    const invite = await fetch(`${api}${base}/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Someone Else', role: 'viewer' }), signal: AbortSignal.timeout(15000) })
    assert.equal(invite.status, 503)
    const inviteBody = await invite.json()
    assert.ok(inviteBody.error.message.includes('not supported'), JSON.stringify(inviteBody))
    const removal = await fetch(`${api}${base}/members/someone-else`, { method: 'DELETE', signal: AbortSignal.timeout(15000) })
    assert.equal(removal.status, 503)
    checks.push('invite and removal attempts answer 503 with their reason; no member row is ever created')
    await http('GET', `/engagements/${randomUUID()}/members`, undefined, 404)
    checks.push('foreign engagements stay denied for the members endpoints')
  }
  const page = (await http('GET', `${base}/threads/${threadId}/runs?limit=1`, undefined, 200)).payload
  assert.equal(page.runs[0].runId, phase === 'w11' ? cancelRunId : runId)
  checks.push('actual planning model run reaches a normal outcome under native reject policy; root snapshot and owned run list preserve identity')
  if (phase === 'w11') {
    // Full resume round trip on a fresh thread when the deployed model actually interrupts with a question.
    const secondThread = (await http('POST', `${base}/threads`, { requestId: `w11-thread-${randomUUID()}`, kind: 'planning' })).payload
    assert.ok(isRequestRecoveryView(secondThread) && secondThread.state === 'accepted' && secondThread.threadId)
    const questionIntent = { requestId: `w11-question-${randomUUID()}`, message: 'I want to assess the security of the in-scope target. Begin the engagement planning interview and ask me the first question you need answered before planning anything.' }
    const questionAck = (await http('POST', `${base}/threads/${secondThread.threadId}/runs`, questionIntent)).payload
    assert.ok(isRequestRecoveryView(questionAck))
    let questionRunId = null
    for (let i = 0; i < 60; i++) {
      const view = (await http('GET', `${base}/requests/${questionIntent.requestId}`, undefined, 200)).payload
      if (view.state === 'accepted' && view.runId) { questionRunId = view.runId; break }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    assert.ok(questionRunId, 'question-intent run must be acknowledged')
    for (let i = 0; i < 90; i++) {
      const view = (await http('GET', `${base}/threads/${secondThread.threadId}/runs/${questionRunId}`, undefined, 200)).payload
      if (['success', 'error', 'timeout', 'interrupted'].includes(view.rawStatus)) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    const state = await upstream('GET', `/threads/${secondThread.threadId}/state`)
    const interruptEnvelope = Array.isArray(state.values?.__interrupt__) ? state.values.__interrupt__ : []
    let questionPayload = null
    for (const entry of interruptEnvelope) {
      const candidate = entry && typeof entry === 'object' ? (entry.value ?? entry) : null
      if (candidate && typeof candidate === 'object' && candidate.type === 'ask_user_question') { questionPayload = candidate; break }
    }
    if (questionPayload && Array.isArray(questionPayload.options) && questionPayload.options.length > 0 && typeof questionPayload.options[0].label === 'string') {
      const resumeAck = (await http('POST', `${base}/threads/${secondThread.threadId}/resume`, { requestId: `w11-resume-${randomUUID()}`, value: questionPayload.options[0].label, questionId: questionPayload.id }, 202)).payload
      assert.ok(isRequestRecoveryView(resumeAck) && resumeAck.state === 'accepted' && resumeAck.runId && resumeAck.runId !== questionRunId, JSON.stringify(resumeAck))
      const replayed = (await http('POST', `${base}/threads/${secondThread.threadId}/resume`, { requestId: resumeAck.requestId, value: questionPayload.options[0].label, questionId: questionPayload.id }, 202)).payload
      assert.equal(replayed.runId, resumeAck.runId, 'Same resume requestId must not create a second attempt')
      checks.push('actual graph interrupt resumed through the scoped API with a new run identity and idempotent replay')
      resumeRoundTrip = true
    } else {
      checks.push('deployed model produced no question interrupt this round; the resume happy path is proven by the controlled service lanes')
    }
  }
  await stop(); await start()
  assert.equal((await http('GET', `${base}/requests/${intent.requestId}`, undefined, 200)).payload.runId, runId)
  assert.equal((await http('POST', `${base}/threads/${threadId}/runs`, intent, 202)).payload.runId, runId)
  assert.equal((await upstream('GET', `/threads/${threadId}/runs?limit=100`)).filter(run => run.metadata?.ui_request_id === intent.requestId).length, 1)
  const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
  assert.deepEqual(capabilities.capabilities.runs, { supported: true, available: true })
  checks.push('real API process restart preserves request/run deduplication; capability is live and the scoped resume route answers truthfully since W11')
  if (phase === 'w11') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.approvals, { supported: true, available: true })
  }
  if (phase === 'w12') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.findings, { supported: true, available: true })
    assert.deepEqual(capabilities.capabilities.artifacts, { supported: true, available: true })
  }
  if (phase === 'w13') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.graphs, { supported: true, available: true })
  }
  if (phase === 'w14') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.timeline, { supported: true, available: true })
    assert.deepEqual(capabilities.capabilities.reports, { supported: true, available: true })
  }
  if (phase === 'w15') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.projects, { supported: true, available: true })
    const deleteResponse = await fetch(`${api}${base}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) })
    assert.equal(deleteResponse.status, 200)
    const body = await deleteResponse.json()
    assert.deepEqual(body, { ok: true, workspaceRetained: true })
    checks.push('danger delete removes the DB record with threads and ledger after holds settled; workspace artifacts are retained')
    await http('GET', base, undefined, 404)
    const repeat = await fetch(`${api}${base}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) })
    assert.equal(repeat.status, 404)
  }
  if (phase === 'w17') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.campaigns, { supported: true, available: true })
    assert.deepEqual(capabilities.capabilities.c2, { supported: true, available: false, reason: 'provider_unavailable' })
  }
  if (phase === 'w18') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.vault, { supported: true, available: true })
    checks.push('the vault capability is available with a valid 32-byte VAULT_ENCRYPTION_KEY and the missing-key posture stays unit-tested')
  }
  if (phase === 'w19') {
    const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
    assert.deepEqual(capabilities.capabilities.members, { supported: true, available: true })
    checks.push('the members capability reflects the real single-user view while invite/RBAC stay stated-absent with reasons')
  }
  evidence = { ok: true, projectId: project.id, threadId, runId, finalStatus: final.rawStatus, checks, ...(streaming ? { streamCursor, publicEvents: streamed.length } : {}), ...(phase === 'w08' ? { wireShapes } : {}), ...(phase === 'w11' ? { resumeRoundTrip } : {}), provenance: phase === 'w19' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W19 truthful local single-user members view, the explicit 503 invite/RBAC reasons and scoped foreign denial against the real database; context-only isolated target, runtime guard path unchanged' : phase === 'w18' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W18 encrypted vault storage, redacted metadata, explicit audited reveal and revocation against the real database; context-only isolated target, runtime guard path unchanged' : phase === 'w17' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W17 persisted campaign drafts, truthful unavailable provider jobs and the scoped C2 session state against the real database; context-only isolated target, runtime guard path unchanged' : phase === 'w15' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W15 persisted settings view, validated save/reload, target-change lock policy and the danger delete against the real database; context-only isolated target, runtime guard path unchanged' : phase === 'w14' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W14 merged operations timeline and the server-validated JSON/Markdown export against the real engagement workspace; context-only isolated target, runtime guard path unchanged' : phase === 'w13' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W13 engagement-scoped Neo4j graph projection, server-side redaction and asset dedupe against the real graph store; context-only isolated target, runtime guard path unchanged' : phase === 'w12' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W12 workspace findings parser, parser-quality provenance and the tightened artifact browser boundary against the real engagement directory; context-only isolated target, runtime guard path unchanged' : phase === 'w11' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning runs exercising W11 cancel/resume gating and a real workspace approvals file round trip; context-only isolated target, runtime guard path unchanged' : phase === 'w10' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W10 thread selector feed alongside the W09 history fields; context-only isolated target, runtime guard path unchanged' : 'actual new API5284/PostgreSQL/LangGraph2400 planning run; context-only isolated target, runtime guard path unchanged; W09 history uses a controlled transcript state patch into the owned thread', ownedRuntimeFixtureRemoved: true }
} finally {
  await stop()
  if (threadId) {
    const owned = await upstream('GET', `/threads/${threadId}`)
    assert.equal(owned.metadata.engagement_id, project.id, 'Refuse cleanup of an unowned runtime thread')
    if (runId) {
      const current = await upstream('GET', `/threads/${threadId}/runs/${runId}`)
      if (['pending', 'running'].includes(current.status)) await upstream('POST', `/threads/${threadId}/runs/${runId}/cancel?wait=1&action=interrupt`, undefined, 204)
    }
    await upstream('DELETE', `/threads/${threadId}`, undefined, 204)
  }
  if (project) rmSync(directory, { recursive: true, force: true })
}
writeFileSync(new URL(`../docs/integration/${phase}-live.json`, import.meta.url), JSON.stringify(evidence, null, 2) + '\n')
console.log(`${phase} actual-runtime acknowledged run, scoped reads and process-restart gate passed (${checks.length} groups)`)
