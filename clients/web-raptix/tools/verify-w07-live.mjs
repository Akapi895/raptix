import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { isRequestRecoveryView, isScopedRunView, isScopedThreadListView, isScopedThreadView } from '@raptix/web-contracts'
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
const phase = process.argv.includes('--w11') ? 'w11' : process.argv.includes('--w10') ? 'w10' : process.argv.includes('--w09') ? 'w09' : process.argv.includes('--w08') ? 'w08' : 'w07'
const streaming = phase !== 'w07'
let child, project, threadId, runId, evidence
let streamCursor, streamed = [], wireShapes = [], replay = []
let resumeRoundTrip = false
let cancelRunId = null
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
  evidence = { ok: true, projectId: project.id, threadId, runId, finalStatus: final.rawStatus, checks, ...(streaming ? { streamCursor, publicEvents: streamed.length } : {}), ...(phase === 'w08' ? { wireShapes } : {}), ...(phase === 'w11' ? { resumeRoundTrip } : {}), provenance: phase === 'w11' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning runs exercising W11 cancel/resume gating and a real workspace approvals file round trip; context-only isolated target, runtime guard path unchanged' : phase === 'w10' ? 'actual new API5284/PostgreSQL/LangGraph2400 planning run exercising the W10 thread selector feed alongside the W09 history fields; context-only isolated target, runtime guard path unchanged' : 'actual new API5284/PostgreSQL/LangGraph2400 planning run; context-only isolated target, runtime guard path unchanged; W09 history uses a controlled transcript state patch into the owned thread', ownedRuntimeFixtureRemoved: true }
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
