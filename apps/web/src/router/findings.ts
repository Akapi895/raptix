/** Route aliases for the shared Findings and Evidence presentation. */
import type { ComponentType } from 'react'
import { EvidenceInspector, FindingDetail, FindingForm, FindingsPage } from '../features/findings'

export const findingRoutes: Record<string, ComponentType> = {
  findings: FindingsPage,
  'finding-new': FindingForm,
  finding: FindingDetail,
  evidence: EvidenceInspector,
  'evidence-inspector': EvidenceInspector,
}
