/**
 * Project workspace state (page-details proposal §3.1, MVP 2026-10-22): the
 * stage, the readiness checks and the next step, derived from the project
 * fields and the reads the overview already makes.
 *
 * A read that is still pending or failed is `unknown`, never "not done", so
 * the workspace never shows a zero or a demo default for a source it could
 * not read. Nothing here calls the server; the screen passes the reads in.
 */
import type { ProjectViewModel } from '@raptix/web-contracts'

type Lifecycle = ProjectViewModel['lifecycleStatus']

/** A screen read as the workspace sees it: still loading, failed, or loaded. */
export type Read<T> = { state: 'pending' } | { state: 'failed' } | { state: 'loaded'; value: T }

export type ProjectStage = 'preparation' | 'execution' | 'results' | 'attention'

export const STAGE_LABEL: Readonly<Record<ProjectStage, string>> = {
  preparation: 'Preparation',
  execution: 'Execution',
  results: 'Results',
  attention: 'Needs attention',
}

/** The lifecycle stage; the lifecycle is the only stage source (no invented closeout state). */
export function projectStage(lifecycle: Lifecycle): ProjectStage {
  if (lifecycle === 'failed') return 'attention'
  if (lifecycle === 'running') return 'execution'
  if (lifecycle === 'completed') return 'results'
  return 'preparation'
}

export interface WorkspaceInput {
  metadataVerified: boolean
  authorizationConfirmed: boolean
  handoffConfirmed: boolean
  lifecycle: Lifecycle
  /** Approved scope & ROE revision, read from the scope screen's source. */
  scope: Read<{ approvedVersion: number | null }>
  /** Planning bundle readiness, read from the planning screen's source. */
  planning: Read<{ ready: boolean; reasons: number }>
}

export type CheckState = 'met' | 'open' | 'unknown'

export interface ReadinessCheck {
  id: 'target' | 'authorization' | 'scope' | 'planning'
  label: string
  state: CheckState
  detail: string
  /** The project tab that owns the check's work. */
  tab: 'scope' | 'planning'
}

export function readinessChecks(input: WorkspaceInput): ReadinessCheck[] {
  const scope: Omit<ReadinessCheck, 'id' | 'label' | 'tab'> = input.scope.state === 'loaded'
    ? input.scope.value.approvedVersion === null
      ? { state: 'open', detail: 'No approved Scope & ROE revision yet' }
      : { state: 'met', detail: `Approved Scope & ROE v${input.scope.value.approvedVersion}` }
    : { state: 'unknown', detail: input.scope.state === 'failed' ? 'Scope status could not be read' : 'Reading Scope & ROE…' }
  const planning: Omit<ReadinessCheck, 'id' | 'label' | 'tab'> = input.handoffConfirmed
    ? { state: 'met', detail: 'Planning handoff confirmed' }
    : input.planning.state === 'loaded'
      ? input.planning.value.ready
        ? { state: 'open', detail: 'Planning documents are ready — confirm the handoff' }
        : { state: 'open', detail: `${input.planning.value.reasons} planning item(s) to resolve` }
      : { state: 'unknown', detail: input.planning.state === 'failed' ? 'Planning status could not be read' : 'Reading planning…' }
  return [
    { id: 'target', label: 'Target verified', state: input.metadataVerified ? 'met' : 'open', detail: input.metadataVerified ? 'Target passed metadata policy' : 'Target metadata needs review', tab: 'scope' },
    { id: 'authorization', label: 'Authorization confirmed', state: input.authorizationConfirmed ? 'met' : 'open', detail: input.authorizationConfirmed ? 'Authorization recorded' : 'Authorization is not confirmed', tab: 'scope' },
    { id: 'scope', label: 'Scope & ROE approved', tab: 'scope', ...scope },
    { id: 'planning', label: 'Planning handed off', tab: 'planning', ...planning },
  ]
}

export interface NextStep {
  /** The project tab the step opens. */
  tab: string
  title: string
  why: string
}

/** The first readiness check that is not met, else the next lifecycle step. Unknown reads come first so the operator retries them. */
export function nextProjectStep(input: WorkspaceInput): NextStep {
  const open = readinessChecks(input).find((check) => check.state !== 'met')
  if (open) {
    const title = open.state === 'unknown' ? `Check: ${open.label}` : `Resolve: ${open.label}`
    return { tab: open.tab, title, why: open.detail }
  }
  if (input.lifecycle === 'failed') return { tab: 'operations', title: 'Review the failed run', why: 'The project lifecycle is failed' }
  if (input.lifecycle === 'running') return { tab: 'operations', title: 'Follow the running operation', why: 'Runs are in progress for this project' }
  if (input.lifecycle === 'completed') return { tab: 'reports', title: 'Prepare the report', why: 'Execution is complete; findings feed the report' }
  return { tab: 'ai-workspace', title: 'Start execution from AI Workspace', why: 'Readiness is met and the planning handoff is confirmed' }
}
