/**
 * Real finding curation (integration ticket 10): author/import curated
 * records below the runtime findings read, progress the lifecycle and attach
 * opaque evidence. Producer evidence (ticket 06 reads) is never overwritten;
 * AI claims import as unverified drafts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { ClipboardList, Loader2 } from 'lucide-react'
import { attachEvidence, createCuratedFinding, fetchCuratedFindings, transitionCuratedFinding } from '../api'
import { Button, Card, CardHeader, Input, Select, Skeleton, Status, Textarea } from '../../ui'

export function RealCurationPanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['real', 'curated-findings', engagementId], queryFn: () => fetchCuratedFindings(engagementId) })
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'curated-findings', engagementId] })
  }

  const create = useMutation({
    mutationFn: () => createCuratedFinding(engagementId, { title, severity, detail }),
    onSuccess: () => { setTitle(''); setDetail(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The save was refused.'),
  })
  const transition = useMutation({
    mutationFn: (input: { id: string; to: string }) => transitionCuratedFinding(engagementId, input.id, input.to),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The transition was refused.'),
  })
  const attach = useMutation({
    mutationFn: (input: { id: string; artifactPath: string }) => attachEvidence(engagementId, input.id, { kind: 'artifact', artifactPath: input.artifactPath, producer: 'web:manual' }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The evidence was refused.'),
  })

  if (list.isPending) {
    return <Card><CardHeader title="Curation" /><div className="p-4"><Skeleton className="h-20" /></div></Card>
  }
  if (list.isError || !list.data) {
    return <p className="text-sm text-bad" role="alert">Curation data unavailable: {list.error instanceof Error ? list.error.message : 'read failed'}</p>
  }

  return (
    <Card>
      <CardHeader title="Curated findings" sub="Web workflow records bound to producer lineage; runtime evidence stays untouched" />
      <div className="p-4">
        {list.data.findings.length === 0 ? (
          <p className="text-sm text-muted">No curated findings yet. Author one or import a runtime claim as an unverified draft.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Title</th>
                <th className="pb-2">Severity</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Evidence</th>
                <th className="pb-2">Transition</th>
              </tr>
            </thead>
            <tbody>
              {list.data.findings.map((f) => (
                <tr key={f.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-fg">{f.title}</span>
                    <span className="ml-2 font-mono text-xs text-muted">v{f.expectedVersion}{f.sourceType === 'imported' ? ` · ${f.producerRef ?? ''}` : ''}</span>
                  </td>
                  <td className="py-2 pr-3">{f.severity}</td>
                  <td className="py-2 pr-3"><Status kind="gate" value={f.status === 'confirmed' || f.status === 'resolved' ? 'passed' : f.status === 'draft' ? 'pending' : 'review'} size="sm" label={f.status} /></td>
                  <td className="py-2 pr-3 text-xs text-muted">
                    {f.evidence.length === 0 ? '—' : `${f.evidence.length} ref(s)`}
                    <form
                      className="mt-1 flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const input = (e.currentTarget.elements.namedItem('path') as HTMLInputElement)
                        if (input.value.trim().length > 0) {
                          attach.mutate({ id: f.id, artifactPath: input.value.trim() })
                          input.value = ''
                        }
                      }}
                    >
                      <input name="path" aria-label={`Evidence artifact path for ${f.title}`} placeholder="findings/FIND-1.md" className="h-8 w-40 rounded-[10px] border border-line bg-panel px-2 text-xs text-fg" />
                      <Button type="submit" variant="ghost">Attach</Button>
                    </form>
                  </td>
                  <td className="py-2">
                    {(list.data.transitions[f.status] ?? []).length === 0 ? (
                      <span className="text-xs text-muted">terminal</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {list.data.transitions[f.status].map((to) => (
                          <Button key={to} variant="ghost" onClick={() => transition.mutate({ id: f.id, to })}>{to}</Button>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <label className="text-sm text-muted" htmlFor="curated-title">New finding title</label>
          <Input id="curated-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="text-sm text-muted" htmlFor="curated-severity">Severity</label>
          <Select id="curated-severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['critical', 'high', 'medium', 'low', 'informational'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <label className="text-sm text-muted" htmlFor="curated-detail">Detail</label>
          <Textarea id="curated-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" icon={ClipboardList} disabled={create.isPending}>
              {create.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Create draft finding
            </Button>
          </div>
        </form>
        {error !== null && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
      </div>
    </Card>
  )
}
