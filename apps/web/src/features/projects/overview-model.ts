/**
 * Pure decisions behind the project overview. The screen passes in the reads it has; nothing here calls the server, and a
 * read that has not loaded is never turned into a zero or a default.
 */
import type { EnvironmentStateView, ProjectViewModel } from '@raptix/web-contracts'
import type { OverviewTask, OverviewTaskKind } from '../overview'
import { nextProjectStep, type NextStep, type ProjectStage, type WorkspaceInput } from './workspace'

export type OverviewTone = 'ok' | 'warn' | 'bad' | 'primary' | 'neutral'

/**
 * The one next step. An active emergency stop outranks every preparation step, because nothing else in the project may
 * proceed while it is active; without one, the workspace's own order decides.
 */
export function nextStepFor(input: WorkspaceInput, activeStops: number): NextStep {
  if (activeStops > 0) {
    return {
      tab: 'operations',
      title: 'Resolve the active emergency stop',
      why: `${activeStops} emergency stop${activeStops === 1 ? ' is' : 's are'} active in this project`,
    }
  }
  return nextProjectStep(input)
}

/** The project tab that owns each kind of decision. The task endpoint's own hrefs name tabs this navigation no longer has. */
export const DECISION_TAB: Readonly<Record<OverviewTaskKind, string>> = {
  'scope-revision': 'scope',
  'business-plan': 'planning',
  'c2-grant': 'c2',
  'report-review': 'reports',
  'finding-review': 'findings',
  'active-stop': 'operations',
}

export const DECISION_LABEL: Readonly<Record<OverviewTaskKind, string>> = {
  'scope-revision': 'Scope revision awaiting review',
  'business-plan': 'Plan awaiting approval',
  'c2-grant': 'C2 grant awaiting decision',
  'report-review': 'Report awaiting review',
  'finding-review': 'Finding awaiting confirmation',
  'active-stop': 'Emergency stop active',
}

export const DECISION_TONE: Readonly<Record<OverviewTaskKind, OverviewTone>> = {
  'scope-revision': 'warn',
  'business-plan': 'primary',
  'c2-grant': 'warn',
  'report-review': 'primary',
  'finding-review': 'primary',
  'active-stop': 'bad',
}

/** Decisions for one engagement: the ones waiting on this actor first, then the newest. */
export function decisionsFor(tasks: readonly OverviewTask[], engagementId: string): OverviewTask[] {
  return tasks
    .filter((task) => task.engagementId === engagementId)
    .sort((a, b) => Number(b.awaitingActor) - Number(a.awaitingActor) || b.createdAt.localeCompare(a.createdAt))
}

/** The environment slot as this project sees it. Only one project can hold the slot; another project's identity is never shown. */
export function environmentStatus(view: EnvironmentStateView): { label: string; tone: OverviewTone; detail: string } {
  if (view.environment.archived) return { label: 'Archived', tone: 'neutral', detail: 'Unarchive the environment before it can start' }
  if (view.environment.observedState === 'uncertain' || view.slot.phase === 'uncertain') {
    return { label: 'Needs reconcile', tone: 'bad', detail: 'The last outcome is unknown; reconcile it from Execution' }
  }
  if (view.slot.ownedByThisProject) return { label: 'Held by this project', tone: 'primary', detail: `Observed: ${view.environment.observedState}` }
  if (view.slot.held) return { label: 'Held by another project', tone: 'neutral', detail: 'The environment is in use by another project' }
  return { label: 'Free', tone: 'ok', detail: 'Available to start' }
}

/** The tone of an audit action, from its name. Unknown actions stay neutral rather than being guessed as good or bad. */
export function activityTone(action: string): OverviewTone {
  const name = action.toLowerCase()
  if (/stop|deny|denied|reject|revok|fail/.test(name)) return 'bad'
  if (/approve|confirm|accept|deliver|complete/.test(name)) return 'ok'
  if (/request|submit|pending|review|propos/.test(name)) return 'warn'
  if (/scope|plan|roe|handoff/.test(name)) return 'primary'
  return 'neutral'
}

export function activityLabel(action: string): string {
  return action.replace(/[._-]+/g, ' ').trim()
}

export type StageState = 'done' | 'current' | 'upcoming' | 'blocked' | 'failed'

export interface LifecycleStage {
  id: 'preparation' | 'execution' | 'results'
  label: string
  state: StageState
  detail: string
}

export interface LifecycleInput {
  checksMet: number
  checksTotal: number
  lifecycle: ProjectViewModel['lifecycleStatus']
  findingsConfirmed: number | null
}

export const STAGE_TONE: Readonly<Record<StageState, OverviewTone>> = {
  done: 'ok',
  current: 'primary',
  upcoming: 'neutral',
  blocked: 'warn',
  failed: 'bad',
}

export const STAGE_STATE_LABEL: Readonly<Record<StageState, string>> = {
  done: 'Done',
  current: 'In progress',
  upcoming: 'Not started',
  blocked: 'Blocked',
  failed: 'Failed',
}

/**
 * The three stages the lifecycle records. Execution is blocked while any preparation check is open, whatever the target and
 * authorization say: the scope and planning checks decide whether a run may start.
 */
export function lifecycleStages(input: LifecycleInput): LifecycleStage[] {
  const open = input.checksTotal - input.checksMet
  const prepared = open === 0
  const preparation: LifecycleStage = prepared
    ? { id: 'preparation', label: 'Preparation', state: 'done', detail: `All ${input.checksTotal} checks met` }
    : { id: 'preparation', label: 'Preparation', state: 'current', detail: `${input.checksMet} of ${input.checksTotal} checks met` }
  let execution: LifecycleStage
  if (input.lifecycle === 'failed') {
    execution = { id: 'execution', label: 'Execution', state: 'failed', detail: 'The lifecycle is failed; review the last run in Operations' }
  } else if (input.lifecycle === 'completed') {
    execution = { id: 'execution', label: 'Execution', state: 'done', detail: 'Execution is complete' }
  } else if (!prepared) {
    execution = { id: 'execution', label: 'Execution', state: 'blocked', detail: `Blocked until ${open} preparation ${open === 1 ? 'check is' : 'checks are'} met` }
  } else if (input.lifecycle === 'running') {
    execution = { id: 'execution', label: 'Execution', state: 'current', detail: 'Runs are in progress' }
  } else {
    execution = { id: 'execution', label: 'Execution', state: 'upcoming', detail: 'Not started; preflight decides when it can run' }
  }
  const results: LifecycleStage = input.lifecycle === 'completed'
    ? { id: 'results', label: 'Results', state: 'done', detail: input.findingsConfirmed === null ? 'Confirmed findings are not reported' : `${input.findingsConfirmed} findings confirmed` }
    : { id: 'results', label: 'Results', state: 'upcoming', detail: input.findingsConfirmed === null ? 'Starts when execution completes' : `${input.findingsConfirmed} findings confirmed so far` }
  return [preparation, execution, results]
}

export type KpiKey = 'targets' | 'checks' | 'decisions' | 'findings' | 'critical' | 'runs' | 'objectives' | 'stops' | 'confirmed' | 'reports'

/** The four figures that matter at each stage, so the top of the page answers the question the stage raises. */
export const KPIS_BY_STAGE: Readonly<Record<ProjectStage, readonly KpiKey[]>> = {
  preparation: ['checks', 'targets', 'decisions', 'findings'],
  execution: ['runs', 'objectives', 'stops', 'critical'],
  results: ['confirmed', 'reports', 'critical', 'objectives'],
  attention: ['stops', 'runs', 'decisions', 'findings'],
}

/** The block that leads the main column at each stage. */
export const LEAD_BLOCK_BY_STAGE: Readonly<Record<ProjectStage, 'readiness' | 'execution' | 'results'>> = {
  preparation: 'readiness',
  execution: 'execution',
  results: 'results',
  attention: 'execution',
}
