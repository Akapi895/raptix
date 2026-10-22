/** Synchronous report validation and source counts complement editor/catalog Query reads. */
import type { Report } from '../../domain/entities'
import { projectAccessible } from '../../domain/policy'
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'
import { DATA_MODE } from '../../state/mode'
import { closureEvidence, reportChecks, type NoFind, type RCheck } from './service';

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

/* Real mode: the checks are the server's own readiness for this report (evidence integrity, template sections, period, reviewer). A report without that readiness shows one pending check, never an empty list that would read as ready. */
const NO_REAL_CHECKS: ReportValidationRead = {
  checks: (report) => report.readiness
    ? report.readiness.checks.map((check) => ({ id: check.id, label: check.label, state: check.state === 'pass' ? 'pass' : check.state === 'fail' ? 'fail' : 'warn', detail: check.detail }))
    : [{ id: 'server-readiness', label: 'Readiness is checked by the server', state: 'warn', detail: 'Readiness has not been read for this report yet.' }],
  closure: () => ({ ops: [], run: [], ev: [] }),
}

/* Real mode reads no source counts and no AI exclusions; the hooks return null and the screens omit those values rather than show zeros or an empty list. */
/* eslint-disable react-hooks/rules-of-hooks -- mode branches are keyed on the module-constant DATA_MODE */
export function useReportValidation(): ReportValidationRead {
  if (DATA_MODE === 'real') return NO_REAL_CHECKS
  return useServiceProjection(readReportValidation)
}
export function useReportSourceCounts(): { operations: number; evidence: number } | null {
  if (DATA_MODE === 'real') return null
  return useServiceProjection(readReportSources)
}
export function useReportExclusions(projectId?: string): { findings: { id: string; projectId: string }[] } | null {
  if (DATA_MODE === 'real') return null
  return useServiceProjection(readReportExclusions, projectId)
}
