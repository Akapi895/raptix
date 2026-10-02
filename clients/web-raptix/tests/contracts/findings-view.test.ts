import { expect, it } from 'vitest'
import type { FindingsView, FindingView } from '@raptix/web-contracts'
import { artifactPaths, contentHeader, findingRow, findingRows, formatSize, matchesSearch, severityCounts, toSeverity } from '../../src/features/findings-evidence/findings-view'

const finding: FindingView = {
  engagementId: 'eng', id: 'FIND-2026-001', title: 'Exposed .env', severity: 'critical',
  description: 'The application root exposes a `.env` file.', evidence: 'GET /.env returned 200',
  attackVector: 'Unauthenticated HTTP GET.', affectedAssets: ['api.acme.com/.env', '10.0.1.45:8080'],
  cvssScore: 9.1, cwe: ['CWE-312'], mitre: ['T1552.001'],
  quality: { defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
  rawSource: '# FIND-2026-001', sizeBytes: 512, source: 'workspace',
}

const view = (findings: FindingView[]): FindingsView => ({ engagementId: 'eng', findings, truncated: false, source: 'workspace' })

it('maps informational to the source info severity and keeps labels verbatim otherwise', () => {
  expect(toSeverity('informational')).toBe('info')
  expect(toSeverity('critical')).toBe('critical')
})

it('projects parser-quality flags onto rows instead of presenting defaults as confirmed', () => {
  const row = findingRow(finding)
  expect(row).toMatchObject({ id: 'FIND-2026-001', severity: 'critical', cvss: 9.1, assets: 'api.acme.com/.env', flagged: false })
  const defaulted = findingRow({ ...finding, quality: { ...finding.quality, defaultSeverity: true, placeholderEvidence: true } })
  expect(defaulted.flagged).toBe(true)
  expect(findingRow({ ...finding, affectedAssets: [] }).assets).toBe('—')
})

it('counts severities in the source order and filters by search across title/asset/id', () => {
  const findings = view([finding, { ...finding, id: 'FIND-2', severity: 'informational', title: 'Weak cipher', affectedAssets: ['10.0.1.45:22'] }])
  expect(severityCounts(findings)).toEqual({ critical: 1, high: 0, medium: 0, low: 0, info: 1 })
  const rows = findingRows(findings)
  expect(rows.filter(row => matchesSearch(row, 'env'))).toHaveLength(1)
  expect(rows.filter(row => matchesSearch(row, 'cipher'))).toHaveLength(1)
  expect(rows.filter(row => matchesSearch(row, ''))).toHaveLength(2)
})

it('formats artifact sizes and paths for the evidence browser', () => {
  expect(formatSize(512)).toBe('512 B')
  expect(formatSize(2048)).toBe('2.0 KB')
  const artifacts = { engagementId: 'eng', folders: [{ folder: 'recon', files: [{ name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 2048 }] }], source: 'workspace' as const }
  expect(artifactPaths(artifacts)).toEqual([{ folder: 'recon', name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 2048 }])
  expect(contentHeader({ engagementId: 'eng', path: 'recon/nmap.txt', content: 'ports', mediaType: 'text', sizeBytes: 2048, truncated: false, source: 'workspace' })).toBe('recon/nmap.txt • TEXT • 2.0 KB')
  expect(contentHeader({ engagementId: 'eng', path: 'recon/big.txt', content: 'x', mediaType: 'text', sizeBytes: 300000, truncated: true, source: 'workspace' })).toContain('truncated')
})
