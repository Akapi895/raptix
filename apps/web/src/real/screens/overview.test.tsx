/** Real System Overview against stubbed per-domain API responses. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectViewModel } from '@raptix/web-contracts'

const { cleanup, render, screen } = await import('@testing-library/react')
const { RealModeProvider } = await import('../bootstrap')
const { RealOverview } = await import('./overview')

const CAPS = { version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true } } }

const dto: ProjectViewModel = {
  id: 'eng-1',
  workspaceSlug: 'q1-external-assessment',
  displayName: 'Q1 External Assessment',
  targetType: 'web_url',
  targetValue: 'https://target.example.test',
  authorizationConfirmed: true,
  brief: 'Assess the public surface.',
  handoffConfirmedAt: null,
  metadataState: 'verified',
  lifecycleStatus: 'planning',
  findingCount: null,
  assetCount: null,
  activeAgentCount: null,
  createdAt: '2026-10-14T08:00:00.000Z',
  updatedAt: '2026-10-14T09:30:00.000Z',
}

const FINDINGS = { total: 3, bySeverity: { high: 2, critical: 1 }, byStatus: { confirmed: 2, review: 1 }, engagementsWithFindings: 2, engagements: 3, truncated: false, source: 'db' }
const C2 = { commandsByStatus: { creating: 0, succeeded: 1, failed: 0, uncertain: 0 }, recentCommands: [{ id: 'c1', engagementId: 'eng-1', sessionId: 'sess-1', status: 'succeeded', createdAt: '2026-10-15T08:00:00.000Z' }], pendingGrants: 1, source: 'db' }
const TASKS = {
  tasks: [{ kind: 'finding-review', engagementId: 'eng-1', engagementName: 'Q1 External Assessment', refId: 'f1', title: 'Finding "SSRF" awaits confirmation', createdAt: '2026-10-15T08:00:00.000Z', href: '#/project/eng-1?tab=findings', awaitingActor: true }],
  engagements: [], counts: {}, source: 'db',
}

function stubApi(failFindings = false) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/capabilities')) return new Response(JSON.stringify(CAPS))
    if (url.endsWith('/api/engagements')) return new Response(JSON.stringify([dto]))
    if (url.endsWith('/api/overview/findings')) return failFindings ? new Response('rollup failed', { status: 500 }) : new Response(JSON.stringify(FINDINGS))
    if (url.endsWith('/api/overview/c2')) return new Response(JSON.stringify(C2))
    if (url.endsWith('/api/tasks')) return new Response(JSON.stringify(TASKS))
    return new Response('unexpected', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function ui(node: React.ReactElement) {
  return render(<RealModeProvider>{node}</RealModeProvider>)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RealOverview', () => {
  it('renders every domain section from its own source', async () => {
    stubApi()
    ui(<RealOverview />)
    expect(await screen.findByText('Q1 External Assessment')).toBeTruthy()
    expect(await screen.findByText(/high: 2/)).toBeTruthy()
    expect(screen.getByText(/critical: 1/)).toBeTruthy()
    expect(screen.getByText(/succeeded: 1/)).toBeTruthy()
    expect(screen.getByText('sess-1')).toBeTruthy()
    expect(screen.getByText(/grants awaiting review/)).toBeTruthy()
    expect(await screen.findByText(/awaits confirmation/)).toBeTruthy()
  })

  it('degrades a failed source without blanking the other sections', async () => {
    stubApi(true)
    ui(<RealOverview />)
    expect(await screen.findByText(/The findings rollup is unavailable/)).toBeTruthy()
    expect(await screen.findByText('Q1 External Assessment')).toBeTruthy()
    expect(await screen.findByText(/succeeded: 1/)).toBeTruthy()
  })
})
