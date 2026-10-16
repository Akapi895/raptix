/** Real planning panel tests (ticket 04): documents, readiness, one-way handoff. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanup, render, screen, waitFor, within } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealPlanningPanel } = await import('./planning-panel')

const ROE = { state: 'ready', content: { engagement_name: 'E', client: 'Acme', start_date: '2026-10-01', end_date: '2026-10-31', engagement_type: 'external', testing_window: '09:00-17:00', authorization_reference: 'AUTH-7', in_scope: [{ target: '10.0.0.0/24', type: 'cidr' }], out_of_scope: [], prohibited_actions: ['DoS'] } }
const CONOPS = { state: 'ready', content: { engagement_name: 'E', executive_summary: 'External assessment of the perimeter.', success_criteria: ['Access demonstrated'] } }
const DECON = { state: 'missing' }
const OPPLAN = { state: 'invalid' }
const VIEW = (over: Record<string, unknown> = {}) => ({
  version: 1, engagementId: 'eng-1',
  documents: { roe: ROE, conops: CONOPS, deconfliction: DECON, opplan: OPPLAN },
  bundle: { roe: 'ready', conops: 'ready', deconfliction: 'missing', opplan: 'invalid', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
  readiness: { state: 'blocked', reasons: ['deconfliction: missing', 'opplan: invalid'], runtimeSignal: 'not_observed' },
  ...over,
})

function stubApi(view: unknown, patchStatus = 200) {
  const calls: { url: string; init?: RequestInit; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    if (url.endsWith('/plan-docs')) return new Response(JSON.stringify(view), { status: 200 })
    if (url === '/api/engagements/eng-1' && init?.method === 'PATCH') return new Response(JSON.stringify({ id: 'eng-1', workspaceSlug: 'w', displayName: 'D', targetType: 'web_url', targetValue: 't', authorizationConfirmed: true, brief: null, handoffConfirmedAt: '2026-10-14T10:00:00.000Z', metadataState: 'verified', lifecycleStatus: 'planning', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z' }), { status: patchStatus })
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderPanel(props: { engagementId: string; handoffConfirmedAt: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RealPlanningPanel {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RealPlanningPanel', () => {
  it('shows blocked readiness with the server reasons and honest document states', async () => {
    stubApi(VIEW())
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    expect(await screen.findByText('Planning is blocked')).toBeTruthy()
    expect(screen.getByText('deconfliction: missing')).toBeTruthy()
    expect(screen.getByText('opplan: invalid')).toBeTruthy()
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
      documents: { roe: ROE, conops: CONOPS, deconfliction: DECON, opplan },
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'missing', opplan: 'ready', 'threat-profile': 'missing', contact: 'missing', 'data-handling': 'missing', abort: 'missing', cleanup: 'missing' },
    }))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
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
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    const threat = await screen.findByTestId('plan-doc-threat-profile')
    expect(within(threat).getByRole('button', { name: 'View source & draft' })).toBeTruthy()
    expect(within(screen.getByTestId('plan-doc-contact')).getByRole('button', { name: 'View source & draft' })).toBeTruthy()
    expect(within(screen.getByTestId('plan-doc-cleanup')).getByRole('button', { name: 'Draft this document' })).toBeTruthy()
  })

  it('shows the schema errors of a stored document that fails validation on its card', async () => {
    const error = "/ must have required property 'threat_profile'"
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/plan-docs')) return new Response(JSON.stringify(VIEW()), { status: 200 })
      if (url.endsWith('/documents/opplan')) {
        return new Response(JSON.stringify({ version: 1, engagementId: 'eng-1', name: 'opplan', state: 'invalid', digest: 'b'.repeat(64), updatedAt: '2026-10-16T09:00:00.000Z', sizeBytes: 2, source: '{}', validation: { valid: false, errors: [error] }, readable: null, draft: null }), { status: 200 })
      }
      return new Response('unexpected', { status: 404 })
    }))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    const card = await screen.findByTestId('plan-doc-opplan')
    expect(await within(card).findByText(error)).toBeTruthy()
  })

  it('confirms the planning handoff with the one-way PATCH', async () => {
    const calls = stubApi(VIEW({
      documents: { roe: ROE, conops: CONOPS, deconfliction: { state: 'ready', content: { engagement_name: 'E' } }, opplan: { state: 'missing' } },
      bundle: { roe: 'ready', conops: 'ready', deconfliction: 'ready', opplan: 'missing', 'threat-profile': 'ready', contact: 'ready', 'data-handling': 'ready', abort: 'ready', cleanup: 'ready' },
      readiness: { state: 'ready', reasons: [], runtimeSignal: 'not_observed' },
    }))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    const confirm = await screen.findByRole('button', { name: /Confirm planning handoff/ })
    await userEvent.setup().click(confirm)
    await waitFor(() => expect(calls.some((c) => c.url === '/api/engagements/eng-1' && c.init?.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch?.body).toEqual({ handoffConfirmed: true })
  })

  it('shows a confirmed handoff without offering the button again', async () => {
    stubApi(VIEW())
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: '2026-10-14T09:00:00.000Z' })
    await screen.findByText(/Confirmed at 2026-10-14 09:00/)
    expect(screen.queryByRole('button', { name: /Confirm planning handoff/ })).toBeNull()
  })

  it('surfaces a planning-load failure with retry and no mock fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    expect(await screen.findByText('Could not load planning documents')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('RealPlanningPanel document editor (O06)', () => {
  const SOURCE = JSON.stringify({ engagement_name: 'E', executive_summary: 'External assessment of the perimeter.' })
  const DIGEST = 'a'.repeat(64)
  const docSource = (over: Record<string, unknown> = {}) => ({
    version: 1, engagementId: 'eng-1', name: 'conops', state: 'ready',
    digest: DIGEST, updatedAt: '2026-10-16T09:00:00.000Z', sizeBytes: SOURCE.length,
    source: SOURCE, validation: { valid: true, errors: [] }, readable: { engagement_name: 'E' }, draft: null,
    ...over,
  })

  function stubEditorApi(doc: unknown, respond: (url: string, init: RequestInit | undefined) => Response) {
    const calls: { url: string; init?: RequestInit; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
      if (url.endsWith('/plan-docs')) return new Response(JSON.stringify(VIEW()), { status: 200 })
      if (url.endsWith('/documents/conops') && (init?.method === undefined || init.method === 'GET')) return new Response(JSON.stringify(doc), { status: 200 })
      return respond(url, init)
    }))
    return calls
  }

  async function openConopsEditor() {
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
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
    await openConopsEditor()
    const editor = screen.getByTestId('document-editor-conops')
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
    await openConopsEditor()
    const editor = screen.getByTestId('document-editor-conops')
    await userEvent.setup().click(within(editor).getByRole('button', { name: 'Publish to workspace' }))
    await screen.findByText(/changed after this draft was loaded/)
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post?.url).toContain('/documents/conops/publish')
    expect(post?.body).toEqual({ body: SOURCE, baseDigest: DIGEST })
    expect(within(editor).queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })

  it('hides publishing for ROE and points at the Scope & ROE workflow', async () => {
    stubEditorApi(docSource({ name: 'roe' }), () => new Response('unexpected', { status: 404 }))
    renderPanel({ engagementId: 'eng-1', handoffConfirmedAt: null })
    const card = await screen.findByTestId('plan-doc-roe')
    await userEvent.setup().click(within(card).getByRole('button', { name: 'View source & draft' }))
    const editor = await screen.findByTestId('document-editor-roe')
    expect(within(editor).queryByRole('button', { name: 'Publish to workspace' })).toBeNull()
    expect(editor.textContent).toContain('Scope & ROE revision workflow')
  })
})