/** Approval inbox on the team tab (P09, real mode): only this engagement's pending decisions, the waiting-on-you flag, and explicit empty and error states. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

vi.mock('../../real/api', () => ({ fetchTasks: vi.fn() }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

const { ApprovalInbox } = await import('./approval-inbox')
const api = await import('../../real/api')

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
    vi.mocked(api.fetchTasks).mockResolvedValue({
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
    vi.mocked(api.fetchTasks).mockResolvedValue({ tasks: [], engagements: [], counts: {}, source: 'db' } as never)
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument()
  })

  it('shows an explicit unavailable state rather than a substitute list when the source fails', async () => {
    vi.mocked(api.fetchTasks).mockRejectedValue(new Error('inbox down'))
    render(withClient(<ApprovalInbox engagementId="eng-1" />))
    expect(await screen.findByText('Approvals unavailable')).toBeInTheDocument()
    expect(screen.getByText(/inbox down/)).toBeInTheDocument()
  })
})
