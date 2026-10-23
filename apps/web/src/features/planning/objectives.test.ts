/**
 * The OPPLAN objectives as steps: a step waits on every dependency it names, an unknown dependency keeps it blocked, a
 * phase is routed to the agent role the runtime defines, and a phase the runtime does not name has no role.
 */
import { describe, expect, it } from 'vitest'
import { agentRoleFor, planSummary, stepStates } from './objectives'
import type { PlanningObjective } from './service'

function objective(overrides: Partial<PlanningObjective>): PlanningObjective {
  return {
    id: 'OBJ-001',
    title: 'Enumerate the attack surface',
    description: '',
    phase: 'recon',
    status: 'pending',
    blockedBy: [],
    acceptanceCriteria: [],
    priority: null,
    owner: null,
    notes: null,
    parentId: null,
    effects: null,
    resources: [],
    mitre: [],
    opsec: null,
    c2Tier: null,
    ...overrides,
  }
}

describe('objective steps', () => {
  it('keeps a step waiting while a dependency it names is not completed', () => {
    const states = stepStates([
      objective({ id: 'OBJ-001', status: 'in-progress' }),
      objective({ id: 'OBJ-002', blockedBy: ['OBJ-001'] }),
    ])
    expect(states.get('OBJ-002')).toBe('blocked')
  })

  it('releases a step once every dependency is completed', () => {
    const states = stepStates([
      objective({ id: 'OBJ-001', status: 'completed' }),
      objective({ id: 'OBJ-002', blockedBy: ['OBJ-001'] }),
    ])
    expect(states.get('OBJ-002')).toBe('ready')
  })

  it('treats a dependency the plan does not contain as unmet, never as satisfied', () => {
    const states = stepStates([objective({ id: 'OBJ-003', blockedBy: ['OBJ-999'] })])
    expect(states.get('OBJ-003')).toBe('blocked')
  })

  it('shows a step the runtime marked blocked as blocked, whatever its dependencies', () => {
    expect(stepStates([objective({ status: 'blocked' })]).get('OBJ-001')).toBe('blocked')
  })

  it('reads the plan status for done, running and cancelled steps', () => {
    const states = stepStates([
      objective({ id: 'a', status: 'completed' }),
      objective({ id: 'b', status: 'in-progress' }),
      objective({ id: 'c', status: 'cancelled' }),
    ])
    expect([states.get('a'), states.get('b'), states.get('c')]).toEqual(['done', 'running', 'cancelled'])
  })
})

describe('agent role by phase', () => {
  it('routes each phase to the agent role the runtime defines', () => {
    expect(agentRoleFor('recon')).toBe('Recon agent')
    expect(agentRoleFor('initial-access')).toBe('Exploit agent')
    expect(agentRoleFor('post-exploit')).toBe('Post-exploitation agent')
    expect(agentRoleFor('exfiltration')).toBe('Post-exploitation agent')
  })

  it('names no role for a phase the runtime does not define', () => {
    expect(agentRoleFor('lateral-movement')).toBeNull()
  })
})

describe('plan summary', () => {
  it('counts each step once, by the state it is in', () => {
    const summary = planSummary([
      objective({ id: 'a', status: 'completed' }),
      objective({ id: 'b', status: 'in-progress' }),
      objective({ id: 'c', blockedBy: ['b'] }),
      objective({ id: 'd' }),
      objective({ id: 'e', status: 'cancelled' }),
    ])
    expect(summary).toEqual({ total: 5, done: 1, running: 1, ready: 1, blocked: 1, cancelled: 1 })
  })
})
