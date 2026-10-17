/* eslint-disable react-hooks/rules-of-hooks -- mode branches are keyed on the module-constant DATA_MODE */
/** Finding form and attachment choices are service-scoped relationships. */
import type { Asset, Evidence, Finding, Operation, Project, Report } from '../../domain/entities'
import { projectAccessible } from '../../auth/policy'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'
import { DATA_MODE } from '../../real/mode'
import { usePolicyProjects } from '../../state/console'
import { useReportList } from '../reports/query'

export interface FindingFormRead { findings: Finding[]; projects: Project[]; assets: Asset[]; operations: Operation[]; evidence: Evidence[] }

export function readFindingForm(services: ConsoleServices, ctx: RequestContext, id?: string): FindingFormRead {
  return projectView(services, ctx, `finding-form:${id || ''}`, (db) => {
    const projects = db.projects.filter((p) => projectAccessible(p, ctx.actor))
    const finding = db.findings.find((f) => f.id === id && projects.some((p) => p.id === f.projectId))
    const addressed = { ...ctx, projectId: finding?.projectId || ctx.projectId }
    return { findings: finding ? [finding] : [], projects, assets: scopedRows(db, addressed, db.assets), operations: scopedRows(db, addressed, db.operations), evidence: scopedRows(db, addressed, db.evidence) }
  })
}

export function readFindingReports(services: ConsoleServices, ctx: RequestContext): { reports: Report[] } {
  return projectView(services, ctx, 'finding-report-choices', (db) => ({ reports: scopedRows(db, ctx, db.reports).filter((r) => ['draft', 'returned'].includes(r.status)) }))
}

export function readFindingEvidence(services: ConsoleServices, ctx: RequestContext): { evidence: Evidence[] } {
  return projectView(services, ctx, 'finding-evidence-choices', (db) => ({ evidence: scopedRows(db, ctx, db.evidence) }))
}

export function useFindingFormRead(id?: string): FindingFormRead {
  if (DATA_MODE === 'real') return { findings: [], projects: usePolicyProjects(), assets: [], operations: [], evidence: [] }
  return useServiceProjection((services, ctx) => readFindingForm(services, ctx, id))
}
export function useFindingReportChoices(): { reports: Report[] } {
  // Real mode reads the reports through the same list the report screens use, so inclusion and the add-to-report choices agree with them.
  if (DATA_MODE === 'real') {
    const list = useReportList({})
    return { reports: (list.data?.items ?? []).map((item) => item.report) }
  }
  return useServiceProjection(readFindingReports, 'all')
}
export function useFindingEvidenceChoices(projectId: string): { evidence: Evidence[] } {
  if (DATA_MODE === 'real') return { evidence: [] }
  return useServiceProjection(readFindingEvidence, projectId)
}
