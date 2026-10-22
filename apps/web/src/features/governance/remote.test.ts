/**
 * The governance adapter maps the server's plan, preflight and stop views onto
 * the port without inventing state, and turns a refused write into its explicit
 * failure kind. A missing engagement is a validation failure, never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    fetchPlans: vi.fn(),
    fetchPreflight: vi.fn(),
    decidePlan: vi.fn(),
    fetchEmergencyStops: vi.fn(),
  }
})

const api_governance = await import('./api');
const { ApiTransportError } = await import('../../platform/transport')
const { createRealGovernanceService } = await import('./remote')

const ctx = { actor: { id: 'u-owner', role: 'manager' as const }, projectId: 'eng-1', corr: 'test' }

beforeEach(() => {
  vi.mocked(api_governance.fetchPlans).mockReset()
  vi.mocked(api_governance.fetchPreflight).mockReset()
  vi.mocked(api_governance.decidePlan).mockReset()
  vi.mocked(api_governance.fetchEmergencyStops).mockReset()
})

describe('real governance service', () => {
  it('maps the plan list and keeps the deadline the server reports', async () => {
    vi.mocked(api_governance.fetchPlans).mockResolvedValue({
      engagementId: 'eng-1', source: 'db', deadlineHours: 24, latestApprovedScopeVersion: 2,
      plans: [{ id: 'p1', engagementId: 'eng-1', version: 1, status: 'approved', objective: 'Assess', methods: ['web'], requestedBy: 'u-owner', decidedBy: 'u-reviewer', decidedAt: null, decisionComment: null, expiresAt: '2026-10-19T09:00:00.000Z', roeVersion: 2, createdAt: '2026-10-17T09:00:00.000Z' }],
    } as never)
    const result = await createRealGovernanceService().plans(ctx)
    expect(result).toMatchObject({ ok: true, data: { deadlineHours: 24, plans: [{ id: 'p1', status: 'approved', roeVersion: 2, decidedBy: 'u-reviewer' }] } })
  })

  it('asks the preflight for the selected thread and passes the checks through unchanged', async () => {
    vi.mocked(api_governance.fetchPreflight).mockResolvedValue({ engagementId: 'eng-1', ok: false, checks: [{ id: 'roe', state: 'fail', detail: 'ROE not approved' }], source: 'db' } as never)
    const result = await createRealGovernanceService().preflight(ctx, 'thread-7')
    expect(api_governance.fetchPreflight).toHaveBeenCalledWith('eng-1', 'thread-7')
    expect(result).toEqual({ ok: true, data: { ok: false, checks: [{ id: 'roe', state: 'fail', detail: 'ROE not approved' }] } })
  })

  it('maps a refused decision to a conflict failure with the server message', async () => {
    vi.mocked(api_governance.decidePlan).mockRejectedValue(new ApiTransportError(409, 'conflict', 'Plan version changed since it was read'))
    const result = await createRealGovernanceService().decidePlan(ctx, 'p1', 'approved', 1)
    expect(result).toEqual({ ok: false, failure: { kind: 'conflict', message: 'Plan version changed since it was read' } })
  })

  it('keeps a stop outcome and its concurrency version as the server reports them', async () => {
    vi.mocked(api_governance.fetchEmergencyStops).mockResolvedValue({
      engagementId: 'eng-1', source: 'db',
      stops: [{ id: 's1', engagementId: 'eng-1', scope: 'workspace', targetId: null, requestedBy: 'u', outcome: 'unknown', reason: 'r', concurrencyVersion: 4, createdAt: '', updatedAt: '2026-10-17T09:00:00.000Z' }],
    } as never)
    const result = await createRealGovernanceService().stops(ctx)
    expect(result).toMatchObject({ ok: true, data: [{ id: 's1', outcome: 'unknown', concurrencyVersion: 4, related: [] }] })
  })

  it('answers a missing engagement as a validation failure, never as an empty plan list', async () => {
    const result = await createRealGovernanceService().plans({ ...ctx, projectId: 'all' })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'validation' } })
    expect(api_governance.fetchPlans).not.toHaveBeenCalled()
  })
})
