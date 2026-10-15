/**
 * Real findings panel (integration ticket 06, read-only): findings parsed from
 * the engagement workspace plus the artifact inventory/inspector. Parser
 * quality flags, truncation and bounded raw sources render truthfully; the
 * lifecycle mutations belong to ticket 10 and are not offered here.
 */
import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSearch, FileText, FolderOpen, RefreshCw } from 'lucide-react'
import type { ArtifactContentView, FindingView } from '@raptix/web-contracts'
import { fetchArtifactContent, fetchArtifacts, fetchFindings } from '../api'
import { Banner, Button, Card, CardHeader, DescList, Empty, Skeleton, cx } from '../../ui'
import { useRoute } from '../../router/navigate'
import { CaptureUpload } from './capture-upload'

const SEV_TONE: Record<FindingView['severity'], string> = {
  critical: 'border-bad/40 bg-bad-soft text-bad',
  high: 'border-bad/30 bg-bad-soft text-bad',
  medium: 'border-warn/40 bg-warn-soft text-warn',
  low: 'border-line bg-subtle text-muted',
  informational: 'border-line bg-subtle text-neutral',
}

function kib(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`
}

export function RealFindingsPanel({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  const findingId = route.page === 'finding' ? route.id : undefined
  const findings = useQuery({ queryKey: ['real', 'findings', engagementId], queryFn: () => fetchFindings(engagementId) })
  const artifacts = useQuery({ queryKey: ['real', 'artifacts', engagementId], queryFn: () => fetchArtifacts(engagementId) })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Findings" sub="Parsed from the engagement workspace. Quality flags expose parser defaults and placeholders instead of hiding them." />
        {findings.data?.truncated && <Banner tone="warn" title="List truncated">The server projection is incomplete; finding sources may have been skipped.</Banner>}
        {findings.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          : findings.isError ? (
            <div role="alert" className="text-sm text-bad">
              {findings.error instanceof Error ? findings.error.message : 'Findings could not be loaded.'}
              <Button size="sm" variant="secondary" className="ml-3" icon={RefreshCw} onClick={() => void findings.refetch()}>Try again</Button>
            </div>
          ) : findings.data.findings.length === 0 ? (
            <Empty icon={FileSearch} title="No findings recorded">
              A run with no findings renders an honest empty state - nothing is invented to fill the gap.
            </Empty>
          ) : (
            <div className="space-y-3">
              {findingId && !findings.data.findings.some((f) => f.id === findingId) && <p>No workspace finding with this identity; curated claims are listed separately.</p>}
              {findings.data.findings.filter((f) => !findingId || f.id === findingId).map((f) => <FindingRow key={f.id} finding={f} initiallyOpen={!!findingId} />)}
            </div>
          )}
      </Card>

      <Card>
        <CardHeader title="Evidence inventory" sub="Artifacts under the engagement workspace. Content inspection serves text/JSON only; binary previews state their unavailability." />
        {artifacts.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-10" /></div>
          : artifacts.isError ? <p className="text-sm text-bad" role="alert">{artifacts.error instanceof Error ? artifacts.error.message : 'Artifacts could not be loaded.'}</p>
          : artifacts.data.folders.length === 0 ? (
            <p className="text-sm text-muted">No artifacts recorded for this engagement yet.</p>
          ) : (
            <ArtifactBrowser engagementId={engagementId} folders={artifacts.data.folders} initialPath={route.page === 'evidence-inspector' ? route.id : undefined} />
          )}
        <CaptureUpload engagementId={engagementId} />
      </Card>
    </div>
  )
}

function FindingRow({ finding, initiallyOpen = false }: { finding: FindingView; initiallyOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(initiallyOpen)
  const q = finding.quality
  return (
    <div className="rounded-xl border border-line bg-subtle" data-testid={`finding-${finding.id}`}>
      <button className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={cx('inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium uppercase', SEV_TONE[finding.severity])}>{finding.severity}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{finding.title}</span>
        <span className="text-xs text-muted">{finding.attackVector}</span>
        <span className="text-xs text-neutral">{kib(finding.sizeBytes)}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {(q.defaultSeverity || q.placeholderDescription || q.placeholderEvidence || q.unreadable) && (
            <Banner tone="warn" title="Parser quality flags">
              <ul className="list-inside list-disc">
                {q.defaultSeverity && <li>Severity defaulted by the parser (not asserted by the source).</li>}
                {q.placeholderDescription && <li>Description looks like a placeholder.</li>}
                {q.placeholderEvidence && <li>Evidence looks like a placeholder.</li>}
                {q.unreadable && <li>Source file could not be fully read.</li>}
              </ul>
            </Banner>
          )}
          <DescList
            items={[
              { k: 'Finding id', v: <span className="font-mono">{finding.id}</span> },
              { k: 'Affected assets', v: finding.affectedAssets.length === 0 ? 'None recorded' : finding.affectedAssets.join(', ') },
              { k: 'CVSS', v: finding.cvssScore === undefined ? 'Not asserted' : `${finding.cvssScore}${finding.cvssVector ? ` (${finding.cvssVector})` : ''}` },
              { k: 'CWE', v: finding.cwe?.join(', ') ?? 'Not recorded' },
              { k: 'MITRE', v: finding.mitre?.join(', ') ?? 'Not recorded' },
              { k: 'Remediation', v: finding.remediation ?? 'Not recorded' },
              { k: 'Source size', v: kib(finding.sizeBytes) },
            ]}
          />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral">Description</div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{finding.description}</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral">Evidence</div>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line bg-panel p-3 font-mono text-xs text-fg">{finding.evidence}</pre>
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted">Bounded raw source ({kib(finding.sizeBytes)})</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line bg-panel p-3 font-mono text-xs text-neutral">{finding.rawSource}</pre>
          </details>
        </div>
      )}
    </div>
  )
}

function ArtifactBrowser({ engagementId, folders, initialPath }: { engagementId: string; folders: { folder: string; files: { name: string; path: string; sizeBytes: number }[] }[]; initialPath?: string }): ReactElement {
  const [selected, setSelected] = useState<string | null>(initialPath ?? null)
  const content = useQuery({
    queryKey: ['real', 'artifact', engagementId, selected],
    queryFn: () => fetchArtifactContent(engagementId, selected!),
    enabled: !!selected,
    retry: false,
  })
  const view: ArtifactContentView | undefined = content.data

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {folders.map((folder) => (
          <div key={folder.folder}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral"><FolderOpen size={12} aria-hidden />{folder.folder}</div>
            <ul className="mt-1 space-y-1">
              {folder.files.map((file) => (
                <li key={file.path}>
                  <button
                    onClick={() => setSelected(file.path)}
                    aria-current={selected === file.path ? 'true' : undefined}
                    className={cx('flex w-full items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-left text-sm', selected === file.path ? 'border-accent-line bg-accent-soft' : 'border-line hover:bg-hover')}
                  >
                    <FileText size={13} className="shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{file.path}</span>
                    <span className="shrink-0 text-xs text-neutral">{kib(file.sizeBytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div>
        {!selected ? <p className="text-sm text-muted">Select a file to inspect its text content.</p>
          : content.isPending ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-24" /></div>
          : content.isError ? (
            <div role="alert" className="text-sm text-bad">
              {content.error instanceof Error ? content.error.message : 'The artifact content could not be loaded.'}
            </div>
          ) : !view ? <p className="text-sm text-muted">Select a file to inspect its text content.</p>
          : (
            <div data-testid="artifact-viewer">
              <DescList
                items={[
                  { k: 'Path', v: <span className="font-mono break-all">{view.path}</span> },
                  { k: 'Media type', v: view.mediaType },
                  { k: 'Size', v: kib(view.sizeBytes) },
                ]}
              />
              {view.truncated && <Banner tone="warn" title="Content truncated">The server projection returned only the beginning of this file.</Banner>}
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-line bg-panel p-3 font-mono text-xs text-fg">{view.content}</pre>
            </div>
          )}
      </div>
    </div>
  )
}
