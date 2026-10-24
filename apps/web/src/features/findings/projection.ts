import type { Asset, Evidence, Finding, Operation, Project, Report } from '../../domain/entities'
import { usePolicyProjects } from '../../state/console'
import { useReportList } from '../reports'
export interface FindingFormRead { findings: Finding[]; projects: Project[]; assets: Asset[]; operations: Operation[]; evidence: Evidence[] }
export function useFindingFormRead(): FindingFormRead {
  return { findings: [], projects: usePolicyProjects(), assets: [], operations: [], evidence: [] }
}
export function useFindingReportChoices(): { reports: Report[] } {
  // Real mode reads the reports through the same list the report screens use, so inclusion and the add-to-report choices agree with them.
  const list = useReportList({})
    return { reports: (list.data?.items ?? []).map((item) => item.report) }
}
