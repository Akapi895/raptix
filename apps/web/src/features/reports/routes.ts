import type { ComponentType } from 'react'
import { ReportsPage } from './views/list'
import { ReportEditor, ReportNew, ReportPreview, ReportReview } from './views/report-pages'

/** The reports route group: the list and the report screens, mounted by the router registry. */
export const routes: Record<string, ComponentType> = {
  reports: ReportsPage,
  'report-new': ReportNew,
  report: ReportEditor,
  'report-preview': ReportPreview,
  'report-review': ReportReview,
}
