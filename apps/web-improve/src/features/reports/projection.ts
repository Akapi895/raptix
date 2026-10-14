/** Synchronous report validation and source counts complement editor/catalog Query reads. */
import type { Report } from '../../domain/entities'
import { projectAccessible } from '../../auth/policy'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'
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

export function useReportValidation(): ReportValidationRead { return useServiceProjection(readReportValidation) }
export function useReportSourceCounts(): { operations: number; evidence: number } { return useServiceProjection(readReportSources) }
export function useReportExclusions(projectId?: string): { findings: { id: string; projectId: string }[] } { return useServiceProjection(readReportExclusions, projectId) }
