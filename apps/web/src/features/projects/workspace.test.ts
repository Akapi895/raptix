import { describe, expect, it } from 'vitest'
import { nextProjectStep, projectStage, readinessChecks, type WorkspaceInput } from './workspace'

const ready: WorkspaceInput = {
  metadataVerified: true,
  authorizationConfirmed: true,
  handoffConfirmed: true,
  lifecycle: 'running',
  scope: { state: 'loaded', value: { approvedVersion: 2 } },
  planning: { state: 'loaded', value: { ready: true, reasons: 0 } },
}

describe('projectStage', () => {
  it('derives the stage from the lifecycle only', () => {
    expect(projectStage('draft')).toBe('preparation')
    expect(projectStage('planning')).toBe('preparation')
    expect(projectStage('running')).toBe('execution')
    expect(projectStage('completed')).toBe('results')
    expect(projectStage('failed')).toBe('attention')
  })
})

describe('readinessChecks', () => {
  it('marks every check met when all sources confirm the project', () => {
    expect(readinessChecks(ready).map((check) => check.state)).toEqual(['met', 'met', 'met', 'met'])
  })

  it('reports an unread scope as unknown, not open', () => {
    const scope = readinessChecks({ ...ready, scope: { state: 'pending' } }).find((check) => check.id === 'scope')
    expect(scope?.state).toBe('unknown')
    expect(scope?.detail).toBe('Reading Scope & ROE…')
  })

  it('reports a failed planning read as unknown with its own message', () => {
    const planning = readinessChecks({ ...ready, handoffConfirmed: false, planning: { state: 'failed' } }).find((check) => check.id === 'planning')
    expect(planning).toMatchObject({ state: 'unknown', detail: 'Planning status could not be read' })
  })

  it('counts the planning items that block the handoff', () => {
    const planning = readinessChecks({ ...ready, handoffConfirmed: false, planning: { state: 'loaded', value: { ready: false, reasons: 3 } } }).find((check) => check.id === 'planning')
    expect(planning).toMatchObject({ state: 'open', detail: '3 planning item(s) to resolve' })
  })

  it('opens the target check when the metadata is not verified', () => {
    const target = readinessChecks({ ...ready, metadataVerified: false }).find((check) => check.id === 'target')
    expect(target).toMatchObject({ state: 'open', tab: 'scope' })
  })
})

describe('nextProjectStep', () => {
  it('points to the first open check, in readiness order', () => {
    const step = nextProjectStep({ ...ready, authorizationConfirmed: false, scope: { state: 'loaded', value: { approvedVersion: null } } })
    expect(step).toEqual({ tab: 'scope', title: 'Resolve: Authorization confirmed', why: 'Authorization is not confirmed' })
  })

  it('asks the operator to retry an unread source before anything else', () => {
    const step = nextProjectStep({ ...ready, scope: { state: 'failed' } })
    expect(step).toEqual({ tab: 'scope', title: 'Check: Scope & ROE approved', why: 'Scope status could not be read' })
  })

  it('moves to planning when the scope is approved but the handoff is not confirmed', () => {
    const step = nextProjectStep({ ...ready, handoffConfirmed: false, planning: { state: 'loaded', value: { ready: true, reasons: 0 } } })
    expect(step.tab).toBe('planning')
  })

  it('follows the lifecycle once every check is met', () => {
    expect(nextProjectStep({ ...ready, lifecycle: 'completed' }).tab).toBe('reports')
    expect(nextProjectStep({ ...ready, lifecycle: 'running' }).tab).toBe('operations')
    expect(nextProjectStep({ ...ready, lifecycle: 'draft' }).tab).toBe('ai-workspace')
  })
})
