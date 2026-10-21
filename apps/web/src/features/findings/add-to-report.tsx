import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { Finding } from '../../domain/entities'
import { go } from '../../router/navigate'
import { useSessionStore } from '../../state/session'
import { useToastStore } from '../../state/stores'
import { Button, Modal, Mono } from '../../ui/index'
import { useReportWrites } from '../reports'

/**
 * "Add to Report" dialog of a finding. Both modes add the finding through the report's findings write, sending the
 * version the choice was read at; a report that already holds the finding is only opened.
 */
export function AddToReport({ open, onClose, f, reports }: { open: boolean; onClose: () => void; f: Finding; reports: { id: string; title: string; version: string; status: string; findings: string[] }[] }) {
  const toast = useToastStore((s) => s.toast)
  const setFilter = useSessionStore((s) => s.setFilter)
  const reportWrites = useReportWrites()
  const queryClient = useQueryClient()
  const addTo = async (r: { id: string; version: string; findings: string[] }, has: boolean) => {
    if (!has) {
      const res = await reportWrites.setFindings(r.id, [...r.findings, f.id], Number(r.version.replace(/^v/, '')))
      if (!res.ok) { toast(res.failure.message, 'warn'); return }
      void queryClient.invalidateQueries({ queryKey: ['report'] })
    }
    toast(has ? `${f.id} is already in ${r.id}.` : `Added ${f.id} to ${r.id}.`)
    onClose()
    go('report', { id: r.id })
  }
  return (
    <Modal open={open} onClose={onClose} title="Add finding to report" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-muted">Only editable reports in the same project <Mono>{f.projectId}</Mono> are shown.</p>
      {reports.length === 0 ? <div className="mb-4 rounded-lg border border-dashed border-line p-4 text-sm text-muted">There are no draft reports in this project yet.</div> : (
        <ul className="mb-4 space-y-2">
          {reports.map((r) => {
            const has = r.findings.includes(f.id)
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.title}</div><div className="text-xs text-muted"><Mono>{r.id}</Mono> · {r.version} · {r.findings.length} finding(s)</div></div>
                <Button size="sm" variant="primary" onClick={() => { void addTo(r, has) }}>{has ? 'Open report' : 'Add'}</Button>
              </li>
            )
          })}
        </ul>
      )}
      <Button icon={Plus} onClick={() => { setFilter('report-prefill', { projectId: f.projectId, findings: [f.id] }); onClose(); go('report-new') }}>Create a new report with this finding</Button>
    </Modal>
  )
}
