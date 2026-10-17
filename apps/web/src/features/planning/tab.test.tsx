/**
 * Planning tab (real mode) through the real planning adapter and the transport:
 * documents and readiness, the OPPLAN beside them, the one-way handoff, and the
 * O06 draft editor with its digest precondition and its 409 conflict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

vi.mock('../../real/mode', () => ({ DATA_MODE: 'real', isRealMode: () => true, resolveDataMode: () => 'real' }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

const { cleanup, render, screen, waitFor, within } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealFeatureServicesCtx } = await import('../../real/service-adapter/provider')
const { createRealFeatureServices } = await import('../../real/service-adapter/index')
const { PlanningTab } = await import('./tab')

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { planning: { supported: true, available: true } } } as never

const ROE = { state: 'ready', content: { engagement_name: 'E', client: 'Acme', start_date: '2026-10-01', end_date: '2026-10-31', engagement_type: 'external', testing_window: '09:00-17:00', authorization_reference: 'AUTH-7', in_scope: [{ target: '10.0.0.0/24', type: 'cidr' }], out_of_scope: [], prohibited_actions: ['DoS'] } }
const CONOPS = { state: 'ready', content: { engagement_name: 'E', executive_summary: 'External assessment of the perimeter.', success_criteria: ['Access demonstrated'] } }
const VIEW = (over: Record<string, unknown> = {}) => ({
  version: 1, engagementId: 'eng-1',
  documents: { roe: ROE, conops: CONOPS, deconfliction: { state: 'missing' }, opplan: { state: 'invalid' } },
  bundle: { roe: 'ready', conops: 'ready', deconfliction: 'missing', opplan: 'invalid', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
  readiness: { state: 'blocked', reasons: ['deconfliction: missing', 'opplan: invalid'], runtimeSignal: 'not_observed' },
  ...over,
})

const PROJECT = { id: 'eng-1', workspaceSlug: 'w', displayName: 'D', targetType: 'web_url', targetValue: 't', authorizationConfirmed: true, brief: null, handoffConfirmedAt: '2026-10-14T10:00:00.000Z', metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z' }

function stubApi(view: unknown, respond?: (url: string, init: RequestInit | undefined) => Response | undefined) {
  const calls: { url: string; init?: RequestInit; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const custom = respond?.(url, init)
    if (custom) return custom
    if (url.endsWith('/plan-docs')) return new Response(JSON.stringify(view), { status: 200 })
    if (url === '/api/engagements/eng-1' && init?.method === 'PATCH') return new Response(JSON.stringify(PROJECT), { status: 200 })
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderTab(props: { handoffConfirmedAt: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
    </QueryClientProvider>
  )
  return render(<PlanningTab engagementId="eng-1" handoffConfirmedAt={props.handoffConfirmedAt} />, { wrapper })
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PlanningTab (real)', () => {
  it('shows blocked readiness with the server reasons in plain words and honest document states', async () => {
    stubApi(VIEW())
    renderTab({ handoffConfirmedAt: null })
    expect(await screen.findByText('Planning is blocked')).toBeTruthy()
    expect(screen.getByText('Deconfliction is not drafted yet.')).toBeTruthy()
    expect(screen.getByText('Operation Plan (OPPLAN) fails schema validation.')).toBeTruthy()
    expect((await screen.findByTestId('plan-doc-roe')).textContent).toContain('external')
    expect(screen.getByTestId('plan-doc-deconfliction').textContent).toContain('not been generated yet')
    expect(screen.getByTestId('plan-doc-opplan').textContent).toContain('failed validation')
    expect(screen.queryByText('opplan: Invalid')).toBeNull()
  })

  it('shows OPPLAN in full beside the plan documents and keeps it out of the handoff bundle', async () => {
    const opplan = { state: 'ready', content: { engagement_name: 'E', threat_profile: 'external-web-app-pentester', objectives: [
      { id: 'OBJ-001', title: 'Enumerate the attack surface', description: 'Map pages and APIs.', phase: 'recon', status: 'completed' },
      { id: 'OBJ-002', title: 'Exploit the admin endpoint', description: 'Verify the authz flaw.', phase: 'initial-access', status: 'pending', blocked_by: ['OBJ-001'] },
    ] } }
    stubApi(VIEW({
      documents: { roe: ROE, conops: CONOPS, deconfliction: { state: 'missing' }, opplan },
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'missing', opplan: 'ready', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
    }))
    renderTab({ handoffConfirmedAt: null })
    const card = await screen.findByTestId('plan-doc-opplan')
    expect(within(card).getByText('Exploit the admin endpoint')).toBeTruthy()
    expect(within(card).getByText('Enumerate the attack surface').closest('tr')?.textContent).toContain('completed')
    expect(within(card).getByText('Exploit the admin endpoint').closest('tr')?.textContent).toContain('OBJ-001')
    const planDocumentGrid = screen.getByTestId('plan-doc-roe').parentElement as HTMLElement
    expect(planDocumentGrid.contains(card)).toBe(false)
    expect(screen.queryByText('opplan: ready')).toBeNull()
  })

  it('gives every PREPARE document a reviewable card, not only a bundle chip', async () => {
    stubApi(VIEW({
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'missing', opplan: 'invalid', 'threat-profile': 'ready', contact: 'ready', 'data-handling': 'ready', abort: 'ready', cleanup: 'missing' },
    }))
    renderTab({ handoffConfirmedAt: null })
    const threat = await screen.findByTestId('plan-doc-threat-profile')
    expect(within(threat).getByRole('button', { name: 'View source & draft' })).toBeTruthy()
    expect(within(screen.getByTestId('plan-doc-contact')).getByRole('button', { name: 'View source & draft' })).toBeTruthy()
    expect(within(screen.getByTestId('plan-doc-cleanup')).getByRole('button', { name: 'Draft this document' })).toBeTruthy()
  })

  it('shows the schema errors of a stored document that fails validation on its card', async () => {
    const error = "/ must have required property 'threat_profile'"
    stubApi(VIEW(), (url) => {
      if (url.endsWith('/documents/opplan')) {
        return new Response(JSON.stringify({ version: 1, engagementId: 'eng-1', name: 'opplan', state: 'invalid', digest: 'b'.repeat(64), updatedAt: '2026-10-16T09:00:00.000Z', sizeBytes: 2, source: '{}', validation: { valid: false, errors: [error] }, readable: null, draft: null }), { status: 200 })
      }
      return undefined
    })
    renderTab({ handoffConfirmedAt: null })
    const card = await screen.findByTestId('plan-doc-opplan')
    expect(await within(card).findByText(error)).toBeTruthy()
  })

  it('confirms the planning handoff with the one-way PATCH', async () => {
    const calls = stubApi(VIEW({
      documents: { roe: ROE, conops: CONOPS, deconfliction: { state: 'ready', content: { engagement_name: 'E' } }, opplan: { state: 'missing' } },
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'ready', opplan: 'missing', 'threat-profile': 'ready', contact: 'ready', 'data-handling': 'ready', abort: 'ready', cleanup: 'ready' },
      readiness: { state: 'ready', reasons: [], runtimeSignal: 'not_observed' },
    }))
    renderTab({ handoffConfirmedAt: null })
    const confirm = await screen.findByRole('button', { name: /Confirm planning handoff/ })
    await userEvent.setup().click(confirm)
    await waitFor(() => expect(calls.some((c) => c.url === '/api/engagements/eng-1' && c.init?.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch?.body).toEqual({ handoffConfirmed: true })
  })

  it('keeps the handoff disabled while required documents are missing', async () => {
    stubApi(VIEW())
    renderTab({ handoffConfirmedAt: null })
    expect(await screen.findByRole('button', { name: 'Confirm planning handoff' })).toBeDisabled()
  })

  it('shows a confirmed handoff without offering the button again', async () => {
    stubApi(VIEW())
    renderTab({ handoffConfirmedAt: '2026-10-14T09:00:00.000Z' })
    await screen.findByText(/Confirmed at 2026-10-14 09:00/)
    expect(screen.queryByRole('button', { name: /Confirm planning handoff/ })).toBeNull()
  })

  it('surfaces a planning-load failure with retry and no mock fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    renderTab({ handoffConfirmedAt: null })
    expect(await screen.findByText('Could not load planning documents')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('PlanningTab document editor (O06)', () => {
  const SOURCE = JSON.stringify({ engagement_name: 'E', executive_summary: 'External assessment of the perimeter.' })
  const DIGEST = 'a'.repeat(64)
  const docSource = (over: Record<string, unknown> = {}) => ({
    version: 1, engagementId: 'eng-1', name: 'conops', state: 'ready',
    digest: DIGEST, updatedAt: '2026-10-16T09:00:00.000Z', sizeBytes: SOURCE.length,
    source: SOURCE, validation: { valid: true, errors: [] }, readable: { engagement_name: 'E' }, draft: null,
    ...over,
  })

  function stubEditorApi(doc: unknown, respond: (url: string, init: RequestInit | undefined) => Response) {
    return stubApi(VIEW(), (url, init) => {
      if (url.endsWith('/documents/conops') && (init?.method === undefined || init.method === 'GET')) return new Response(JSON.stringify(doc), { status: 200 })
      if (url.endsWith('/plan-docs')) return undefined
      return respond(url, init)
    })
  }

  async function openConopsEditor() {
    renderTab({ handoffConfirmedAt: null })
    const card = await screen.findByTestId('plan-doc-conops')
    await userEvent.setup().click(within(card).getByRole('button', { name: 'View source & draft' }))
    return await screen.findByTestId('document-editor-conops')
  }

  it('opens the editor from a ready card, prefills the source and saves a server-side draft', async () => {
    const calls = stubEditorApi(docSource(), (_url, init) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify(docSource({ draft: { body: SOURCE, baseDigest: DIGEST, updatedBy: 'u1', updatedAt: '2026-10-16T09:05:00.000Z' } })), { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    })
    const editor = await openConopsEditor()
    const textarea = within(editor).getByLabelText('Concept of Operations draft') as HTMLTextAreaElement
    expect(textarea.value).toBe(SOURCE)
    await userEvent.setup().type(textarea, ' ')
    await userEvent.setup().click(within(editor).getByRole('button', { name: 'Save draft' }))
    await screen.findByText(/Draft saved server-side/)
    const put = calls.find((c) => c.init?.method === 'PUT')
    expect(put?.body).toEqual({ body: `${SOURCE} `, baseDigest: DIGEST })
  })

  it('publishes with the digest precondition and surfaces a 409 conflict without clobbering', async () => {
    const calls = stubEditorApi(docSource(), (_url, init) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ error: { code: 'conflict', message: 'The document changed after this draft was loaded (current digest bb12); reload the document and reapply your edit.' } }), { status: 409 })
      return new Response('unexpected', { status: 404 })
    })
    const editor = await openConopsEditor()
    await userEvent.setup().click(within(editor).getByRole('button', { name: 'Publish to workspace' }))
    await screen.findByText(/changed after this draft was loaded/)
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post?.url).toContain('/documents/conops/publish')
    expect(post?.body).toEqual({ body: SOURCE, baseDigest: DIGEST })
    expect(within(editor).queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })

  it('hides publishing for ROE and points at the Scope & ROE workflow', async () => {
    stubApi(VIEW(), (url, init) => {
      if (url.endsWith('/documents/roe') && (init?.method === undefined || init.method === 'GET')) return new Response(JSON.stringify(docSource({ name: 'roe' })), { status: 200 })
      return undefined
    })
    renderTab({ handoffConfirmedAt: null })
    const card = await screen.findByTestId('plan-doc-roe')
    await userEvent.setup().click(within(card).getByRole('button', { name: 'View source & draft' }))
    const editor = await screen.findByTestId('document-editor-roe')
    expect(within(editor).queryByRole('button', { name: 'Publish to workspace' })).toBeNull()
    expect(editor.textContent).toContain('Scope & ROE revision workflow')
  })
})
