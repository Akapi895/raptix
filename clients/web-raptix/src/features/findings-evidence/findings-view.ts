/**
 * W12 findings view-model: pure mapping from the public FindingView contract to
 * the source screen's visual language. `informational` renders as the source
 * `info` severity; parser defaults and placeholders stay explicitly flagged so
 * a parsed default is never presented as analyst-confirmed data.
 */
import type { ArtifactContentView, ArtifactsView, FindingsView, FindingView } from '@raptix/web-contracts'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface FindingRow {
  id: string
  title: string
  severity: Severity
  cvss: number | null
  assets: string
  cwe: string[]
  mitre: string[]
  flagged: boolean
  sizeBytes: number
}

export function toSeverity(severity: FindingView['severity']): Severity {
  return severity === 'informational' ? 'info' : severity
}

export function findingRow(finding: FindingView): FindingRow {
  return {
    id: finding.id,
    title: finding.title,
    severity: toSeverity(finding.severity),
    cvss: finding.cvssScore ?? null,
    assets: finding.affectedAssets[0] ?? '—',
    cwe: finding.cwe ?? [],
    mitre: finding.mitre ?? [],
    flagged: finding.quality.defaultSeverity || finding.quality.placeholderDescription || finding.quality.placeholderEvidence || finding.quality.unreadable,
    sizeBytes: finding.sizeBytes,
  }
}

export function findingRows(view: FindingsView): FindingRow[] {
  return view.findings.map(findingRow)
}

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export function severityCounts(view: FindingsView): Record<Severity, number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<Severity, number>
  for (const finding of view.findings) counts[toSeverity(finding.severity)] += 1
  return counts
}

export function matchesSearch(row: FindingRow, search: string): boolean {
  if (!search) return true
  const needle = search.toLowerCase()
  return row.title.toLowerCase().includes(needle) || row.assets.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function artifactPaths(view: ArtifactsView): { folder: string; name: string; path: string; sizeBytes: number }[] {
  return view.folders.flatMap(folder => folder.files.map(file => ({ folder: folder.folder, name: file.name, path: file.path, sizeBytes: file.sizeBytes })))
}

export function contentHeader(content: ArtifactContentView): string {
  const size = formatSize(content.sizeBytes)
  return `${content.path} • ${content.mediaType.toUpperCase()} • ${size}${content.truncated ? ' • truncated to first 256 KB' : ''}`
}
