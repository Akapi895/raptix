/**
 * Frontend-owned registry of controls and sections the real backend cannot
 * back yet (ADR-0084 tier 2). Entries mean "no backend concept exists", not
 * "temporarily unavailable"; they are never driven by CapabilitiesDocument.
 */
export const REAL_CONTROL_GAPS: Readonly<Record<string, string>> = {
  'finding.evidenceLink': 'Evidence links use artifact references that the mock evidence records do not map to yet.',
  'finding.reportLink': 'Adding a finding to a report is not part of the curated finding API yet.',
  'evidence.original': 'Original bytes are unavailable for legacy evidence references that do not identify a classified retained capture.',
  'evidence.integrity': 'Legacy evidence references have no retained capture digest to verify.',
  'finding.reportInclusion': 'The report model does not record which findings a report includes yet.',
  'report.pdfDocx': 'PDF and DOCX export are not produced by the console yet; the report is not exported.',
  'report.projectInfo': 'The engagement record has no scope window or ROE version yet, so project details cannot be inserted into the report.',
  'finding.auditTrail': 'Finding audit entries are not projected into the console yet.',
}
