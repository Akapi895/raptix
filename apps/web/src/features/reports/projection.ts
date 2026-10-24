import type { Evidence, Operation, Report } from '../../domain/entities'
import type { NoFind, RCheck } from './service';
export interface ReportValidationRead {
  checks(report: Report, nf?: NoFind): RCheck[]
  closure(projectId: string): { ops: Operation[]; run: Operation[]; ev: Evidence[] }
}
const NO_REAL_CHECKS: ReportValidationRead = {
  checks: (report) => report.readiness
    ? report.readiness.checks.map((check) => ({ id: check.id, label: check.label, state: check.state === 'pass' ? 'pass' : check.state === 'fail' ? 'fail' : 'warn', detail: check.detail }))
    : [{ id: 'server-readiness', label: 'Readiness is checked by the server', state: 'warn', detail: 'Readiness has not been read for this report yet.' }],
  closure: () => ({ ops: [], run: [], ev: [] }),
}
export function useReportValidation(): ReportValidationRead {
  return NO_REAL_CHECKS
}
export function useReportSourceCounts(): { operations: number; evidence: number } | null {
  return null
}
export function useReportExclusions(): { findings: { id: string; projectId: string }[] } | null {
  return null
}
