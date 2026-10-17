/**
 * Frontend-owned registry of controls and sections the real backend cannot
 * back yet (ADR-0084 tier 2). Entries mean "no backend concept exists", not
 * "temporarily unavailable"; they are never driven by CapabilitiesDocument.
 */
export const REAL_CONTROL_GAPS: Readonly<Record<string, string>> = {
  'evidence.original': 'Original bytes are unavailable for legacy evidence references that do not identify a classified retained capture.',
  'evidence.integrity': 'Legacy evidence references have no retained capture digest to verify.',
  'report.pdfDocx': 'PDF and DOCX export are not produced by the console yet; the report is not exported.',
}
