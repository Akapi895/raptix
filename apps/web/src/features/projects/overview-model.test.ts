/**
 * The project overview's decisions: an active emergency stop is the next step, a decision belongs to its project and waits
 * on its actor first, the environment shows only whether this project holds it, and an unknown audit action is never
 * guessed as good or bad.
 */
import { describe, expect, it } from 'vitest'
import type { EnvironmentStateView } from '@raptix/web-contracts'
import type { OverviewTask } from '../overview'
import { activityTone, decisionsFor, environmentStatus, KPIS_BY_STAGE, LEAD_BLOCK_BY_STAGE, lifecycleStages, nextStepFor } from './overview-model'
import type { WorkspaceInput } from './workspace'

const READY: WorkspaceInput = {
  metadataVerified: true,
  authorizationConfirmed: true,
  handoffConfirmed: false,
  lifecycle: 'running',
  scope: { state: 'loaded', value: { approvedVersion: 3 } },
  planning: { state: 'loaded', value: { ready: false, reasons: 2 } },
}

function environment(overrides: { observedState?: string; archived?: boolean; phase?: string; held?: boolean; owned?: boolean }): EnvironmentStateView {
  const owned = overrides.owned ?? false
  return {
    engagementId: 'RT-2026-014',
    environment: { observedState: overrides.observedState ?? 'stopped', desiredState: 'stopped', generation: 1, observedAt: null, archived: overrides.archived ?? false, lastError: null },
    slot: { phase: overrides.phase ?? (overrides.held ? 'ready' : 'idle'), version: 1, held: overrides.held ?? false, ownedByThisProject: owned, activeEngagementId: owned ? 'RT-2026-014' : null },
  } as unknown as EnvironmentStateView
}

function task(overrides: Partial<OverviewTask>): OverviewTask {
  return {
    kind: 'finding-review',
    refId: 'F-1',
    engagementId: 'RT-2026-014',
    engagementName: 'Viettel lab',
    title: 'Finding awaits confirmation',
    createdAt: '2026-10-22T09:00:00Z',
    href: '#/project/RT-2026-014?tab=findings',
    awaitingActor: false,
    ...overrides,
  }
}

describe('next step', () => {
  it('puts an active emergency stop ahead of every preparation step', () => {
    const step = nextStepFor(READY, 2)
    expect(step.tab).toBe('operations')
    expect(step.title).toBe('Resolve the active emergency stop')
    expect(step.why).toBe('2 emergency stops are active in this project')
  })

  it('follows the workspace order when no stop is active', () => {
    const step = nextStepFor(READY, 0)
    expect(step.title).toBe('Resolve: Planning handed off')
    expect(step.tab).toBe('planning')
  })
})

describe('decisions', () => {
  it('keeps only the decisions of this engagement, with the ones awaiting this actor first', () => {
    const tasks = [
      task({ refId: 'A', createdAt: '2026-10-20T00:00:00Z' }),
      task({ refId: 'B', awaitingActor: true, createdAt: '2026-10-19T00:00:00Z' }),
      task({ refId: 'C', engagementId: 'RT-2026-009' }),
    ]
    expect(decisionsFor(tasks, 'RT-2026-014').map((t) => t.refId)).toEqual(['B', 'A'])
  })
})

describe('environment', () => {
  it('shows held by this project only when this project owns the slot', () => {
    expect(environmentStatus(environment({ held: true, owned: true, observedState: 'ready' })).label).toBe('Held by this project')
  })

  it('names another project as holder without naming it', () => {
    const status = environmentStatus(environment({ held: true, owned: false }))
    expect(status.label).toBe('Held by another project')
    expect(status.detail).not.toMatch(/RT-/)
  })

  it('reports a free slot and an unknown outcome distinctly', () => {
    expect(environmentStatus(environment({})).label).toBe('Free')
    expect(environmentStatus(environment({ observedState: 'uncertain' })).label).toBe('Needs reconcile')
  })
})

describe('activity tone', () => {
  it('colours by the kind of action it names', () => {
    expect(activityTone('emergency_stop.requested')).toBe('bad')
    expect(activityTone('scope.approved')).toBe('ok')
    expect(activityTone('grant.requested')).toBe('warn')
    expect(activityTone('scope.updated')).toBe('primary')
  })

  it('leaves an action it does not recognise neutral', () => {
    expect(activityTone('workspace.touched')).toBe('neutral')
  })
})

describe('lifecycle stages', () => {
  it('keeps execution blocked while any preparation check is open', () => {
    const [, execution] = lifecycleStages({ checksMet: 3, checksTotal: 4, lifecycle: 'draft', findingsConfirmed: null })
    expect(execution).toMatchObject({ state: 'blocked', detail: 'Blocked until 1 preparation check is met' })
  })

  it('starts execution as not started once the checks are met, and never as running', () => {
    const [preparation, execution] = lifecycleStages({ checksMet: 4, checksTotal: 4, lifecycle: 'planning', findingsConfirmed: null })
    expect(preparation.state).toBe('done')
    expect(execution.state).toBe('upcoming')
  })

  it('shows execution as running only when the lifecycle is running and the checks are met', () => {
    const [, execution] = lifecycleStages({ checksMet: 4, checksTotal: 4, lifecycle: 'running', findingsConfirmed: 2 })
    expect(execution.state).toBe('current')
  })

  it('reports a failed lifecycle as failed and a completed one as done with the confirmed count', () => {
    const failed = lifecycleStages({ checksMet: 4, checksTotal: 4, lifecycle: 'failed', findingsConfirmed: 0 })
    expect(failed[1].state).toBe('failed')
    const completed = lifecycleStages({ checksMet: 4, checksTotal: 4, lifecycle: 'completed', findingsConfirmed: 5 })
    expect(completed[2]).toMatchObject({ state: 'done', detail: '5 findings confirmed' })
  })

  it('says a count the server did not report is not reported, never zero', () => {
    const [, , results] = lifecycleStages({ checksMet: 4, checksTotal: 4, lifecycle: 'completed', findingsConfirmed: null })
    expect(results.detail).toBe('Confirmed findings are not reported')
  })
})

describe('stage figures', () => {
  it('gives every stage four different figures', () => {
    for (const keys of Object.values(KPIS_BY_STAGE)) expect(new Set(keys).size).toBe(4)
  })

  it('leads the main column with the readiness checklist only while the project is being prepared', () => {
    expect(LEAD_BLOCK_BY_STAGE.preparation).toBe('readiness')
    expect(LEAD_BLOCK_BY_STAGE.execution).toBe('execution')
    expect(LEAD_BLOCK_BY_STAGE.results).toBe('results')
  })
})
