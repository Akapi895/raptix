/**
 * Real reports panel (integration ticket 11): draft/edit with version
 * conflicts, independent version-pinned review with mandatory comments and
 * separate audited export/delivery records. Refusals preserve the form.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { createReport, fetchReports } from '../api'
import { go, useRoute } from '../../router/navigate'
import { RealReportEditor } from './report-editor'
import { Button, Card, CardHeader, Input, Skeleton, Status, Textarea } from '../../ui'

export function RealReportsPanel({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['real', 'report-records', engagementId], queryFn: () => fetchReports(engagementId) })
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'report-records', engagementId] })
  }

  const create = useMutation({
    mutationFn: () => createReport(engagementId, { title, summary }),
    onSuccess: () => { setTitle(''); setSummary(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The save was refused â€” your draft is preserved.'),
  })

  if (list.isPending) {
    return <Card><CardHeader title="Reports" /><div className="p-4"><Skeleton className="h-20" /></div></Card>
  }
  if (list.isError || !list.data) {
    return <p className="text-sm text-bad" role="alert">Reports unavailable: {list.error instanceof Error ? list.error.message : 'read failed'}</p>
  }
  if (route.id && ['report', 'report-review', 'report-preview'].includes(route.page)) {
    const report = list.data.reports.find((r) => r.id === route.id)
    return report ? <RealReportEditor key={`${report.id}/${report.version}/${report.status}`} report={report} preview={route.page === 'report-preview'} /> : <p role="alert">Report not found in this engagement.</p>
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Reports" sub="Independent review pins a version; export and delivery are separate audited records" />
        <div className="p-4">
          {list.data.reports.length === 0 ? (
            <p className="text-sm text-muted">No reports yet. Create a draft from the confirmed findings.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Version</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Review</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.reports.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-fg">{r.title}</span>
                      <div className="text-xs text-muted">{r.body.summary}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">v{r.version}{r.approvedVersion !== null ? ` (pinned v${r.approvedVersion})` : ''}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={r.status === 'approved' || r.status === 'delivered' ? 'passed' : r.status === 'changes_requested' ? 'failed' : 'pending'} size="sm" label={r.status} /></td>
                    <td className="py-2 pr-3 text-xs text-muted">{r.reviewedBy === null ? 'â€”' : `${r.reviewedBy}: ${r.reviewComment ?? ''}`}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                         <Button variant="ghost" onClick={() => go('report', { id: r.id, engagementId })}>Open editor / review</Button>
                         <Button variant="ghost" onClick={() => go('report-preview', { id: r.id, engagementId })}>Preview</Button>
                      </span>
                      {r.deliveries.length > 0 ? (
                        <div className="mt-1 text-xs text-muted">{r.deliveries.map((d) => `${d.kind}/${d.format}: ${d.status}`).join(' Â· ')}</div>
                      ) : null}
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
            <label className="text-sm text-muted" htmlFor="report-title">New report title</label>
            <Input id="report-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            <label className="text-sm text-muted" htmlFor="report-summary">Summary</label>
            <Textarea id="report-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" icon={FileText} disabled={create.isPending}>
                {create.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                Create draft report
              </Button>
            </div>
          </form>
          {error !== null && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
        </div>
      </Card>
    </div>
  )
}
