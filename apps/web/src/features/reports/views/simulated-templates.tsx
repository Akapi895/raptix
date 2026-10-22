/**
 * Simulated template gallery: the demo authority's templates, approvals and audit. Mock mode only. Real mode renders the stored
 * templates from the list (RealTemplates), so this module is loaded lazily and never reaches the real path. Its actions are
 * simulated follow-ups: template detail, approve and duplicate need port operations before this gallery can unify with the stored one.
 */
import { useState } from 'react'
import { Copy, Lock, Plus, Upload } from 'lucide-react'
import { useServices } from '../../../state/services'
import { recordAudit } from '../../audit/service'
import type { Template } from '../../../domain/entities'
import { Banner, Button, Card, Drawer, Mono, Skeleton, cx } from '../../../ui/index'
import { useReportCapabilities, useTemplates } from '../query'
import { TemplateCreateForm } from './template-create-form'
import { go } from '../../../router/navigate'
import { useMe } from '../../../state/console'
import { useToastStore } from '../../../state/stores'
import { useSessionStore } from '../../../state/session'
import { ReadError } from './read-error'

export function SimulatedTemplates() {
  const caps = useReportCapabilities()
  const services = useServices()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const setFilter = useSessionStore((s) => s.setFilter)
  /* The legacy raw `A.audit` entries, mirrored exactly: one 'legacy' commit
     through the one authority (these simulated actions never touch data). */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    recordAudit(services, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { action, obj, result, reason })
  const tpls = useTemplates()
  const [sel, setSel] = useState<Template | null>(null)
  const [creating, setCreating] = useState(false)
  const admin = me.role === 'admin'
  const why = 'Only Organization Admins can create, duplicate or publish templates. Ask an admin to make the change.'
  const sim = (t: string) => toast(`${t} — simulated: the backend executes this and records an audit event.`, 'info')
  const use = (t: Template) => { setFilter('reportNewTemplate', t.name); go('report-new') }
  if (tpls.isPending) return <div aria-busy="true" aria-label="Loading templates"><Skeleton className="h-64" /></div>
  if (tpls.isError) return <ReadError error={tpls.error} retry={() => tpls.refetch()} />
  const templates = tpls.data!
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{templates.length} templates. Draft templates can be tried but cannot be used for formal delivery.</p>
        <Button icon={Plus} disabled={!admin} title={admin ? undefined : why} onClick={() => { if (caps.storedTemplates) return setCreating(true); sim('Create template'); audit('Created report template (simulated)', 'TP-new', '') }}>Create template</Button>
      </div>
      {!admin && <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />{why}</p>}
      {creating && <TemplateCreateForm onDone={() => { setCreating(false); void tpls.refetch() }} onCancel={() => setCreating(false)} />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {templates.map((t) => (
          <Card key={t.id} pad={false} className="flex flex-col overflow-hidden">
            <button onClick={() => setSel(t)} className="block h-36 border-b border-line bg-hover/50 p-4 text-left" aria-label={`View details for ${t.name}`}>
              {/* Miniature paper thumbnail — intentionally light in both themes. */}
              <div data-paper className="mx-auto flex h-full w-24 flex-col justify-between rounded-sm bg-white p-2 shadow">
                <div><div className="h-1 w-10 rounded bg-slate-400" /><div className="mt-2 h-2 w-16 rounded bg-slate-800" /><div className="mt-1 h-1 w-14 rounded bg-slate-300" /></div>
                <div className="text-[7px] text-slate-500">{t.kind} · {t.version}</div>
              </div>
            </button>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="font-medium">{t.name}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{t.kind}</span><span>·</span><span>{t.lang}</span><span>·</span><Mono className="whitespace-nowrap">{t.version}</Mono></div>
              <div className="flex flex-wrap gap-1.5"><span className={cx('inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px]', t.status === 'published' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-neutral/30 bg-neutral/10 text-neutral')}>{t.status === 'published' ? 'Published' : 'Draft'}</span>{t.status !== 'published' && <span className="inline-flex w-fit rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">Not for formal delivery</span>}</div>
              <div className="text-xs text-muted">Owner {t.owner} · {t.updated}</div>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="primary" onClick={() => use(t)} title={t.status === 'published' ? undefined : 'Draft template: the report is tagged not for formal delivery'}>{t.status === 'published' ? 'Use template' : 'Try in Draft'}</Button>
                <Button size="sm" onClick={() => setSel(t)}>{t.status === 'published' ? 'Details' : 'Preview Draft'}</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.name} footer={sel && <>
        <Button icon={Copy} disabled={!admin} title={admin ? undefined : why} onClick={() => { sim('Duplicate template'); audit('Duplicated report template (simulated)', sel.id, '') }}>Duplicate</Button>
        <Button icon={Upload} disabled={!admin || sel.status === 'published'} title={!admin ? why : sel.status === 'published' ? 'Template is already published' : undefined} onClick={() => { sim('Publish template'); audit('Published report template (simulated)', sel.id, '') }}>Publish</Button>
        <Button variant="primary" onClick={() => { use(sel) }}>{sel.status === 'published' ? 'Use template' : 'Try in Draft'}</Button>
      </>}>
        {sel && <div className="space-y-5">
          {sel.status !== 'published' && <Banner tone="warn" title="Template not approved">Reports using this template cannot be formally delivered.</Banner>}
          <div><div className="mb-2 text-xs font-medium text-muted">Default sections</div><ol className="space-y-1.5 text-sm">{sel.sections.map((s, i) => <li key={s} className="flex gap-2"><span className="w-5 text-neutral">{i + 1}</span>{s}</li>)}</ol></div>
          <div><div className="mb-2 text-xs font-medium text-muted">Mapped data sources</div><p className="text-sm">Objectives, scope and ROE, operations, verified findings, redacted evidence, coverage charts.</p></div>
          <div><div className="mb-2 text-xs font-medium text-muted">Usage guidance</div><p className="text-sm text-muted">Pick a template when creating a report. Only verified findings are included. Every report must be approved by a reviewer before export.</p></div>
        </div>}
      </Drawer>
    </>
  )
}
