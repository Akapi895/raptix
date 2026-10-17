/** Versioned report editing, explicit review, setup readiness and recipient acknowledgement. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ReactElement } from 'react'
import { acknowledgeReportDelivery, decideReportReview, deliverReport, exportReport, reviseReport, updateReport, type ReportTemplateView, type ReportView } from '../api'
import { useDirty } from '../../state/session'
import { Banner, Button, Card, CardHeader, Input, Textarea } from '../../ui'
import { RealReportSetup } from './report-setup'

/** Triggers a real browser download of the exact artifact bytes. */
function downloadArtifact(artifact: { reportId: string; version: number; mediaType: string; content: string }): void {
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }))
  const link = document.createElement('a')
  link.href = url
  link.download = `report-${artifact.reportId}-v${artifact.version}.md`
  link.click()
  URL.revokeObjectURL(url)
}

export function RealReportEditor({ report, templates = [], preview = false }: { report: ReportView; templates?: ReportTemplateView[]; preview?: boolean }): ReactElement {
  const client = useQueryClient()
  const [title, setTitle] = useState(report.title)
  const [summary, setSummary] = useState(report.body.summary)
  const [sections, setSections] = useState(report.body.sections)
  const [comment, setComment] = useState('')
  const [recipient, setRecipient] = useState('')
  const [receipt, setReceipt] = useState('')
  const [ackReceipt, setAckReceipt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const requestIds = useRef(new Map<string, string>())
  const dirty = title !== report.title || summary !== report.body.summary || JSON.stringify(sections) !== JSON.stringify(report.body.sections)
  // W21: the modal's Save Draft must call a real save with an awaited outcome.
  const saveDraft = async (): Promise<void> => {
    await updateReport(report.engagementId, report.id, { expectedVersion: report.version, title, summary, sections })
    void client.invalidateQueries({ queryKey: ['real', 'report-records', report.engagementId] })
  }
  useDirty(dirty, dirty ? saveDraft : undefined)
  const action = useMutation({
    mutationFn: async (kind: 'save' | 'submit' | 'approved' | 'changes_requested' | 'export' | 'delivery' | 'revision') => {
      if (kind === 'save') return updateReport(report.engagementId, report.id, { expectedVersion: report.version, title, summary, sections })
      if (kind === 'submit') return decideReportReview(report.engagementId, report.id, { action: 'submit' })
      if (kind === 'approved' || kind === 'changes_requested') return decideReportReview(report.engagementId, report.id, { decision: kind, comment, expectedVersion: report.version })
      if (kind === 'revision') return reviseReport(report.engagementId, report.id, { expectedVersion: report.version })
      // W20: a reader downloads through the read export contract (a second
      // read could otherwise differ); only the editor records an audited
      // delivery-carrying export.
      if (kind === 'export' && preview) {
        const artifact = await exportReport(report.engagementId, report.id, 'markdown')
        downloadArtifact(artifact)
        return artifact
      }
      const key = `${kind}/${report.version}`
      const requestId = requestIds.current.get(key) ?? crypto.randomUUID()
      requestIds.current.set(key, requestId)
      const updated = await deliverReport(report.engagementId, report.id, { kind, format: 'markdown', requestId, expectedVersion: report.version, recipient, receipt })
      if (kind === 'export') downloadArtifact(updated.artifact)
      return updated
    },
    onSuccess: () => { setError(null); void client.invalidateQueries({ queryKey: ['real', 'report-records', report.engagementId] }); void client.invalidateQueries({ queryKey: ['real', 'tasks'] }) },
    onError: (err) => setError(err.message),
  })
  // P07: the acknowledgement is its own request with a stable id, so a lost response can be replayed safely.
  const acknowledge = useMutation({
    mutationFn: (deliveryId: string) => {
      const key = `ack/${deliveryId}`
      const requestId = requestIds.current.get(key) ?? crypto.randomUUID()
      requestIds.current.set(key, requestId)
      return acknowledgeReportDelivery(report.engagementId, report.id, deliveryId, { requestId, receipt: ackReceipt })
    },
    onSuccess: () => { setError(null); void client.invalidateQueries({ queryKey: ['real', 'report-records', report.engagementId] }) },
    onError: (err) => setError(err.message),
  })
  const editable = !preview && ['draft', 'changes_requested'].includes(report.status)
  const awaitingAcknowledgement = report.deliveries.find((d) => d.kind === 'delivery' && d.status === 'completed' && d.acknowledgement === null)
  return <Card><CardHeader title={report.title} sub={`v${report.version} · ${report.status}${report.approvedVersion ? ` · approved v${report.approvedVersion}` : ''}`} />
    <div className="space-y-3">
      {preview ? <><p className="whitespace-pre-wrap">{summary}</p>{sections.map((section, i) => <section key={i}><h2>{section.title}</h2><p className="whitespace-pre-wrap">{section.content}</p></section>)}</> : <>
        <label className="block">Title<Input value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block">Summary<Textarea value={summary} disabled={!editable} onChange={(e) => setSummary(e.target.value)} /></label>
        {sections.map((section, i) => <div className="space-y-2" key={i}>
          <label>Section {i + 1} title<Input disabled={!editable} value={section.title} onChange={(e) => setSections(sections.map((s, n) => n === i ? { ...s, title: e.target.value } : s))} /></label>
          <label>Section {i + 1} content<Textarea disabled={!editable} value={section.content} onChange={(e) => setSections(sections.map((s, n) => n === i ? { ...s, content: e.target.value } : s))} /></label>
        </div>)}
        {editable && <div className="flex gap-2"><Button onClick={() => setSections([...sections, { title: '', content: '' }])}>Add section</Button><Button disabled={!dirty || action.isPending} onClick={() => action.mutate('save')}>Save report</Button><Button disabled={dirty || action.isPending || !report.readiness.ready} onClick={() => action.mutate('submit')}>Submit for review</Button></div>}
        {report.status === 'in_review' && <><label className="block">Review comment<Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></label><Button disabled={!comment.trim() || action.isPending} onClick={() => action.mutate('approved')}>Approve this version</Button><Button disabled={!comment.trim() || action.isPending} onClick={() => action.mutate('changes_requested')}>Request changes</Button></>}
      </>}
      {!preview && <RealReportSetup key={`${report.id}/${report.version}`} report={report} templates={templates} />}
      <Button disabled={dirty || action.isPending} onClick={() => action.mutate('export')}>Download report Markdown</Button>
      {(report.status === 'approved' || report.status === 'delivered') && !preview && (
        <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate('revision')}>Start a revision</Button>
      )}
      {report.status === 'approved' && !preview && <>
        <Banner tone="info" title="Manual delivery record">This records a delivery you performed. It does not send email or transmit the report. Recipient acknowledgement is recorded separately after delivery.</Banner>
        <label className="block">Recipient<Input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label>
        <label className="block">Delivery receipt<Input value={receipt} onChange={(e) => setReceipt(e.target.value)} /></label>
        <Button disabled={!recipient.trim() || !receipt.trim() || action.isPending} onClick={() => action.mutate('delivery')}>Record delivery</Button>
      </>}
      {awaitingAcknowledgement && !preview && <>
        <Banner tone="info" title="Recipient acknowledgement">Record the acknowledgement the recipient gave for the delivery of {awaitingAcknowledgement.createdAt}.</Banner>
        <label className="block">Acknowledgement receipt<Input value={ackReceipt} onChange={(e) => setAckReceipt(e.target.value)} /></label>
        <Button disabled={!ackReceipt.trim() || acknowledge.isPending} onClick={() => acknowledge.mutate(awaitingAcknowledgement.id)}>Record acknowledgement</Button>
      </>}
      {report.reviewComment && <p>Review: {report.reviewComment}</p>}
      <ul>{report.deliveries.map((d) => <li key={d.id}>
        {d.kind} / {d.format}: {d.status} · {d.createdAt}
        {d.recordedReceipt && <> · recorded at delivery: {d.recordedReceipt.receipt} (not an acknowledgement)</>}
        {d.acknowledgement && <> · acknowledged {d.acknowledgement.createdAt}: {d.acknowledgement.receipt}</>}
      </li>)}</ul>
      {error && <p role="alert" className="text-bad">{error} Your draft is preserved.</p>}
    </div>
  </Card>
}
