/** P06: template, reporting period, named reviewer and pinned findings for a draft report, with server readiness checks. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { createReportTemplate, fetchCuratedFindings, fetchMembers, setReportFindings, updateReportSetup, type ReportTemplateView, type ReportView } from '../api'
import { Button, Card, CardHeader, Input, Textarea } from '../../ui'

/** Only confirmed-or-later findings may be reported; the server enforces the same rule. */
const REPORTABLE_STATUSES = ['confirmed', 'remediation', 'retest', 'resolved']

export function RealReportSetup({ report, templates }: { report: ReportView; templates: ReportTemplateView[] }): ReactElement {
  const client = useQueryClient()
  const editable = report.status === 'draft' || report.status === 'changes_requested'
  const members = useQuery({ queryKey: ['real', 'report-setup', 'members', report.engagementId], queryFn: () => fetchMembers(report.engagementId), enabled: editable })
  const findings = useQuery({ queryKey: ['real', 'report-setup', 'findings', report.engagementId], queryFn: () => fetchCuratedFindings(report.engagementId), enabled: editable })
  const [templateId, setTemplateId] = useState(report.templateId ?? '')
  const [periodStart, setPeriodStart] = useState(report.period?.start.slice(0, 10) ?? '')
  const [periodEnd, setPeriodEnd] = useState(report.period?.end.slice(0, 10) ?? '')
  const [reviewerId, setReviewerId] = useState(report.reviewerId ?? '')
  const [selected, setSelected] = useState<string[]>(report.selectedFindings.map((finding) => finding.findingId))
  const [templateName, setTemplateName] = useState('')
  const [templateSections, setTemplateSections] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = (): void => { void client.invalidateQueries({ queryKey: ['real', 'report-records', report.engagementId] }) }
  // Two writes: the setup carries the version the editor read; the selection then pins the version the setup returned.
  const save = useMutation({
    mutationFn: async () => {
      const setup = await updateReportSetup(report.engagementId, report.id, {
        expectedVersion: report.version,
        templateId: templateId || null,
        periodStart: periodStart ? new Date(`${periodStart}T00:00:00.000Z`).toISOString() : null,
        periodEnd: periodEnd ? new Date(`${periodEnd}T23:59:59.999Z`).toISOString() : null,
        reviewerId: reviewerId || null,
      })
      return setReportFindings(report.engagementId, report.id, { expectedVersion: setup.version, findingIds: selected })
    },
    onSuccess: () => { setError(null); refresh() },
    onError: (err) => { setError(err instanceof Error ? err.message : 'The setup was refused. Your choices are preserved.'); refresh() },
  })
  const createTemplate = useMutation({
    mutationFn: () => createReportTemplate(report.engagementId, {
      name: templateName.trim(),
      sections: templateSections.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
        .map((line) => line.endsWith('*') ? { title: line.slice(0, -1).trim(), required: true } : { title: line, required: false }),
    }),
    onSuccess: (template) => { setTemplateName(''); setTemplateSections(''); setTemplateId(template.id); setError(null); refresh() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The template was refused.'),
  })

  const reportable = (findings.data?.findings ?? []).filter((finding) => REPORTABLE_STATUSES.includes(finding.status))
  const reviewers = (members.data?.members ?? []).filter((member) => (member.role === 'owner' || member.role === 'reviewer') && member.id !== report.createdBy)
  const toggle = (findingId: string, on: boolean): void => setSelected(on ? [...selected, findingId] : selected.filter((id) => id !== findingId))

  return <Card>
    <CardHeader title="Setup and finding selection" sub="Template, reporting period, named reviewer and the findings pinned to this version" />
    <div className="space-y-3">
      {editable ? <>
        <label className="block">Template
          <select className="block w-full rounded border p-2" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">No template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}
          </select>
        </label>
        <label className="block">Reporting period start<Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></label>
        <label className="block">Reporting period end<Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></label>
        <label className="block">Named reviewer
          <select className="block w-full rounded border p-2" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
            <option value="">No reviewer</option>
            {reviewers.map((member) => <option key={member.id} value={member.id}>{member.label} ({member.role})</option>)}
          </select>
        </label>
        <fieldset className="space-y-1">
          <legend>Findings (confirmed or later)</legend>
          {findings.isPending && <p>Loading findings…</p>}
          {reportable.length === 0 && !findings.isPending && <p>No confirmed or later findings in this engagement.</p>}
          {reportable.map((finding) => <label key={finding.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(finding.id)} onChange={(e) => toggle(finding.id, e.target.checked)} />
            {finding.title} <span className="text-sm">v{finding.expectedVersion} · {finding.status}</span>
          </label>)}
        </fieldset>
        <Button disabled={save.isPending || selected.length === 0} onClick={() => save.mutate()}>Save setup and findings</Button>
        <details>
          <summary>Create a template (owner only)</summary>
          <div className="space-y-2">
            <Input placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <Textarea placeholder={'One section per line. End a line with * when the section is required.'} value={templateSections} onChange={(e) => setTemplateSections(e.target.value)} />
            <Button disabled={templateName.trim().length === 0 || templateSections.trim().length === 0 || createTemplate.isPending} onClick={() => createTemplate.mutate()}>Create template</Button>
          </div>
        </details>
      </> : <>
        <p>Template: {report.templateId ? `v${report.templateVersion}` : 'none'} · Period: {report.period ? `${report.period.start.slice(0, 10)} to ${report.period.end.slice(0, 10)}` : 'not set'}</p>
        <ul>{report.selectedFindings.map((finding) => <li key={finding.id}>{finding.title} (pinned v{finding.findingVersion}, {finding.status})</li>)}</ul>
      </>}
      <section aria-label="Readiness checks">
        <h3>Readiness</h3>
        <ul>{report.readiness.checks.map((check) => <li key={check.id}><strong>{check.label}</strong>: {check.state} — {check.detail}</li>)}</ul>
        <p>{report.readiness.ready ? 'All checks pass.' : 'Review is blocked until every check passes.'}</p>
      </section>
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  </Card>
}
