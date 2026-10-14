/** Real findings + evidence tests (ticket 06): parser honesty, inventory, inspector, empty states. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanup, render, screen } = await import('@testing-library/react')
const userEvent = (await import('@testing-library/user-event')).default
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { RealFindingsPanel } = await import('./findings-panel')

const FINDING = {
  engagementId: 'eng-1', id: 'FIND-001', title: 'SQL injection on login', severity: 'high',
  description: 'The login endpoint is injectable.', evidence: 'POST /login?user=admin',
  attackVector: 'network', affectedAssets: ['10.0.0.5'],
  cvssScore: 8.6, cvssVector: 'CVSS:3.1/AV:N', cwe: ['CWE-89'], mitre: ['T1190'],
  remediation: 'Use parameterized queries.',
  quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
  rawSource: 'FIND-001 full markdown source...', sizeBytes: 512, source: 'workspace',
}
const FLAGGED = { ...FINDING, id: 'FIND-002', title: 'Placeholder finding', severity: 'informational', quality: { defaultSeverity: true, placeholderDescription: true, placeholderEvidence: false, unreadable: false } }
const FOLDERS = [{ folder: 'findings', files: [{ name: 'FIND-001.md', path: 'findings/FIND-001.md', sizeBytes: 512 }] }]

function stubApi(over: { findings?: unknown[]; truncated?: boolean; folders?: unknown; content?: unknown; contentStatus?: number } = {}) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/findings')) return new Response(JSON.stringify({ engagementId: 'eng-1', findings: over.findings ?? [FINDING, FLAGGED], truncated: over.truncated ?? false, source: 'workspace' }), { status: 200 })
    if (url.includes('/artifacts/content')) {
      if (over.contentStatus) return new Response(JSON.stringify({ statusCode: over.contentStatus, error: { code: 'not_found', message: 'No such artifact' } }), { status: over.contentStatus })
      return new Response(JSON.stringify({ engagementId: 'eng-1', path: 'findings/FIND-001.md', content: '# FIND-001\nbody', mediaType: 'text', sizeBytes: 16, truncated: false, source: 'workspace' }), { status: 200 })
    }
    if (url.endsWith('/artifacts')) return new Response(JSON.stringify({ engagementId: 'eng-1', folders: over.folders ?? FOLDERS, source: 'workspace' }), { status: 200 })
    return new Response('unexpected', { status: 404 })
  }))
  return calls
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RealFindingsPanel engagementId="eng-1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RealFindingsPanel', () => {
  it('lists findings with severity and bounded size, and expands detail with provenance', async () => {
    stubApi()
    renderPanel()
    expect(await screen.findByText('SQL injection on login')).toBeTruthy()
    await screen.findByTestId('finding-FIND-002')
    const row = await screen.findByTestId('finding-FIND-001')
    const user = userEvent.setup()
    await user.click(row.querySelector('button')!)
    expect(await screen.findByText('The login endpoint is injectable.')).toBeTruthy()
    expect(screen.getByText('CWE-89')).toBeTruthy()
    expect(screen.getByText('T1190')).toBeTruthy()
    expect(screen.getByText(/Bounded raw source/)).toBeTruthy()
  })

  it('surfaces parser quality flags instead of hiding defaults', async () => {
    stubApi()
    renderPanel()
    const row = await screen.findByTestId('finding-FIND-002')
    await userEvent.setup().click(row.querySelector('button')!)
    expect(await screen.findByText('Parser quality flags')).toBeTruthy()
    expect(screen.getByText(/Severity defaulted by the parser/)).toBeTruthy()
    expect(screen.getByText(/Description looks like a placeholder/)).toBeTruthy()
  })

  it('renders an honest empty state when a run produced no findings', async () => {
    stubApi({ findings: [] })
    renderPanel()
    expect(await screen.findByText('No findings recorded')).toBeTruthy()
    expect(screen.getByText(/nothing is invented/)).toBeTruthy()
  })

  it('opens the artifact inspector for text content and explains binary unavailability', async () => {
    stubApi()
    renderPanel()
    const file = await screen.findByRole('button', { name: /findings\/FIND-001\.md/ })
    await userEvent.setup().click(file)
    const viewer = await screen.findByTestId('artifact-viewer')
    expect(viewer.textContent).toContain('# FIND-001')
    expect(screen.getByText('text')).toBeTruthy()
  })

  it('shows an actionable error for a missing/foreign artifact path', async () => {
    stubApi({ contentStatus: 404 })
    renderPanel()
    const file = await screen.findByRole('button', { name: /findings\/FIND-001\.md/ })
    await userEvent.setup().click(file)
    expect(await screen.findByText('No such artifact')).toBeTruthy()
  })
})
