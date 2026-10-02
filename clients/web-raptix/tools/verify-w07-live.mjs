import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { isRequestRecoveryView, isScopedRunView, isScopedThreadView } from '@raptix/web-contracts'
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
const phase = process.argv.includes('--w09') ? 'w09' : process.argv.includes('--w08') ? 'w08' : 'w07'
const streaming = phase !== 'w07'
let child, project, threadId, runId, evidence
let streamCursor, streamed = [], wireShapes = [], replay = []
const checks = []
async function start() {
  child = spawn(process.execPath, ['dist/main.js'], { cwd: path.join(repo, 'clients/web-raptix/server'), env: { ...process.env, DATABASE_URL: database, WORKSPACE_PATH: root, LANGGRAPH_API_URL: runtime, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace', HOST: '127.0.0.1', PORT: '5284' }, stdio: 'pipe' })
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
  const page = (await http('GET', `${base}/threads/${threadId}/runs?limit=1`, undefined, 200)).payload
  assert.equal(page.runs[0].runId, runId)
  checks.push('actual planning model run reaches a normal outcome under native reject policy; root snapshot and owned run list preserve identity')
  await stop(); await start()
  assert.equal((await http('GET', `${base}/requests/${intent.requestId}`, undefined, 200)).payload.runId, runId)
  assert.equal((await http('POST', `${base}/threads/${threadId}/runs`, intent, 202)).payload.runId, runId)
  assert.equal((await upstream('GET', `/threads/${threadId}/runs?limit=100`)).filter(run => run.metadata?.ui_request_id === intent.requestId).length, 1)
  const capabilities = (await http('GET', '/capabilities', undefined, 200)).payload
  assert.deepEqual(capabilities.capabilities.runs, { supported: true, available: true })
  await http('POST', `${base}/threads/${threadId}/resume`, { requestId: 'deferred-resume', value: 'unsafe' }, 404)
  checks.push('real API process restart preserves request/run deduplication; capability is live and resume remains gated')
  evidence = { ok: true, projectId: project.id, threadId, runId, finalStatus: final.rawStatus, checks, ...(streaming ? { streamCursor, publicEvents: streamed.length } : {}), ...(phase === 'w08' ? { wireShapes } : {}), provenance: 'actual new API5284/PostgreSQL/LangGraph2400 planning run; context-only isolated target, runtime guard path unchanged; W09 history uses a controlled transcript state patch into the owned thread', ownedRuntimeFixtureRemoved: true }
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
