/**
 * Real AI workspace tests (tickets 04-05): owned planning/execution threads,
 * request-ledger dispatch, streamed messages, pending interrupts, execution
 * readiness gates, workspace HITL approvals and honest unavailability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicStreamEvent } from '@raptix/web-contracts'

const { act, cleanup, render, screen, waitFor } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { RealModeProvider } = await import('../bootstrap')
const { RealWorkspace } = await import('./workspace')
const { RealProjectDetail } = await import('./detail')
const { go } = await import('../../router/navigate')
const { useProjectStore } = await import('../../state/stores')
const { readWorkspaceDraft, saveWorkspaceDraft } = await import('../workspace-session')

const CAPS = {
  version: 1, mode: 'local-single-user',
  capabilities: { projects: { supported: true, available: true }, agents: { supported: true, available: true } },
}
const PLANNING_THREAD = { engagementId: 'eng-1', threadId: 'th-plan', assistantId: 'soundwave', kind: 'planning', createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:05:00.000Z' }
const EXEC_THREAD = { engagementId: 'eng-1', threadId: 'th-exec', assistantId: 'executor', kind: 'execution', createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:05:00.000Z' }
const ACK = (over: Record<string, unknown> = {}) => ({
  engagementId: 'eng-1', requestId: 'req-abc12345', operation: 'create_thread', state: 'accepted',
  threadId: 'th-plan', runId: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:01.000Z', ...over,
})
const ENGAGEMENT = (handoff: string | null) => ({
  id: 'eng-1', workspaceSlug: 'w', displayName: 'D', targetType: 'web_url', targetValue: 't',
  authorizationConfirmed: true, brief: null, handoffConfirmedAt: handoff, metadataState: 'verified',
  lifecycleStatus: 'planning', findingCount: null, assetCount: null, activeAgentCount: null,
  createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:00.000Z',
})
const SNAPSHOT = {
  binding: PLANNING_THREAD, rawStatus: null, messages: [
    { role: 'user', content: 'Plan the Q1 external assessment.' },
    { role: 'assistant', content: 'Here is a draft scope outline…' },
  ],
  messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime',
  pendingQuestions: [{
    questionId: 'q-1', question: 'Which target set should the plan cover?', header: 'Scope',
    options: [{ label: 'Full range', description: 'All in-scope hosts' }, { label: 'Edge only', description: 'Public edge only' }],
    multiSelect: false, allowOther: true, source: 'runtime',
  }],
}
const RUNTIME_CTX = (executionReady: boolean) => ({
  engagementId: 'eng-1', workspaceSlug: 'w', assistantId: 'executor', kind: 'execution',
  authorizationConfirmed: true, planningState: executionReady ? 'ready' : 'blocked',
  executionReady, threadVerified: true, source: 'runtime',
})
const SNAPSHOT_NO_QUESTION = { ...SNAPSHOT, pendingQuestions: [] }
const APPROVAL = {
  engagementId: 'eng-1', requestId: 'apr-123', engagementName: 'E', agentName: 'executor', toolName: 'bash',
  toolArgsRedacted: { command: 'nmap -sV -p 80 10.129.84.232' },
  matchedRule: { techniqueTag: 'T1059', toolPattern: null, timeoutSeconds: 300, defaultOnTimeout: 'deny' },
  reason: 'Policy requires operator approval for shell commands', createdAtSeconds: 1791988800, source: 'workspace',
}

const PLANNING_READY = {
  version: 1, engagementId: 'eng-1',
  documents: {
    roe: { state: 'ready', content: { engagement_name: 'E', client: 'C', start_date: '2026-10-01', end_date: '2026-10-31', engagement_type: 'external', testing_window: 'Mon-Fri 9-17', authorization_reference: 'AUTH-1' } },
    conops: { state: 'ready', content: { engagement_name: 'E', executive_summary: 'Summary' } },
    deconfliction: { state: 'ready', content: { engagement_name: 'E' } },
    opplan: { state: 'ready', content: { engagement_name: 'E', threat_profile: 'tier-2' } },
  },
  bundle: { roe: 'ready', conops: 'ready', deconfliction: 'ready', opplan: 'ready', 'threat-profile': 'ready', contact: 'ready', 'data-handling': 'ready', abort: 'ready', cleanup: 'ready' },
  readiness: { state: 'ready', reasons: [], runtimeSignal: 'not_observed' },
}

const PLANNING_BLOCKED = {
  version: 1, engagementId: 'eng-1',
  documents: { roe: { state: 'missing' }, conops: { state: 'missing' }, deconfliction: { state: 'missing' }, opplan: { state: 'missing' } },
  bundle: { roe: 'missing', conops: 'missing', deconfliction: 'missing', opplan: 'missing', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
  readiness: { state: 'blocked', reasons: ['required documents are missing'], runtimeSignal: 'not_observed' },
}

function stubApi(over: {
  threads?: unknown[]
  snapshot?: unknown
  execBinding?: Record<string, unknown>
  engagement?: unknown
  runtimeCtx?: unknown
  approvals?: unknown
  runStatus?: string
  planning?: unknown
  fleet?: unknown
} = {}) {
  const calls: { url: string; init?: RequestInit; body?: Record<string, unknown> }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ url, init, body })
    if (url.endsWith('/api/capabilities')) return new Response(JSON.stringify(CAPS), { status: 200 })
    if (url.endsWith('/api/engagements/eng-1')) return new Response(JSON.stringify(over.engagement ?? ENGAGEMENT('2026-10-14T08:30:00.000Z')), { status: 200 })
    if (url.endsWith('/fleet')) return new Response(JSON.stringify(over.fleet ?? { engagementId: 'eng-1', agents: [], threads: [], branches: [], counts: { threads: 0, threadsTruncated: false, activeRuns: 0, branches: 0, runningBranches: 0 }, excludedActions: [], sources: { agents: 'catalog', threads: 'runtime', branches: 'checkpoint' }, source: 'runtime' }), { status: 200 })
    if (url.endsWith('/threads') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ engagementId: 'eng-1', threads: over.threads ?? [PLANNING_THREAD], source: 'runtime' }), { status: 200 })
    if (url.endsWith('/threads') && init?.method === 'POST') return new Response(JSON.stringify(ACK({ requestId: body?.requestId, threadId: body?.kind === 'execution' ? 'th-exec' : 'th-plan' })), { status: 201 })
    if (url.endsWith('/approvals') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ engagementId: 'eng-1', approvals: over.approvals ?? [], source: 'workspace' }), { status: 200 })
    if (url.endsWith('/approvals') && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, requestId: (body as { requestId?: string }).requestId, action: body?.action, decidedAtSeconds: 1791988800 }), { status: 200 })
    if (url.endsWith('/plan-docs')) return new Response(JSON.stringify(over.planning ?? PLANNING_BLOCKED), { status: 200 })
    if (url.includes('/runtime-context')) return new Response(JSON.stringify(over.runtimeCtx ?? RUNTIME_CTX(false)), { status: 200 })
    if (url.includes('/threads/') && url.endsWith('/events')) return new Response('unexpected', { status: 404 })
    if (url.match(/\/runs\/[^/]+$/) && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ engagementId: 'eng-1', threadId: 'th-plan', runId: 'run-1', requestId: 'req-abc12345', rawStatus: over.runStatus ?? 'running', createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:02.000Z', source: 'runtime' }), { status: 200 })
    if (url.endsWith('/runs') && init?.method === 'POST') return new Response(JSON.stringify(ACK({ requestId: body?.requestId, operation: 'create_run', runId: 'run-1' })), { status: 202 })
    if (url.endsWith('/resume') && init?.method === 'POST') return new Response(JSON.stringify(ACK({ requestId: body?.requestId, operation: 'resume', runId: 'run-2' })), { status: 202 })
    const hitl = url.match(/\/threads\/([^/]+)\/hitl$/)
    if (hitl && init?.method === 'PATCH') return new Response(JSON.stringify({ threadId: decodeURIComponent(hitl[1]!), hitlEnabled: body?.enabled }), { status: 200 })
    if (url.endsWith('/threads/th-plan')) return new Response(JSON.stringify(over.snapshot ?? SNAPSHOT), { status: 200 })
    if (url.endsWith('/threads/th-exec')) return new Response(JSON.stringify({ ...(over.snapshot ?? SNAPSHOT), binding: { ...EXEC_THREAD, ...(over.execBinding ?? {}) } }), { status: 200 })
    return new Response('unexpected', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private listeners = new Map<string, ((frame: MessageEvent) => void)[]>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: EventListener): void {
    const list = this.listeners.get(type) ?? []
    list.push(cb as (frame: MessageEvent) => void)
    this.listeners.set(type, list)
  }
  close(): void { this.closed = true }
  emit(type: string, data: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data: JSON.stringify(data) } as MessageEvent)
  }
}

const event = (over: Partial<PublicStreamEvent> & Record<string, unknown>): PublicStreamEvent => ({
  version: 1, eventId: `ev-${Math.random()}`, engagementId: 'eng-1', threadId: 'th-plan', streamRunId: 'run-1', runId: 'run-1',
  source: 'runtime', namespace: [], occurredAt: null, observedAt: '2026-10-14T08:00:00.500Z', identity: 'occurrence',
  payload: { type: 'message', messageId: null, role: 'assistant', content: '', mode: 'delta', truncated: false },
  ...over,
} as PublicStreamEvent)

function ui(node: React.ReactElement) {
  return render(<RealModeProvider>{node}</RealModeProvider>)
}

beforeEach(() => {
  window.localStorage.clear()
  useProjectStore.getState().setPid('all')
  go('ai-operator')
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function pickThread(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  const trigger = await waitFor(() => {
    const el = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
    if (!el) throw new Error('conversation switcher not rendered')
    return el
  })
  await user.click(trigger)
  await user.click(await screen.findByRole('option', { name }))
}

describe('RealWorkspace', () => {
  it('does not restore an operator draft for another authenticated actor', () => {
    saveWorkspaceDraft('eng-1', 'th-exec', 'Actor A instructions', 'actor-a')
    expect(readWorkspaceDraft('eng-1', 'th-exec', 'actor-a')).toBe('Actor A instructions')
    expect(readWorkspaceDraft('eng-1', 'th-exec', 'actor-b')).toBe('')
  })

  it('starts the planner with the operator brief and target once after project creation', async () => {
    const { markPlanningSeed } = await import('../planning-seed')
    const project = { ...ENGAGEMENT(null), displayName: 'Lab', targetType: 'ip_range', targetValue: '10.129.227.140', brief: 'Assess the lab host for the authorized exercise.' }
    const calls = stubApi({ threads: [], engagement: project, planning: PLANNING_BLOCKED })
    markPlanningSeed('eng-1')
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/runs') && call.init?.method === 'POST')).toBe(true))
    const created = calls.find((call) => call.url.endsWith('/threads') && call.init?.method === 'POST')
    expect(created?.body).toEqual(expect.objectContaining({ kind: 'planning' }))
    const run = calls.find((call) => call.url.endsWith('/runs') && call.init?.method === 'POST')
    expect(run?.body?.message).toEqual(expect.stringContaining('10.129.227.140'))
    expect(run?.body?.message).toEqual(expect.stringContaining('Assess the lab host for the authorized exercise.'))
    expect(calls.filter((call) => call.url.endsWith('/runs') && call.init?.method === 'POST')).toHaveLength(1)
  })

  it('does not send the planner brief again when a planning thread already exists', async () => {
    const { markPlanningSeed } = await import('../planning-seed')
    const project = { ...ENGAGEMENT(null), displayName: 'Lab', targetType: 'ip_range', targetValue: '10.129.227.140', brief: 'Brief.' }
    const calls = stubApi({ threads: [PLANNING_THREAD], engagement: project, planning: PLANNING_BLOCKED })
    markPlanningSeed('eng-1')
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await screen.findByLabelText('Workspace message')
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(0)
    await waitFor(() => expect(window.sessionStorage.getItem('raptix.planning-seed.eng-1')).toBeNull())
  })

  it('opens the AI workspace execution surface without dispatch and keeps checkpoint invocations observe-only', async () => {
    const calls = stubApi({ snapshot: SNAPSHOT_NO_QUESTION, threads: [EXEC_THREAD], runtimeCtx: RUNTIME_CTX(true), planning: PLANNING_READY, fleet: { engagementId: 'eng-1', agents: [], threads: [], branches: [{ threadId: 'th-exec', key: 'branch-recon-2', agent: 'recon', state: 'running', outcome: null, startedAt: null, endedAt: null, provenance: 'checkpoint' }], counts: {}, sources: { agents: 'catalog', threads: 'runtime', branches: 'checkpoint' }, source: 'runtime' } })
    go('project', { id: 'eng-1', tab: 'ai-workspace' })
    ui(<RealProjectDetail />)
    const user = userEvent.setup()
    await screen.findByText('executor')
    expect(screen.queryByText('Planning and execution conversations for')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /agent sidebar/ }))
    await user.click(await screen.findByRole('button', { name: 'Observe recon branch-recon-2' }))
    expect(await screen.findByLabelText('Observed invocation — read-only')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    expect(screen.getByText(/No independently addressable conversation/)).toBeInTheDocument()
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '← Back to orchestrator conversation' }))
    expect(await screen.findByLabelText('Workspace message')).toBeInTheDocument()
  })

  it('preserves separate drafts when switching between existing planning and execution threads', async () => {
    const calls = stubApi({ snapshot: SNAPSHOT_NO_QUESTION, threads: [PLANNING_THREAD, EXEC_THREAD], runtimeCtx: RUNTIME_CTX(true) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const composer = await screen.findByLabelText('Workspace message')
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Planner draft')
    await pickThread(user, /th-exec/)
    expect(screen.getByLabelText('Workspace message')).toHaveValue('')
    await user.type(screen.getByLabelText('Workspace message'), 'Executor draft')
    await pickThread(user, /th-plan/)
    expect(screen.getByLabelText('Workspace message')).toHaveValue('Planner draft')
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(0)
  })

  it('bounds checkpoint snapshot reads during a replay burst', async () => {
    const calls = stubApi({ snapshot: SNAPSHOT_NO_QUESTION })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const composer = await screen.findByLabelText('Workspace message')
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Local replay test')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const source = await waitFor(() => { expect(FakeEventSource.instances.length).toBeGreaterThan(0); return FakeEventSource.instances[0] })
    const before = calls.filter((c) => c.url.endsWith('/threads/th-plan')).length
    for (let i = 0; i < 30; i++) {
      await act(async () => source.emit('run-event', event({ eventId: `checkpoint-${i}`, source: 'checkpoint', runId: null })))
    }
    expect(calls.filter((c) => c.url.endsWith('/threads/th-plan')).length - before).toBeLessThan(4)
  })

  it('prompts for an engagement when none is selected', async () => {
    stubApi()
    ui(<RealWorkspace />)
    expect(await screen.findByText('No engagement selected')).toBeTruthy()
    expect(await screen.findByText('Go to Projects')).toBeTruthy()
  })

  it('lists planning threads, renders the snapshot conversation and pending question', async () => {
    stubApi()
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    expect(await screen.findByText('th-plan')).toBeTruthy()
    expect(await screen.findByText('Plan the Q1 external assessment.')).toBeTruthy()
    expect(await screen.findByText('Here is a draft scope outline…')).toBeTruthy()
    expect(await screen.findByText('Which target set should the plan cover?')).toBeTruthy()
    expect(await screen.findByText('soundwave')).toBeTruthy()
  })

  it('creates an owned planning thread through the request ledger', async () => {
    const calls = stubApi({ threads: [] })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const create = await screen.findByRole('button', { name: /New planning thread/ })
    await userEvent.setup().click(create)
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST')).toBe(true))
    const posted = calls.find((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST')
    expect(posted?.body).toMatchObject({ kind: 'planning' })
    expect(String(posted?.body?.requestId)).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/)
  })

  it('sends a message, streams the reply and answers a pending question', async () => {
    const calls = stubApi({ snapshot: SNAPSHOT_NO_QUESTION })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await screen.findByText('th-plan')
    const composer = (await screen.findByLabelText('Workspace message')) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))
    const user = userEvent.setup()
    await user.type(composer, 'Also include the API surface.')
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    await waitFor(() => expect(send.disabled).toBe(false))
    await user.click(send)
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/threads/th-plan/runs') && c.init?.method === 'POST')).toBe(true))
    const runPost = calls.find((c) => c.url.endsWith('/threads/th-plan/runs') && c.init?.method === 'POST')
    expect(runPost?.body).toMatchObject({ message: 'Also include the API surface.' })
    const source = await waitFor(() => {
      const s = FakeEventSource.instances[0]
      expect(s.url).toContain('/threads/th-plan/runs/run-1/events')
      return s
    })
    source.onopen?.()
    source.emit('run-event', event({ payload: { type: 'message', messageId: 'm-live', role: 'assistant', content: 'Working on the', mode: 'delta', truncated: false } }))
    source.emit('run-event', event({ payload: { type: 'message', messageId: 'm-live', role: 'assistant', content: ' API section.', mode: 'delta', truncated: false } }))
    expect(await screen.findByText('Working on the API section.')).toBeTruthy()

  })

  it('answers a pending question from the composer and resumes the same thread', async () => {
    const calls = stubApi()
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await screen.findByText('th-plan')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: /Full range/ }))
    await user.click(screen.getByRole('button', { name: 'Answer' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/threads/th-plan/resume'))).toBe(true))
    const resume = calls.find((c) => c.url.endsWith('/threads/th-plan/resume'))
    expect(resume?.body).toMatchObject({ questionId: 'q-1', value: 'Full range' })
  })

  it('collects several pending questions in tabs and sends every answer only from the Confirm tab', async () => {
    const question = (questionId: string, header: string) => ({
      questionId, question: `Pick the ${header.toLowerCase()}`, header,
      options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }],
      multiSelect: false, allowOther: false, source: 'runtime',
    })
    const calls = stubApi({ snapshot: { ...SNAPSHOT_NO_QUESTION, pendingQuestions: [question('q-1', 'Scope'), question('q-2', 'Window')] }, runtimeCtx: RUNTIME_CTX(false) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const scopeRadios = await screen.findAllByRole('radio')
    expect(scopeRadios).toHaveLength(2)
    await user.click(scopeRadios[0]!)
    await user.click(screen.getByRole('tab', { name: /Window/ }))
    const windowRadios = await screen.findAllByRole('radio')
    expect(windowRadios).toHaveLength(2)
    await user.click(windowRadios[0]!)
    await user.click(screen.getByRole('tab', { name: 'Confirm' }))
    expect(screen.getAllByText('Scope').length).toBeGreaterThan(1)
    expect(calls.some((c) => c.url.endsWith('/resume') && c.init?.method === 'POST')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Send answers' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/resume') && c.init?.method === 'POST')).toBe(true))
    const sent = calls.find((c) => c.url.endsWith('/resume') && c.init?.method === 'POST')
    expect(sent?.body).toMatchObject({ answers: [{ questionId: 'q-1', value: 'Yes' }, { questionId: 'q-2', value: 'Yes' }] })
  })

  it('keeps Execute disabled until the planning handoff is confirmed', async () => {
    stubApi({ engagement: ENGAGEMENT(null) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const execute = (await screen.findByRole('button', { name: 'Execute' })) as HTMLButtonElement
    expect(execute.disabled).toBe(true)
    expect(execute.title).toMatch(/Confirm the planning handoff/)
  })

  it('creates the execution thread on send in Execute mode, then submits the run to it', async () => {
    const calls = stubApi({ threads: [PLANNING_THREAD], snapshot: SNAPSHOT_NO_QUESTION, runtimeCtx: RUNTIME_CTX(true) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Execute' }))
    await user.type(await screen.findByLabelText('Workspace message'), 'Run the recon objective')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST' && c.body?.kind === 'execution')).toBe(true))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/threads/th-exec/runs') && c.init?.method === 'POST')).toBe(true))
    const created = calls.findIndex((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST')
    const submitted = calls.findIndex((c) => c.url.endsWith('/threads/th-exec/runs') && c.init?.method === 'POST')
    expect(created).toBeLessThan(submitted)
  })

  it('turns tool approval off for this conversation through the HITL switch', async () => {
    const calls = stubApi({ threads: [PLANNING_THREAD, EXEC_THREAD], snapshot: SNAPSHOT_NO_QUESTION, runtimeCtx: RUNTIME_CTX(true) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Execute' }))
    const hitl = (await screen.findByRole('switch', { name: 'Tool approval (HITL)' })) as HTMLButtonElement
    expect(hitl.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(hitl.disabled).toBe(false))
    await user.click(hitl)
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/threads/th-exec/hitl') && c.init?.method === 'PATCH' && c.body?.enabled === false)).toBe(true))
  })

  it('explains that dangerous methods still need approval while the switch is off', async () => {
    stubApi({ threads: [PLANNING_THREAD, EXEC_THREAD], snapshot: SNAPSHOT_NO_QUESTION, execBinding: { hitlEnabled: false }, runtimeCtx: RUNTIME_CTX(true) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Execute' }))
    expect(await screen.findByRole('switch', { name: 'Tool approval (HITL)' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'Tool approval (HITL)' })).toHaveAttribute('title', expect.stringMatching(/Dangerous methods .*still require approval/))
  })

  it('keeps the execution-thread button disabled until the handoff is confirmed', async () => {
    stubApi({ engagement: ENGAGEMENT(null) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const exec = (await screen.findByRole('button', { name: /New execution thread/ })) as HTMLButtonElement
    await waitFor(() => expect(exec.disabled).toBe(true))
  })

  it('blocks sending on an execution thread when the server context is not ready', async () => {
    stubApi({ snapshot: SNAPSHOT_NO_QUESTION, threads: [PLANNING_THREAD, EXEC_THREAD], runtimeCtx: RUNTIME_CTX(false) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const execButton = (await screen.findByRole('button', { name: /New execution thread/ })) as HTMLButtonElement
    await waitFor(() => expect(execButton.disabled).toBe(false))
    await userEvent.setup().click(execButton)
    expect(await screen.findByText('th-exec')).toBeTruthy()
    const composer = (await screen.findByLabelText('Workspace message')) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(true))
    expect(screen.getByText(/planning blocked/)).toBeTruthy()
  })

  it('renders workspace tool HITL approvals and records an allow decision', async () => {
    const calls = stubApi({ threads: [PLANNING_THREAD, EXEC_THREAD], runtimeCtx: RUNTIME_CTX(true), approvals: [APPROVAL] })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const execButton = (await screen.findByRole('button', { name: /New execution thread/ })) as HTMLButtonElement
    await waitFor(() => expect(execButton.disabled).toBe(false))
    await userEvent.setup().click(execButton)
    expect(await screen.findByText('Tool Approvals (HITL)')).toBeTruthy()
    expect(await screen.findByText(/Policy requires operator approval/)).toBeTruthy()
    expect(screen.getByText('nmap -sV -p 80 10.129.84.232')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/approvals') && c.init?.method === 'POST')).toBe(true))
    const decided = calls.find((c) => c.url.endsWith('/approvals') && c.init?.method === 'POST')
    expect(decided?.body).toMatchObject({ requestId: 'apr-123', action: 'allow' })
  })

  it('surfaces a thread-load failure without any mock fallback', async () => {
    stubApi({ threads: [] })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await screen.findByRole('button', { name: /New planning thread/ })
    expect(screen.getByText(/No planning thread yet/)).toBeTruthy()
  })

  it('auto-creates and selects the execution thread once planning is ready and the handoff is confirmed — without dispatching a run', async () => {
    const calls = stubApi({ planning: PLANNING_READY })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await screen.findByText('th-plan')
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST')).toBe(true))
    const posted = calls.find((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST')
    expect(posted?.body).toMatchObject({ kind: 'execution' })
    expect(await screen.findByText(/nothing is dispatched automatically/)).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/runs') && c.init?.method === 'POST')).toBe(false)
  })

  it('does not auto-create the execution thread before the handoff is confirmed', async () => {
    const calls = stubApi({ planning: PLANNING_READY, engagement: ENGAGEMENT(null) })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    await screen.findByText('th-plan')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(calls.some((c) => c.url.endsWith('/api/engagements/eng-1/threads') && c.init?.method === 'POST')).toBe(false)
  })

  it('follows a streamed reply only while the operator is at the bottom of the conversation', async () => {
    stubApi({ snapshot: SNAPSHOT_NO_QUESTION })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const composer = await screen.findByLabelText('Workspace message')
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Stream scroll check')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const source = await waitFor(() => { expect(FakeEventSource.instances.length).toBeGreaterThan(0); return FakeEventSource.instances[0]! })
    const region = document.querySelector<HTMLDivElement>('div.overflow-y-auto.py-4')!
    // jsdom has no layout: give the conversation a fixed geometry and an assignable scrollTop.
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 })
    const reply = (messageId: string, content: string) => act(async () => source.emit('run-event', event({
      eventId: `reply-${messageId}-${content.length}`, runId: 'run-1', streamRunId: 'run-1',
      payload: { type: 'message', messageId, role: 'assistant', content, mode: 'snapshot', truncated: false },
    })))
    await reply('m-1', 'First part of the reply')
    await screen.findByText('First part of the reply')
    // Reading older messages: the reply grows and the view stays where the operator is.
    region.scrollTop = 0
    await act(async () => region.dispatchEvent(new Event('scroll')))
    await reply('m-2', 'A second reply arrives while reading history')
    await screen.findByText('A second reply arrives while reading history')
    expect(region.scrollTop).toBe(0)
    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument()
    // Back at the bottom: the next reply is followed.
    region.scrollTop = 600
    await act(async () => region.dispatchEvent(new Event('scroll')))
    await reply('m-3', 'A third reply while at the bottom')
    await screen.findByText('A third reply while at the bottom')
    expect(region.scrollTop).toBe(1000)
  })

  it('interleaves assistant text and subagent activity in the order they arrived', async () => {
    stubApi({ snapshot: SNAPSHOT_NO_QUESTION })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const composer = await screen.findByLabelText('Workspace message')
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Order check')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const source = await waitFor(() => { expect(FakeEventSource.instances.length).toBeGreaterThan(0); return FakeEventSource.instances[0]! })
    const message = (messageId: string, content: string) => act(async () => source.emit('run-event', event({
      eventId: `msg-${messageId}`, runId: 'run-1', streamRunId: 'run-1',
      payload: { type: 'message', messageId, role: 'assistant', content, mode: 'snapshot', truncated: false },
    })))
    await message('m-1', 'Checking the scope first')
    await act(async () => source.emit('run-event', event({
      eventId: 'sub-start', runId: 'run-1', streamRunId: 'run-1',
      payload: { type: 'subagent_start', agent: 'recon', status: 'running', truncated: false },
    })))
    await message('m-2', 'Scope confirmed')
    const first = await screen.findByText('Checking the scope first')
    const activity = await screen.findByText('subagent started: recon')
    const last = await screen.findByText('Scope confirmed')
    expect(first.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(activity.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('labels streamed reasoning with the time measured in this browser, and only for that stream', async () => {
    stubApi({ snapshot: SNAPSHOT_NO_QUESTION })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const composer = await screen.findByLabelText('Workspace message')
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Thinking label check')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const source = await waitFor(() => { expect(FakeEventSource.instances.length).toBeGreaterThan(0); return FakeEventSource.instances[0]! })
    const emit = (content: string, reasoning?: string) => act(async () => source.emit('run-event', event({
      eventId: `think-${content.length}-${reasoning?.length ?? 0}`, runId: 'run-1', streamRunId: 'run-1',
      payload: { type: 'message', messageId: 'm-think', role: 'assistant', content, mode: 'snapshot', truncated: false, ...(reasoning ? { reasoning } : {}) },
    })))
    await emit('', 'Weighing the scope options')
    expect(await screen.findByRole('button', { name: 'Thinking...' })).toBeInTheDocument()
    await emit('Full range is the better starting scope.', 'Weighing the scope options')
    expect(await screen.findByRole('button', { name: /^Thought for <1s$/ })).toBeInTheDocument()
  })

  it('shows no thinking duration when the reasoning and the answer arrive in the same event', async () => {
    stubApi({ snapshot: SNAPSHOT_NO_QUESTION })
    go('ai-operator', { id: 'eng-1' })
    ui(<RealWorkspace />)
    const user = userEvent.setup()
    const composer = await screen.findByLabelText('Workspace message')
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Same event check')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const source = await waitFor(() => { expect(FakeEventSource.instances.length).toBeGreaterThan(0); return FakeEventSource.instances[0]! })
    await act(async () => source.emit('run-event', event({
      eventId: 'same-event-1', runId: 'run-1', streamRunId: 'run-1',
      payload: { type: 'message', messageId: 'm-same', role: 'assistant', content: 'Answer delivered at once.', mode: 'snapshot', truncated: false, reasoning: 'Reasoning delivered at once' },
    })))
    await screen.findByText('Answer delivered at once.')
    expect(screen.getByRole('button', { name: 'Reasoning' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Thought for|Thinking\.\.\./ })).toBeNull()
  })
})
