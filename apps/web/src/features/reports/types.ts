export type ReportType =
  | 'Full Technical'
  | 'Executive Summary'
  | 'Remediation Playbook'
  | 'Attestation Certificate'

export type ReportStatus = 'Draft' | 'In Review' | 'Approved' | 'Delivered'

export interface ReportMeta {
  id: string
  title: string
  type: ReportType
  status: ReportStatus
  framework: string
  author: string
  modified: string
  pages: number
  words: number
}

export interface ReportSectionDef {
  num: string
  title: string
  sub: string[]
}

export type PhaseState = 'completed' | 'active' | 'pending'

export type SectionBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'note'; tone: 'info' | 'success'; title?: string; text: string }
  | { kind: 'riskScore'; level: string; cvss: string }
  | { kind: 'table'; columns: string[]; rows: string[][]; severityColorColumns?: number[] }
  | { kind: 'phases'; items: { state: PhaseState; title: string; text: string }[] }
  | { kind: 'code'; code: string }
  | { kind: 'steps'; items: { action: string; effort: string; impact: string }[] }

export interface ReportDocumentDef {
  classification: string
  sections: { def: ReportSectionDef; blocks: SectionBlock[] }[]
}
