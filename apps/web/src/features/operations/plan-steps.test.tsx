/** Steps panel (P11, read-only): OPPLAN objectives as steps with the plan's own status words, and explicit states when no plan is ready. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

vi.mock('../planning/remote', () => ({ fetchPlanning: vi.fn() }))
vi.mock('../../state/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../state/keys')>()),
  useQueryScope: () => ({ actor: 'u-owner', role: 'manager', project: 'eng-1' }),
}))

const { PlanSteps } = await import('./plan-steps')
const api_planning = await import('../planning/remote');

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

function planning(opplan: unknown) {
  return { engagementId: 'eng-1', version: 1, documents: { opplan }, bundle: {}, readiness: { state: 'ready', reasons: [], runtimeSignal: 'not_observed' } } as never
}

beforeEach(() => { cleanup(); vi.clearAllMocks() })

describe('PlanSteps', () => {
  it('lists each OPPLAN objective with the status the plan carries and what blocks it', async () => {
    vi.mocked(api_planning.fetchPlanning).mockResolvedValue(planning({ state: 'ready', content: { engagement_name: 'Lab', threat_profile: 'apt', objectives: [
      { id: 'OBJ-001', title: 'Map the perimeter', description: '', phase: 'recon', status: 'completed' },
      { id: 'OBJ-002', title: 'Gain a foothold', description: '', phase: 'exploit', status: 'blocked', blocked_by: ['OBJ-001'] },
    ] } }))
    render(withClient(<PlanSteps engagementId="eng-1" />))
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Map the perimeter')).toBeInTheDocument()
    expect(within(list).getByText('completed')).toBeInTheDocument()
    expect(within(list).getByText('blocked by OBJ-001')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('states when no OPPLAN is ready instead of showing invented steps', async () => {
    vi.mocked(api_planning.fetchPlanning).mockResolvedValue(planning({ state: 'missing' }))
    render(withClient(<PlanSteps engagementId="eng-1" />))
    expect(await screen.findByText('No OPPLAN yet')).toBeInTheDocument()
  })
})
