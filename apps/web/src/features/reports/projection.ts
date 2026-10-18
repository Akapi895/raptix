/** Synchronous report validation and source counts complement editor/catalog Query reads. */
import type { Report } from '../../domain/entities'
import { projectAccessible } from '../../auth/policy'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'
import { DATA_MODE } from '../../real/mode'
import { closureEvidence, reportChecks, type NoFind, type RCheck } from './service'

export interface ReportValidationRead {
  checks(report: Report, nf?: NoFind): RCheck[]
  closure(projectId: string): ReturnType<typeof closureEvidence>
}

export function readReportValidation(services: ConsoleServices, ctx: RequestContext): ReportValidationRead {
  return projectView(services, ctx, 'report-validation', (db) => {
    const allowed = (id: string): boolean => projectAccessible(db.projects.find((p) => p.id === id), ctx.actor) && (!ctx.projectId || ctx.projectId === 'all' || ctx.projectId === id)
    return {
      checks: (report, nf) => allowed(report.projectId) ? reportChecks(db, report, nf) : [{ id: 'scope', label: 'Project access required', state: 'fail', detail: 'This report is outside the current project scope.' }],
      closure: (id) => allowed(id) ? closureEvidence(db, id) : { ops: [], run: [], ev: [] },
    }
  })
}

export function readReportSources(services: ConsoleServices, ctx: RequestContext): { operations: number; evidence: number } {
  return projectView(services, ctx, 'report-source-counts', (db) => ({ operations: scopedRows(db, ctx, db.operations).length, evidence: scopedRows(db, ctx, db.evidence).length }))
}

export function readReportExclusions(services: ConsoleServices, ctx: RequestContext): { findings: { id: string; projectId: string }[] } {
  return projectView(services, ctx, 'report-ai-exclusions', (db) => ({ findings: scopedRows(db, ctx, db.findings).filter((f) => f.status === 'ai_suggested').map(({ id, projectId }) => ({ id, projectId })) }))
}

/* Real mode has no client-side readiness: the server evaluates evidence, template sections, period and reviewer when the draft is submitted, and its refusal is shown in full. An empty list would read as "ready", so the check says it is pending. */
const NO_REAL_CHECKS: ReportValidationRead = {
  checks: () => [{ id: 'server-readiness', label: 'Readiness is checked by the server', state: 'warn', detail: 'Evidence integrity, template sections, the reporting period and the reviewer are checked when you submit. The server refusal is shown in full.' }],
  closure: () => ({ ops: [], run: [], ev: [] }),
}

/* Real mode: the readiness checks and source counts come from the mock database and are not available; the screens show the registered gap instead of these values. */
/* eslint-disable react-hooks/rules-of-hooks -- mode branches are keyed on the module-constant DATA_MODE */
export function useReportValidation(): ReportValidationRead {
  if (DATA_MODE === 'real') return NO_REAL_CHECKS
  return useServiceProjection(readReportValidation)
}
export function useReportSourceCounts(): { operations: number; evidence: number } {
  if (DATA_MODE === 'real') return { operations: 0, evidence: 0 }
  return useServiceProjection(readReportSources)
}
export function useReportExclusions(projectId?: string): { findings: { id: string; projectId: string }[] } {
  if (DATA_MODE === 'real') return { findings: [] }
  return useServiceProjection(readReportExclusions, projectId)
}
