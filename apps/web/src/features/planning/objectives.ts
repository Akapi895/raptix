/**
 * The OPPLAN objectives read as steps: each step's state from its plan status and its dependencies, the agent role the
 * runtime routes its phase to, and the summary the plan overview shows. Pure, so the screen renders what these decide.
 */
import type { PlanningObjective } from './service'

export type StepState = 'done' | 'running' | 'ready' | 'blocked' | 'cancelled'

/** The agent role each phase is routed to (raptix-core ObjectivePhase). A phase it does not name has no role here. */
const PHASE_ROLE: Readonly<Record<string, string>> = {
  recon: 'Recon agent',
  'initial-access': 'Exploit agent',
  'post-exploit': 'Post-exploitation agent',
  c2: 'Post-exploitation agent',
  exfiltration: 'Post-exploitation agent',
}

export function agentRoleFor(phase: string): string | null {
  return PHASE_ROLE[phase] ?? null
}

/**
 * A step's state. A dependency that is not completed, or that the plan does not contain, keeps the step blocked: an unknown
 * dependency is never treated as satisfied.
 */
export function stepStates(objectives: readonly PlanningObjective[]): Map<string, StepState> {
  const completed = new Set(objectives.filter((o) => o.status === 'completed').map((o) => o.id))
  const states = new Map<string, StepState>()
  for (const objective of objectives) {
    const unmetDependency = objective.blockedBy.some((dependency) => !completed.has(dependency))
    let state: StepState
    if (objective.status === 'completed') state = 'done'
    else if (objective.status === 'cancelled') state = 'cancelled'
    else if (objective.status === 'in-progress') state = 'running'
    else if (objective.status === 'blocked' || unmetDependency) state = 'blocked'
    else state = 'ready'
    states.set(objective.id, state)
  }
  return states
}

export interface PlanSummary {
  total: number
  done: number
  running: number
  ready: number
  blocked: number
  cancelled: number
}

export function planSummary(objectives: readonly PlanningObjective[]): PlanSummary {
  const states = [...stepStates(objectives).values()]
  const count = (state: StepState): number => states.filter((value) => value === state).length
  return {
    total: objectives.length,
    done: count('done'),
    running: count('running'),
    ready: count('ready'),
    blocked: count('blocked'),
    cancelled: count('cancelled'),
  }
}
