import type { EnvironmentCommandResult, EnvironmentStateView } from '@raptix/web-contracts'
import { describe, expect, it } from 'vitest'
import { nextAction, needsReconcile, outcomeOf, ownHolder, refreshIntervalFor } from './environment-logic'

const view = (engagementId: string, overrides: { observed?: EnvironmentStateView['environment']['observedState']; phase?: EnvironmentStateView['slot']['phase']; own?: boolean; version?: number } = {}): EnvironmentStateView => {
  const phase = overrides.phase ?? 'idle'
  return {
    engagementId,
    environment: { observedState: overrides.observed ?? 'stopped', desiredState: 'stopped', generation: 1, observedAt: null, archived: false, lastError: null },
    slot: { phase, version: overrides.version ?? 2, held: phase !== 'idle', ownedByThisProject: overrides.own ?? false, activeEngagementId: overrides.own ? engagementId : null },
  }
}

const answer = (overrides: Partial<EnvironmentCommandResult>): EnvironmentCommandResult => ({ status: 'accepted', phase: 'starting', version: 3, commandId: 'c1', ...overrides })

describe('environment logic', () => {
  it('keeps refreshing only while a state is moving, and stops when it settles', () => {
    expect(refreshIntervalFor(view('a', { observed: 'starting' }))).toBe(2000)
    expect(refreshIntervalFor(view('a', { observed: 'stopping' }))).toBe(2000)
    expect(refreshIntervalFor(view('a', { observed: 'ready', phase: 'ready', own: true }))).toBe(false)
    expect(refreshIntervalFor(undefined)).toBe(false)
  })

  it('flags an uncertain outcome for reconciliation', () => {
    expect(needsReconcile(view('a', { observed: 'uncertain', phase: 'uncertain' }))).toBe(true)
    expect(needsReconcile(view('a', { phase: 'ready', own: true, observed: 'ready' }))).toBe(false)
  })

  it('names the project holding the slot only when this caller owns it', () => {
    const states = new Map([['a', view('a')], ['b', view('b', { phase: 'ready', own: true, observed: 'ready' })], ['c', view('c', { phase: 'ready' })]])
    expect(ownHolder(states)).toBe('b')
    expect(ownHolder(new Map([['c', view('c', { phase: 'ready' })]]))).toBeNull()
  })

  it('offers only the next command a state allows', () => {
    expect(nextAction(view('a'))).toBe('activate')
    expect(nextAction(view('a', { phase: 'ready', own: true, observed: 'ready' }))).toBe('stop')
    expect(nextAction(view('a', { phase: 'uncertain', own: true, observed: 'uncertain' }))).toBe('stop')
    expect(nextAction(view('a', { phase: 'ready', observed: 'stopped' }))).toBe('none')
  })

  it('reports ready, busy, stale and refused answers in words that name the next step', () => {
    expect(outcomeOf('activate', answer({ phase: 'ready' }))).toEqual({ kind: 'done', message: 'The environment is ready.' })
    expect(outcomeOf('activate', answer({ phase: 'starting' })).message).toMatch(/Starting the environment/)
    expect(outcomeOf('activate', answer({ phase: 'uncertain' }))).toMatchObject({ kind: 'failed' })
    expect(outcomeOf('activate', answer({ status: 'busy', phase: 'ready' }))).toMatchObject({ kind: 'busy' })
    expect(outcomeOf('activate', answer({ status: 'stale', phase: 'ready' }))).toMatchObject({ kind: 'refresh' })
    expect(outcomeOf('stop', answer({ status: 'refused', phase: 'idle', reason: 'not_active' })).message).toMatch(/not_active/)
  })
})
