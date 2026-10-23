/**
 * The four Overview measures (WS-4A). Each figure has one label, one definition (the caption the card shows), one state
 * and one screen that lists what it counts. The state follows the source: `zero` only when the source confirms zero,
 * `not-recorded` when the source has no count, `unavailable` when the read failed and `pending` while it loads. A figure
 * the source does not record is never shown as zero.
 */
import { openCuratedCount, type OverviewFindings, type OverviewOperations, type OverviewProject, type OverviewTask } from './service'

export type MeasureId = 'active-projects' | 'active-operations' | 'awaiting-decisions' | 'open-curated-findings'
export type MeasureState = 'value' | 'zero' | 'not-recorded' | 'unavailable' | 'pending'
export type MeasureTarget = 'projects' | 'operations' | 'tasks' | 'findings'

/** The shape a React Query result has; the measure reads only these three fields. */
export interface Read<T> {
  isPending: boolean
  error: unknown
  data?: T
}

export interface Measure {
  id: MeasureId
  label: string
  /** The caption: what the figure counts, in the words the list it opens uses. */
  definition: string
  state: MeasureState
  /** The count for `value` and `zero`; null in every other state. */
  value: number | null
  target: MeasureTarget
}

type Definition = Pick<Measure, 'id' | 'label' | 'definition' | 'target'>

/**
 * Lifecycle states that count as an active project. The real engagement contract records only `planning` and `running`;
 * `approved` and `active` are demo vocabulary and keep counting here so the two modes use one rule.
 */
const ACTIVE_PROJECT_STATUSES: ReadonlySet<string> = new Set(['active', 'approved', 'planning', 'running'])

const DEFINITIONS: Readonly<Record<MeasureId, Definition>> = {
  'active-projects': { id: 'active-projects', label: 'Active projects', definition: 'Approved, planning, active or running projects', target: 'projects' },
  'active-operations': { id: 'active-operations', label: 'Active operations', definition: 'Operations running now in your projects', target: 'operations' },
  'awaiting-decisions': { id: 'awaiting-decisions', label: 'Awaiting decisions', definition: 'Workflow decisions, excluding emergency stops and tool approvals', target: 'tasks' },
  'open-curated-findings': { id: 'open-curated-findings', label: 'Open curated findings', definition: 'Confirmed, remediation or retest; AI suggestions excluded', target: 'findings' },
}

/** The text a measure shows in its figure slot. */
export function measureText(measure: Measure): string {
  if (measure.state === 'pending') return 'Pending'
  if (measure.state === 'unavailable') return 'Unavailable'
  if (measure.state === 'not-recorded') return 'Not recorded'
  return String(measure.value)
}

function measureOf<T>(definition: Definition, read: Read<T>, count: (data: T) => number | null): Measure {
  if (read.isPending) return { ...definition, state: 'pending', value: null }
  if (read.error || read.data === undefined) return { ...definition, state: 'unavailable', value: null }
  const value = count(read.data)
  if (value === null) return { ...definition, state: 'not-recorded', value: null }
  return { ...definition, state: value === 0 ? 'zero' : 'value', value }
}

/** The four measures in display order, each computed from its own read. */
export function overviewMeasures(reads: { projects: Read<OverviewProject[]>; operations: Read<OverviewOperations>; tasks: Read<OverviewTask[]>; findings: Read<OverviewFindings> }): Measure[] {
  return [
    measureOf(DEFINITIONS['active-projects'], reads.projects, (list) => list.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status.toLowerCase())).length),
    measureOf(DEFINITIONS['active-operations'], reads.operations, (view) => (view.counts === null ? null : (view.counts.running ?? 0))),
    measureOf(DEFINITIONS['awaiting-decisions'], reads.tasks, (list) => list.filter((task) => task.kind !== 'active-stop').length),
    measureOf(DEFINITIONS['open-curated-findings'], reads.findings, openCuratedCount),
  ]
}
