import { describe, expect, it } from 'vitest'
import { measureText, overviewMeasures, type Read } from './measures'
import type { OverviewFindings, OverviewOperations, OverviewProject, OverviewTask, OverviewTaskList } from './service'

const READY = <T,>(data: T): Read<T> => ({ isPending: false, error: null, data })
const PENDING: Read<never> = { isPending: true, error: null, data: undefined }
const FAILED: Read<never> = { isPending: false, error: new Error('down'), data: undefined }

const project = (status: string): OverviewProject => ({ id: `p-${status}`, name: status, status } as unknown as OverviewProject)
const task = (kind: OverviewTask['kind']): OverviewTask => ({ kind, refId: `r-${kind}`, engagementId: 'eng-1', engagementName: null, title: kind, createdAt: '2026-10-24T00:00:00Z', href: 'project/eng-1', awaitingActor: true })
const tasks = (items: OverviewTask[], limited = false): OverviewTaskList => ({ items, limited, stopsLimited: false })
const findings = (byStatus: Record<string, number>, truncated = false): OverviewFindings => ({ total: 0, engagements: 0, engagementsWithFindings: 0, bySeverity: {}, byStatus, unresolvedBySeverity: {}, latestCreatedAt: null, truncated })
const operations = (counts: Record<string, number> | null, truncated = false): OverviewOperations => ({ counts, recent: [], engagements: 0, truncated })

const idle = { projects: READY<OverviewProject[]>([]), operations: READY(operations({})), tasks: READY(tasks([])), findings: READY(findings({})) }
const byId = (reads: Partial<typeof idle>) => Object.fromEntries(overviewMeasures({ ...idle, ...reads }).map((m) => [m.id, m]))

describe('overview measure states', () => {
  it('shows a pending read as Pending and a failed read as Unavailable, never as zero', () => {
    const pending = byId({ tasks: PENDING })['awaiting-decisions']
    expect(pending.state).toBe('pending')
    expect(measureText(pending)).toBe('Pending')
    const failed = byId({ findings: FAILED })['open-curated-findings']
    expect(failed.state).toBe('unavailable')
    expect(measureText(failed)).toBe('Unavailable')
  })

  it('shows zero only when the source confirms zero', () => {
    const confirmed = byId({ tasks: READY(tasks([])) })['awaiting-decisions']
    expect(confirmed.state).toBe('zero')
    expect(measureText(confirmed)).toBe('0')
  })

  it('shows Not recorded when the operations source has no counts', () => {
    const unrecorded = byId({ operations: READY(operations(null)) })['active-operations']
    expect(unrecorded.state).toBe('not-recorded')
    expect(measureText(unrecorded)).toBe('Not recorded')
  })

  it('counts running operations from the recorded counts', () => {
    const running = byId({ operations: READY(operations({ running: 3, planned: 2 })) })['active-operations']
    expect(running.state).toBe('value')
    expect(running.value).toBe(3)
  })
})

describe('overview measure definitions', () => {
  it('counts only the approved, planning, active and running projects', () => {
    const counted = byId({ projects: READY([project('approved'), project('planning'), project('active'), project('running'), project('draft'), project('closed')]) })['active-projects']
    expect(counted.value).toBe(4)
  })

  it('leaves emergency stops and tool approvals out of awaiting decisions', () => {
    const decisions = byId({ tasks: READY(tasks([task('active-stop'), task('c2-grant'), task('finding-review')])) })['awaiting-decisions']
    expect(decisions.value).toBe(2)
  })

  it('counts confirmed, remediation and retest findings and nothing else', () => {
    const open = byId({ findings: READY(findings({ confirmed: 2, remediation: 1, retest: 1, draft: 5, closed: 4 })) })['open-curated-findings']
    expect(open.value).toBe(4)
  })

  it('gives every measure a definition that names what it counts', () => {
    for (const measure of overviewMeasures(idle)) {
      expect(measure.definition.length).toBeGreaterThan(10)
      expect(measure.label.length).toBeGreaterThan(0)
    }
  })
})

describe('overview measures from a limited read', () => {
  it('shows a decision count from a capped task inbox as a lower bound', () => {
    const capped = byId({ tasks: READY(tasks([task('c2-grant')], true)) })['awaiting-decisions']
    expect(capped.limited).toBe(true)
    expect(measureText(capped)).toBe('1+')
  })

  it('shows a count as a lower bound when the operations or findings scan was truncated', () => {
    expect(measureText(byId({ operations: READY(operations({ running: 2 }, true)) })['active-operations'])).toBe('2+')
    expect(measureText(byId({ findings: READY(findings({ confirmed: 3 }, true)) })['open-curated-findings'])).toBe('3+')
  })

  it('shows an exact count when nothing was capped', () => {
    expect(measureText(byId({ tasks: READY(tasks([task('c2-grant')])) })['awaiting-decisions'])).toBe('1')
  })
})
