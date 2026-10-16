/**
 * Frontend-owned registry of controls and sections the real backend cannot
 * back yet (ADR-0084 tier 2). Entries mean "no backend concept exists", not
 * "temporarily unavailable"; they are never driven by CapabilitiesDocument.
 */
export const REAL_CONTROL_GAPS: Readonly<Record<string, string>> = {
  'finding.aiSuggestion': 'AI suggestions are producer findings in the workspace; the curated workflow has no suggestion queue yet.',
  'finding.comments': 'Finding comments have no real backend store yet.',
  'finding.transitionNote': 'The curated workflow does not store transition notes yet.',
  'finding.severityRationale': 'The severity rationale is not stored by the curated workflow yet.',
  'finding.scopeNote': 'The conditions or scope of impact field is not stored by the curated workflow yet.',
  'finding.impact': 'The curated finding has no impact field yet.',
  'finding.recommendation': 'The curated finding has no recommendation field yet.',
  'finding.assetLink': 'Findings are not linked to assets in the curated workflow yet.',
  'finding.operationLink': 'Findings are not linked to operations in the curated workflow yet.',
  'finding.techniqueLink': 'Findings are not linked to techniques in the curated workflow yet.',
  'finding.evidenceLink': 'Evidence links use artifact references that the mock evidence records do not map to yet.',
  'finding.evidenceUpload': 'Evidence bytes are not accepted by the curated finding API yet.',
  'finding.retestRecord': 'Retest results are not stored separately; only the resolved transition exists.',
  'finding.reportLink': 'Adding a finding to a report is not part of the curated finding API yet.',
  'evidence.preview': 'Evidence content is not served by the console yet; no preview is shown.',
  'evidence.original': 'Original evidence content is not served by the console yet.',
  'evidence.integrity': 'The console does not compute or verify capture digests yet.',
  'evidence.download': 'Evidence download is not served by the console yet.',
  'finding.reportInclusion': 'The report model does not record which findings a report includes yet.',
  'finding.reviewerHistory': 'Reviewer decisions and change history are not recorded by the curated workflow yet.',
  'report.findingLink': 'The report workflow does not link findings to a report yet.',
  'report.pdfDocx': 'PDF and DOCX export are not produced by the console yet; the report is not exported.',
  'report.acknowledge': 'Recipient acknowledgement is not a separate step in the report workflow; the delivery receipt is recorded at delivery.',
  'report.checks': 'Readiness checks (scope, evidence, findings, template) are not computed by the report workflow yet; the server still enforces each transition.',
  'report.template': 'Templates, a named reviewer and a reporting period are not stored by the report workflow yet. The draft is created with its title; the reviewer is chosen in the review step.',
  'report.projectInfo': 'The engagement record has no scope window or ROE version yet, so project details cannot be inserted into the report.',
  'finding.auditTrail': 'Finding audit entries are not projected into the console yet.',
}
