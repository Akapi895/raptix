/** Approval inbox on the team tab (P09, real mode): only this engagement's pending decisions, the waiting-on-you flag, and explicit empty and error states. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

vi.mock('../decisions/remote', async (importOriginal) => ({ ...(await importOriginal<typeof import('../decisions/remote')>()), fetchTasks: vi.fn() }))
vi.mock('../closure/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../closure/api')>()), fetchClosure: vi.fn(async () => ({ engagementId: 'eng-1', closure: null, readOnly: false, checklist: { entries: [], ok: true } })) }))
vi.mock('../capabilities/endpoints', async (importOriginal) => ({ ...(await importOriginal<typeof import('../capabilities/endpoints')>()), fetchLibraryProposals: vi.fn(async () => ({ engagementId: 'eng-1', proposals: [], source: 'db' })) }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

const { ApprovalInbox } = await import('./approval-inbox')
const api_decisions = await import('../decisions/remote');

const TASK = (over: Record<string, unknown>) => ({
  kind: 'scope-revision', engagementId: 'eng-1', engagementName: 'Lab', refId: 'SR-1', title: 'Widen the in-scope range',
  createdAt: '2026-10-19T09:00:00.000Z', href: '#/project/eng-1?tab=scope', awaitingActor: false, ...over,
})

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

beforeEach(() => { cleanup(); vi.clearAllMocks() })

describe('ApprovalInbox', () => {
  it('lists only the decisions pending on this engagement and flags the ones waiting on the signed-in actor', async () => {
    vi.mocked(api_decisions.fetchTasks).mockResolvedValue({
      tasks: [
        TASK({ refId: 'SR-1', title: 'Widen the in-scope range', awaitingActor: true }),
        TASK({ kind: 'report-review', refId: 'RPT-9', title: 'Q3 report', engagementId: 'eng-2' }),
        TASK({ kind: 'finding-review', refId: 'FD-4', title: 'Exposed admin panel', href: '#/project/eng-1?tab=findings' }),
      ],
      engagements: [], counts: {}, source: 'db',
    } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Widen the in-scope range')).toBeInTheDocument()
    expect(within(list).getByText('Exposed admin panel')).toBeInTheDocument()
    expect(within(list).queryByText('Q3 report')).toBeNull()
    expect(within(list).getByText('Waiting on you')).toBeInTheDocument()
    expect(within(list).getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '#/project/eng-1?tab=scope')
  })

  it('states when nothing is waiting instead of showing an empty list', async () => {
    vi.mocked(api_decisions.fetchTasks).mockResolvedValue({ tasks: [], engagements: [], counts: {}, source: 'db' } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument()
  })

  it('lists an active emergency stop as attention, not as a decision waiting for approval', async () => {
    vi.mocked(api_decisions.fetchTasks).mockResolvedValue({
      tasks: [TASK({ kind: 'active-stop', refId: 'ES-1', title: 'Emergency stop (all) is active', href: '#/project/eng-1?tab=operations' }), TASK({ refId: 'SR-1', title: 'Widen the in-scope range' })],
      engagements: [], counts: {}, source: 'db',
    } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    const attention = await screen.findByRole('region', { name: 'Attention' })
    expect(within(attention).getByText('Emergency stop (all) is active')).toBeInTheDocument()
    const decisions = screen.getByRole('region', { name: 'Decisions' })
    expect(within(decisions).queryByText('Emergency stop (all) is active')).toBeNull()
    expect(within(decisions).getByText('Widen the in-scope range')).toBeInTheDocument()
  })

  it('says when the inbox read is limited and marks the counts as lower bounds', async () => {
    vi.mocked(api_decisions.fetchTasks).mockResolvedValue({
      tasks: [TASK({ refId: 'SR-1', title: 'Widen the in-scope range' })], engagements: [], counts: {}, limited: true, source: 'db',
    } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    expect(await screen.findByText('The list is limited')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Decisions' })).toHaveTextContent('Decisions · 1+')
  })

  it('lists the closure request and the library proposal waiting on this project, and says they are not in the Overview count yet', async () => {
    const api_closure = await import('../closure/api');
    const api_library = await import('../capabilities/endpoints');
    vi.mocked(api_decisions.fetchTasks).mockResolvedValue({ tasks: [], engagements: [], counts: {}, source: 'db' } as never)
    vi.mocked(api_closure.fetchClosure).mockResolvedValue({ engagementId: 'eng-1', closure: { id: 'cl-1', status: 'requested' }, readOnly: false, checklist: { entries: [], ok: true } } as never)
    vi.mocked(api_library.fetchLibraryProposals).mockResolvedValue({ engagementId: 'eng-1', proposals: [{ id: 'lp-1', skillName: 'kerberoasting', status: 'proposed' }], source: 'db' } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    const also = await screen.findByRole('region', { name: 'Also waiting on this project' })
    expect(within(also).getByText('Engagement closure awaiting decision')).toBeInTheDocument()
    expect(within(also).getByText('Library proposal for kerberoasting awaiting review')).toBeInTheDocument()
    expect(within(also).getByText(/not counted on the Overview yet/)).toBeInTheDocument()
    expect(screen.getByText(/Runtime tool approvals wait in the AI Workspace/)).toBeInTheDocument()
  })

  it('keeps the decision count exact when only the emergency-stop list reached its cap', async () => {
    vi.mocked(api_decisions.fetchTasks).mockResolvedValue({
      tasks: [TASK({ refId: 'SR-1', title: 'Widen the in-scope range' }), TASK({ kind: 'active-stop', refId: 'ES-1', title: 'Emergency stop (all) is active', href: '#/project/eng-1?tab=operations' })],
      engagements: [], counts: {}, limited: true, limitedKinds: ['active-stop'], source: 'db',
    } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    expect(await screen.findByRole('region', { name: 'Decisions' })).toHaveTextContent('Decisions · 1')
    expect(screen.getByRole('region', { name: 'Attention' })).toHaveTextContent('Attention · 1+ active emergency stop')
  })

  it('shows an explicit unavailable state rather than a substitute list when the source fails', async () => {
    vi.mocked(api_decisions.fetchTasks).mockRejectedValue(new Error('inbox down'))
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    expect(await screen.findByText('Approvals unavailable')).toBeInTheDocument()
    expect(screen.getByText(/inbox down/)).toBeInTheDocument()
  })
})
