import { useState } from 'react'
import { Download, FileText, Lock, Pencil, Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { useServices } from '../state/services'
import { ROLE_LABEL } from '../auth/policy'
import { setProjectMembers } from '../features/projects/team-service'
import { useReopen } from '../features/approvals/hooks'
import { DocumentWorkspace } from '../features/documents/workspace'
import { AssetPreviewModal } from '../features/assets/preview-modal'
import { APR, USERS, type Project, type Role, type Approval } from '../data'
import { decideApprovalTransaction, reviseScopeTransaction, submitApprovalTransaction, type ScopeFieldPatch } from '../features/approvals/service'
import { confirmCloseTransaction, requestCloseTransaction } from '../features/closure/service'
import { useCan, useMe } from '../state/console'
import { useSessionStore } from '../state/session'
import { useProjectStore, useToastStore } from '../state/stores'
import { go, selectProject } from '../router/navigate'
import type { DashboardAggregate } from './dashboard/domain'
import type { ProjectDetail } from './project-detail/service'
import { Banner, Button, Check, Card, CardHeader, DescList, Drawer, Empty, Field, FilterBar, IconButton, IdLink, Input, Kpi, Locked, Modal, PersonaHint, Person, Progress, SearchBox, Segmented, Select, Status, Table, Textarea, useGuard, type Col } from '../ui'

/* Ticket 21: ScopeTab/TeamTab mutations run through the ticket-21 approval
 * and scope-revision transaction handlers (via the delegating store actions),
 * so refusals render the handler's reason. Reads come from the detail
 * service's typed slices (the `ds` aggregate prop b-detail passes down).
 * Ticket 23: the close console renders the service-derived checklist too —
 * ticket 22's policy derivation over the same snapshot (base + waiver
 * variants plus the waiver precondition) — and its counts come from the
 * typed slices; the panel never reads the legacy store database and never
 * duplicates the request/confirm handlers' enforcement. */

/** Approval types the scope version history lists (typed, no `any`). */
const CREATE_OR_SCOPE: readonly string[] = [APR.create, APR.scope]

/* ───────────── PR-04 Scope & ROE (plan 2026-10-16 §4 rework) ───────────── */
type Sub = 'assets' | 'roe' | 'docs' | 'hist'
type AssetGroup = 'all' | 'in' | 'pending' | 'out' | 'unclassified'
export function ScopeTab({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const services = useServices()
  const me = useMe()
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const pid = useProjectStore((s) => s.pid)
  const guard = useGuard(p.id)
  const [sub, setSub] = useState<Sub>('assets')
  const [group, setGroup] = useState<AssetGroup>('all')
  const [q, setQ] = useState('')
  const [assetPreview, setAssetPreview] = useState<string | null>(null)
  const [edit, setEdit] = useState(false)
  const [scopeErr, setScopeErr] = useState('')
  /* Ticket 67 wave 3: the legacy A.submitApproval/A.editScope entries mirrored —
      the transactions run directly with the same request context (corr 'legacy')
      and the same Res bridge. */
  const submitApproval = (projectId: string, type: string, note: string, diff?: string) => {
    const res = submitApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { projectId, type, note, diff })
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const editScope = (projectId: string, patch: ScopeFieldPatch, reason?: string) => {
    const res = reviseScopeTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, projectId, { patch, reason })
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const assets = ds.assets
  /* Pending assets are never counted as approved in scope (plan §4) — only
     `scope === 'in'` is approved; `!= out` would overstate the executable
     surface and was the old label's bug. */
  const nIn = assets.filter((a) => a.scope === 'in').length
  const nPending = assets.filter((a) => a.scope === 'pending').length
  const nOut = assets.filter((a) => a.scope === 'out').length
  const nUnc = assets.filter((a) => a.scope === 'unclassified').length
  const editable = !guard.ro && can('editScope', p.id)
  const why = guard.ro ? guard.reason : 'Only a Red Team Manager or Organization Admin can edit scope.'
  const scopePending = ds.approvals.find((a) => a.type === APR.scope && a.status === 'pending')
  const blocked = ds.operations.filter((o) => ['draft', 'ready', 'pending'].includes(o.status))
  const running = ds.operations.filter((o) => o.status === 'running')
  const hist = ds.approvals.filter((a) => CREATE_OR_SCOPE.includes(a.type))
  const closedP = p.status === 'closed' || p.status === 'cancelled'
  const prevV = prevRoe(p.roeVersion)
  const impact = p.roeStatus !== 'approved' && prevV && ['approved', 'active', 'paused', 'review'].includes(p.status)
    ? { prev: prevV, plans: ds.plans.filter((x) => x.status === 'expired' && x.risks.some((r) => r.startsWith('Re-validation'))), draftOps: ds.operations.filter((o) => ['draft', 'pending', 'ready'].includes(o.status)), running: ds.operations.filter((o) => ['running', 'paused'].includes(o.status)) }
    : null
  const histAudit = ds.audit.filter((a) => /scope|ROE/i.test(a.action))
  const approved = p.roeStatus === 'approved'
  const effective = approved ? p.roeVersion : prevRoe(p.roeVersion)
  const proposed = approved ? null : p.roeVersion
  const filtered = assets
    .filter((a) => group === 'all' || a.scope === group)
    .filter((a) => { const s = q.trim().toLowerCase(); return !s || [a.name, a.ident, a.ip].some((v) => v.toLowerCase().includes(s)) })

  type A = (typeof assets)[number]
  const cols: Col<A>[] = [
    { key: 'name', header: 'Name', render: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'type', header: 'Type', render: (a) => a.type, hideBelow: 'md' },
    { key: 'ident', header: 'Identifier', render: (a) => <span className="font-mono text-xs">{a.ident}</span> },
    { key: 'owner', header: 'Asset owner', render: (a) => a.owner, hideBelow: 'lg' },
    { key: 'src', header: 'Source', render: (a) => <span className="text-muted">{a.source}</span>, hideBelow: 'lg' },
    { key: 'sc', header: 'Scope', render: (a) => <Status kind="scope" value={a.scope} /> },
    {
      key: 'act', header: '', render: (a) => (
        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setAssetPreview(a.id)}>View details</Button>
        </span>
      ),
    },
  ]

  const rePropose = () => {
    const r = submitApproval(p.id, APR.scope, 'Resubmitted ROE after addressing reviewer feedback.', p.roeVersion)
    if (!r.ok) { setScopeErr(r.error || 'The resubmission was refused.'); return }
    setScopeErr('')
    toast('Requested re-approval of scope')
  }
  const download = () => toast(`Downloading ${p.id}_${p.roeVersion.replace(' ', '')}.pdf (simulated)`, 'info')
  const addAsset = () => { if (pid !== p.id) { selectProject(p.id); setTimeout(() => go('asset-new'), 80) } else go('asset-new') }

  return (
    <>
      {scopeErr && <Banner tone="bad" title="Scope change refused">{scopeErr}</Banner>}
      {scopePending && <Banner tone="warn" title="Awaiting approval of a new scope">{p.roeVersion} submitted by {scopePending.by} on {scopePending.at}; reviewer: {scopePending.reviewer}. {running.length > 0 ? `Running operations (${running.map((o) => o.id).join(', ')}) continue per policy; ` : ''}operations that have not started are blocked by check PRE-03.</Banner>}
      {p.roeStatus === 'rejected' && !scopePending && (
        <Banner tone="bad" title="Scope / ROE returned for changes" action={<Button size="sm" disabled={!editable} title={editable ? undefined : why} onClick={rePropose}>Request re-approval</Button>}>Update the scope based on the reviewer's feedback, then resubmit.</Banner>
      )}
      {!p.emergency && !closedP && (
        <Banner tone="warn" title="Emergency contact is missing" action={<span className="flex gap-2"><Button size="sm" disabled={!editable} title={editable ? undefined : why} onClick={() => setEdit(true)}>Add contact</Button></span>}>
          Without an emergency contact the ROE cannot be submitted for approval and Preflight / Run stay blocked (PRE-08). Saving drafts is not affected.
        </Banner>
      )}
      {impact && (
        <Banner tone="bad" title={`Scope change: ${p.roeVersion} needs approval. Re-validation required`} action={<Button size="sm" onClick={() => go('tasks')}>Open approvals</Button>}>
          <ul className="list-disc pl-4">
            {impact.plans.length > 0 && <li>Plans moved to Re-validation Required: {impact.plans.map((x) => x.id).join(', ')}. Re-approve them under {p.roeVersion}.</li>}
            {impact.draftOps.length > 0 && <li>Operations that cannot start until re-validated: {impact.draftOps.map((x) => x.id).join(', ')} (Draft; rerun Preflight after approval).</li>}
            {impact.running.length > 0 && <li>Running now: {impact.running.map((x) => x.id).join(', ')} continues under last approved {impact.prev}; assets added by {p.roeVersion} are not targetable until it is approved.</li>}
            {impact.plans.length + impact.draftOps.length + impact.running.length === 0 && <li>No existing plans or operations are affected.</li>}
          </ul>
        </Banner>
      )}
      {/* Status strip: applied vs proposed version, contact and the scope
          counts at a glance — the two large version cards are gone (plan §4). */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Effective version</span><span className="font-mono font-semibold text-fg">{effective || 'none yet'}</span>{effective && <Status kind="roe" value="approved" size="sm" label="approved" />}</span>
          {proposed && <span className="inline-flex items-center gap-1.5"><span className="text-muted">Proposed</span><span className="font-mono font-semibold text-fg">{proposed}</span><Status kind="roe" value={p.roeStatus} size="sm" label={p.roeStatus} /></span>}
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Emergency contact</span>{p.emergency ? <span className="text-fg">{p.emergency}</span> : <span className="font-medium text-bad">Missing — blocks approval</span>}</span>
          <span className="inline-flex flex-wrap items-center gap-1.5"><span className="text-muted">Assets</span><span className="text-ok">{nIn} approved in scope</span>·<span className="text-warn">{nPending} pending</span>·<span>{nOut} out</span>·<span>{nUnc} unclassified</span></span>
        </div>
        {proposed && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-accent">Proposed changes summary (not in force until approved)</summary>
            <div className="mt-2"><DescList cols={1} items={[
              { k: 'Assets added (pending review)', v: nPending ? <span className="text-ok">+{nPending} — {assets.filter((a) => a.scope === 'pending').map((a) => a.name).join(', ')}</span> : '0 assets. At least one is needed to submit' },
              { k: 'Emergency contact', v: p.emergency || <span className="text-bad">Missing</span> },
              { k: 'Permitted window', v: p.window || <span className="text-bad">Not set</span> },
              { k: 'Impact on plans / operations', v: effective ? 'Approved plans and ready operations are marked Re-validation Required' : 'No approved plans or operations exist yet' },
            ]} /></div>
          </details>
        )}
      </Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Sub> value={sub} onChange={setSub} options={[{ id: 'assets', label: `Assets (${assets.length})` }, { id: 'roe', label: 'ROE' }, { id: 'docs', label: 'Documents' }, { id: 'hist', label: 'History' }]} />
        <div className="flex flex-wrap items-center gap-2">
          {!editable && <Locked reason={why} />}
          <Button icon={Plus} disabled={!editable} title={editable ? undefined : why} onClick={addAsset}>Add Asset</Button>
          <Button variant="primary" icon={Pencil} disabled={!editable || closedP} title={!editable ? why : closedP ? 'Project is closed — read-only.' : undefined} onClick={() => setEdit(true)}>{approved && p.status !== 'draft' ? `Edit scope (new ${bumpRoeLabel(p.roeVersion)} draft)` : 'Edit Draft'}</Button>
        </div>
      </div>

      {sub === 'docs' ? (
        <DocumentWorkspace key={p.id} p={p} />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            {sub === 'assets' && (
              <>
                <FilterBar>
                  <SearchBox value={q} onChange={setQ} placeholder="Search name, identifier or IP…" className="w-64" />
                  <Segmented<AssetGroup> value={group} onChange={setGroup} options={[{ id: 'all', label: `All (${assets.length})` }, { id: 'in', label: `Approved in scope (${nIn})` }, { id: 'pending', label: `Pending (${nPending})` }, { id: 'out', label: `Out (${nOut})` }, { id: 'unclassified', label: `Unclassified (${nUnc})` }]} />
                </FilterBar>
                <Table cols={cols} rows={filtered} rowKey={(a) => a.id} onRow={(a) => setAssetPreview(a.id)} empty={<Empty title={q ? 'No assets match the search' : 'No assets in this view'}>{q ? 'Search matches name, identifier or IP.' : 'Declare at least one in-scope asset to submit for approval.'}</Empty>} />
              </>
            )}
            {sub === 'roe' && <RoePanel p={p} download={download} approvals={ds.approvals} />}
            {sub === 'hist' && (
              <Card>
                <CardHeader title="ROE version history" sub={`Current version: ${p.roeVersion}`} />
                {hist.length + histAudit.length === 0 ? <p className="text-sm text-muted">No changes recorded yet.</p> : (
                  <ul className="divide-y divide-line/60 text-sm">
                    {hist.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5"><span className="font-mono text-xs text-muted">{a.at}</span><span className="font-medium">{a.type}</span><Status kind="approval" value={a.status} size="sm" /><span className="text-muted">{a.diff || a.note}</span></li>)}
                    {histAudit.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5"><span className="font-mono text-xs text-muted">{a.at}</span><span className="font-medium">{a.action}</span><span className="text-muted">{a.actor}{a.reason ? ' — ' + a.reason : ''}</span></li>)}
                  </ul>
                )}
              </Card>
            )}
          </div>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Affected operations (PRE-03)" sub="Operations that have not started need an approved ROE" />
              {blocked.length === 0 ? <p className="text-sm text-muted">No operations are blocked.</p> : (
                <ul className="space-y-2 text-sm">
                  {blocked.map((o) => <li key={o.id} className="flex items-center gap-2"><IdLink onClick={() => go('preflight', { id: o.id })}>{o.id}</IdLink><span className="flex-1 truncate">{o.name}</span>{p.roeStatus !== 'approved' ? <Status kind="check" value="fail" size="sm" /> : <Status kind="check" value="pass" size="sm" />}</li>)}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {assetPreview && <AssetPreviewModal key={assetPreview} id={assetPreview} onClose={() => setAssetPreview(null)} />}
      {edit && <EditScope p={p} onClose={() => setEdit(false)} confirmReason={(patch) => {
        const needRe = ['approved', 'active'].includes(p.status) && p.roeStatus === 'approved'
        if (needRe) {
          setEdit(false)
          confirm({ title: 'Edit an approved scope?', body: `This creates ${bumpRoeLabel(p.roeVersion)} as a new draft and sends it for approval. ${ds.plans.filter((x) => x.status === 'approved').length} approved plan(s) will need re-approval and ${ds.operations.filter((x) => x.status === 'ready').length} ready operation(s) return to Draft. Running operations continue under ${p.roeVersion} until the new version is approved.`, confirmLabel: 'Submit change', danger: true, reasonLabel: 'Reason for scope change', reasonRequired: true, onConfirm: (r) => {
            const res = editScope(p.id, patch, r)
            if (!res.ok) { setScopeErr(res.error || 'The scope change was refused.'); return }
            setScopeErr('')
            toast(`${bumpRoeLabel(p.roeVersion)} created. Dependent plans and operations need re-validation`, 'warn')
          } })
        } else {
          const res = editScope(p.id, patch)
          if (!res.ok) { setScopeErr(res.error || 'The scope change was refused.'); return }
          setScopeErr(''); toast('Scope updated'); setEdit(false)
        }
      }} />}
    </>
  )
}

const prevRoe = (v: string) => { const m = v.match(/^(.*v)(\d+)$/); return m && +m[2] > 1 ? `${m[1]}${+m[2] - 1}` : '' }
const bumpRoeLabel = (v: string) => v.replace(/v(\d+)$/, (_, n) => `v${+n + 1}`)

/** The single ROE rendering on the page (plan §4: never twice). Readable
 *  sections from the applied fields; the PDF row is the simulated export. */
function RoePanel({ p, download, approvals }: { p: Project; download: () => void; approvals: Approval[] }) {
  const approval = approvals.find((a) => CREATE_OR_SCOPE.includes(a.type))
  return (
    <Card>
      <CardHeader title="Rules of Engagement (ROE)" sub="Applied fields below; edit through Edit Draft so the approval workflow stays authoritative" actions={<Status kind="roe" value={p.roeStatus} />} />
      <DescList cols={1} items={[
        { k: 'Version', v: <span className="font-mono">{p.roeVersion}</span> },
        { k: 'Assessment window', v: p.window || <span className="text-bad">Not set</span> },
        { k: 'Emergency contact', v: p.emergency || <span className="text-bad">Not set. Blocks approval</span> },
        { k: 'Reviewer', v: approval?.reviewer || '—' },
        { k: 'Description', v: p.desc },
        { k: 'Allowed activities', v: p.methods.length ? <ul className="list-inside list-disc">{p.methods.map((m) => <li key={m}>{m}</li>)}</ul> : '—' },
        { k: 'Restrictions', v: p.restrictions.length ? <ul className="list-inside list-disc">{p.restrictions.map((m) => <li key={m}>{m}</li>)}</ul> : '—' },
      ]} />
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><FileText size={16} className="text-muted" /><span className="flex-1 truncate font-mono text-[13px]">{p.id}_{p.roeVersion}.pdf</span><Button size="sm" icon={Download} onClick={download}>Download ROE</Button></div>
      <p className="mt-2 text-xs text-muted">The readable/source document view of this ROE lives in Documents.</p>
    </Card>
  )
}

/** Wide side panel instead of the old small dialog (plan §4): the same
 *  structured fields and the same transaction semantics. */
function EditScope({ p, onClose, confirmReason }: { p: Project; onClose: () => void; confirmReason: (patch: { window: string; emergency: string; methods: string[]; restrictions: string[]; desc: string }) => void }) {
  const [f, setF] = useState({ window: p.window, emergency: p.emergency, methods: p.methods.join('\n'), restrictions: p.restrictions.join('\n'), desc: p.desc })
  const [tried, setTried] = useState(false)
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
  const err = { window: !f.window.trim() ? 'Assessment window is required' : '', emergency: !f.emergency.trim() ? 'Emergency contact is required' : '' }
  const dirty = f.window !== p.window || f.emergency !== p.emergency || f.methods !== p.methods.join('\n') || f.restrictions !== p.restrictions.join('\n') || f.desc !== p.desc
  const save = () => {
    setTried(true)
    if (err.window || err.emergency) return
    confirmReason({ window: f.window.trim(), emergency: f.emergency.trim(), methods: lines(f.methods), restrictions: lines(f.restrictions), desc: f.desc.trim() })
  }
  return (
    <Drawer open onClose={onClose} title="Edit Scope & ROE" width={640} footer={<><Button onClick={onClose}>Discard changes</Button><Button variant="primary" disabled={!dirty} title={dirty ? undefined : 'No changes to save'} onClick={save}>Save changes</Button></>}>
      <div className="space-y-4">
        <Field label="Assessment window" required error={tried ? err.window : ''}><Input value={f.window} onChange={(e) => setF({ ...f, window: e.target.value })} placeholder="e.g. Mon–Fri, 8:00 PM–4:00 AM (UTC+7)" /></Field>
        <Field label="Emergency contact" required error={tried ? err.emergency : ''}><Input value={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.value })} placeholder="Full name, phone (synthetic)" /></Field>
        <Field label="Allowed activities" hint="One item per line"><Textarea value={f.methods} onChange={(e) => setF({ ...f, methods: e.target.value })} /></Field>
        <Field label="Restrictions" hint="One item per line"><Textarea value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} /></Field>
        <Field label="Scope description"><Textarea value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></Field>
      </div>
    </Drawer>
  )
}

/* ───────────── PR-05 / PR-07 Members & Approvals ───────────── */
export function TeamTab({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const services = useServices()
  const me = useMe()
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const guard = useGuard(p.id)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [add, setAdd] = useState(false)
  const [nu, setNu] = useState<{ user: string; role: Role }>({ user: '', role: 'operator' })
  /* Ticket 67 wave 3: the legacy A.decideApproval/A.confirmClose entries mirrored —
     the transactions run directly with the same request context and Res bridge. */
  const decideApproval = (id: string, decision: 'approved' | 'returned', note: string) => {
    const res = decideApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, id, decision, note)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const confirmClose = (apId: string) => {
    const res = confirmCloseTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, apId)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const canEdit = !guard.ro && can('editScope', p.id)
  const why = guard.ro ? guard.reason : 'Only a Red Team Manager or Organization Admin can manage members.'
  const appr = ds.approvals
  const pend = appr.filter((a) => a.status === 'pending')
  const mayApprove = can('approve', p.id)
  const names = Array.from(new Set(USERS.map((u) => u.name))).filter((n) => !p.members.some((m) => m.user === n) && n !== p.owner)

  // Membership and audit publish atomically through the project service.
  const setMembers = (members: Project['members'], act: string, obj: string) => {
    const res = setProjectMembers(services, { actor: { id: me.name, role: me.role }, projectId: p.id, corr: 'legacy' }, members, act, obj)
    if (!res.ok) { toast(res.failure.message, 'bad'); return }
    toast(act)
  }
  const changeRole = (user: string, role: Role) => setMembers(p.members.map((m) => (m.user === user ? { ...m, role } : m)), `Changed ${user}'s role to ${ROLE_LABEL[role]}`, user)
  const remove = (user: string) => confirm({ title: `Remove ${user} from the project?`, body: 'The member loses access to the project immediately.', confirmLabel: 'Remove member', danger: true, onConfirm: () => setMembers(p.members.filter((m) => m.user !== user), `Removed ${user} from the project`, user) })

  const decide = (a: Approval, d: 'approved' | 'returned', note: string) => {
    const r = decideApproval(a.id, d, note)
    if (!r.ok) { setErr(r.error || 'Could not complete the decision'); return }
    setErr(''); toast(d === 'approved' ? `Approved: ${a.type}` : `Returned: ${a.type}`)
  }
  const approve = (a: Approval) => confirm({ title: `Approve “${a.type}”?`, body: `Project ${p.id} moves to its next state based on this decision.`, confirmLabel: 'Approve', reasonLabel: 'Comment (optional)', onConfirm: (r) => { if (a.type !== APR.close) { decide(a, 'approved', r); return } /* Ticket 22: closure resolution is gated by the handler (four-eyes + re-derived checklist); the refusal renders here. */ const c = confirmClose(a.id); if (c.ok) toast('Project closure confirmed'); else setErr(c.error || 'Could not confirm closure') } })
  const ret = (a: Approval) => confirm({ title: `Request changes to “${a.type}”`, body: 'The submitter is notified with your reason so they can revise and resubmit.', confirmLabel: 'Request Changes', danger: true, reasonLabel: 'Reason for changes', reasonRequired: true, onConfirm: (r) => decide(a, 'returned', r) })
  const more = (a: Approval) => confirm({ title: 'Request more information', body: 'The request is returned to the submitter with what is needed.', confirmLabel: 'Send request', reasonLabel: 'Information needed', reasonRequired: true, onConfirm: (r) => decide(a, 'returned', 'More information requested: ' + r) })

  type M = Project['members'][number]
  const mcols: Col<M>[] = [
    { key: 'u', header: 'Member', render: (m) => <Person name={m.user} /> },
    { key: 'r', header: 'Project role', render: (m) => (canEdit ? <Select aria-label={`Role of ${m.user}`} className="w-52" value={m.role} onChange={(e) => changeRole(m.user, e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select> : ROLE_LABEL[m.role]) },
    { key: 'perm', header: 'Permissions', render: (m) => <span className="text-muted">{m.role === 'viewer' ? 'View only' : m.role === 'reviewer' ? 'View, approve' : m.role === 'operator' ? 'View, execute' : 'Manage'}</span>, hideBelow: 'md' },
    { key: 's', header: 'Joined', render: (m) => <span className="font-mono text-xs text-muted">{m.since}</span>, hideBelow: 'md' },
    { key: 'a', header: '', render: (m) => <IconButton icon={Trash2} label={`Remove ${m.user}`} disabled={!canEdit} title={canEdit ? `Remove ${m.user}` : why} onClick={() => remove(m.user)} /> },
  ]

  return (
    <div className="space-y-6">
      {pend.length > 0 && !mayApprove && (
        <PersonaHint need="a Reviewer or Admin" persona={pend[0].reviewer}>The “{pend[0].type}” request is waiting for {pend[0].reviewer}. The {ROLE_LABEL[me.role]} role cannot approve it.</PersonaHint>
      )}
      {err && <Banner tone="bad" title="Cannot approve">{err}</Banner>}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Approval requests ({appr.length})</h3>
          <Button size="sm" onClick={() => go('tasks')}>Open in Tasks & Approvals</Button>
        </div>
        {appr.length === 0 ? <Empty title="No approval requests">Request approval to start the project and ROE review.</Empty> : (
          <div className="space-y-3">
            {appr.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.type}</span><Status kind="approval" value={a.status} /><span className="font-mono text-xs text-muted">{a.id}</span></div>
                    <div className="mt-1 text-xs text-muted">Submitted by {a.by} · Reviewer {a.reviewer} · {a.at}</div>
                    {a.note && <p className="mt-2 text-sm">{a.note}</p>}
                    {a.diff && (
                      <button className="mt-2 inline-flex items-center gap-1 text-xs text-accent" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Change details</button>
                    )}
                    {open === a.id && a.diff && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-hover p-3 font-mono text-xs">{a.diff}</pre>}
                  </div>
                  {a.status === 'pending' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" disabled={!mayApprove || guard.ro} title={mayApprove ? undefined : 'Only a Reviewer or Admin can approve'} onClick={() => approve(a)}>{a.type === APR.close ? 'Approve Closure' : 'Approve'}</Button>
                      <Button variant="danger" disabled={!mayApprove || guard.ro} title={mayApprove ? undefined : 'Only a Reviewer or Admin can request changes'} onClick={() => ret(a)}>Request Changes</Button>
                      {a.type !== APR.close && <Button disabled={!mayApprove || guard.ro} title={mayApprove ? undefined : 'Only a Reviewer or Admin can request more information'} onClick={() => more(a)}>Request more info</Button>}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Members ({p.members.length + 1})</h3>
          <div className="flex items-center gap-2">{!canEdit && <Locked reason={why} />}<Button icon={Plus} disabled={!canEdit} title={canEdit ? undefined : why} onClick={() => setAdd(true)}>Add Member</Button></div>
        </div>
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-sm"><Person name={p.owner} /><span className="text-muted">Project owner</span></div>
        <Table cols={mcols} rows={p.members} rowKey={(m) => m.user} empty={<Empty title="No other members">Add operators, reviewers or client viewers to grant access.</Empty>} />
      </section>

      <Modal open={add} onClose={() => setAdd(false)} title="Add Member" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" disabled={!nu.user} title={nu.user ? undefined : 'Select a user'} onClick={() => { setMembers([...p.members, { user: nu.user, role: nu.role, since: 'Oct 13, 2026' }], `Added ${nu.user} to the project`, nu.user); setAdd(false); setNu({ user: '', role: 'operator' }) }}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="User" required><Select value={nu.user} onChange={(e) => setNu({ ...nu, user: e.target.value })}><option value="">Select a user…</option>{names.map((n) => <option key={n}>{n}</option>)}</Select></Field>
          <Field label="Role"><Select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        </div>
      </Modal>
    </div>
  )
}

/* ───────────── PR-09 Closure ───────────── */
export function CloseTab({ p, d, setTab }: { p: Project; d: ProjectDetail; setTab: (t: string) => void }) {
  const services = useServices()
  const me = useMe()
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const guard = useGuard(p.id)
  const reopen = useReopen(p)
  /* Ticket 67 wave 3: the legacy A.confirmClose/A.requestClose entries mirrored —
     the closure transactions run directly with the same request context and Res bridge. */
  const confirmClose = (apId: string) => {
    const res = confirmCloseTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, apId)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const requestClose = (pid_: string, input?: { reason?: string; waiverNoFindings?: boolean }) => {
    const res = requestCloseTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: pid_, corr: 'legacy' }, pid_, { reason: input?.reason ?? '', waiverNoFindings: input?.waiverNoFindings })
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const [modal, setModal] = useState(false)
  const [reason, setReason] = useState('')
  const [noFind, setNoFind] = useState(false)
  /* Ticket 22/23: the checklist is the closure service's canonical derivation
     over the service read's snapshot — base variant plus the waiver variant
     the request-time checkbox selects. The panel never re-derives policy. */
  const ds = d.aggregate
  const noFindingsOk = d.noFindingsWaiverOk
  const items = noFind && noFindingsOk ? d.closeWaived : d.close
  const ops = ds.operations.filter((o) => o.projectId === p.id)
  const fs = ds.findings.filter((f) => f.projectId === p.id)
  const reps = ds.reports.filter((r) => r.projectId === p.id)
  const evs = d.evidence
  const closePending = ds.approvals.find((a) => a.projectId === p.id && a.type === APR.close && a.status === 'pending')
  const objDone = p.objectives.filter((o) => o.progress >= 100).length
  const final = reps.find((r) => r.status === 'delivered') || reps[0]
  const closed = p.status === 'closed'
  const eligible = ['active', 'approved', 'paused'].includes(p.status) && !closePending
  const failing = items.filter((i) => !i.ok)
  const canReq = can('requestClose', p.id)
  const ownerOk = p.members.some((m) => m.role === 'manager') || !!p.owner

  return (
    <div className="space-y-5">
      {closed && <Banner tone="info" icon={Lock} title={`Closed on ${p.closedAt || '—'}. Read-only`}>This project is read-only. Reports, evidence and audit remain viewable; no operation, edit or session can start. Review its <button className="text-accent underline" onClick={() => setTab('activity')}>activity</button> and <button className="text-accent underline" onClick={() => setTab('audit')}>audit log</button> for reconciliation.</Banner>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Objectives complete" value={`${objDone}/${p.objectives.length}`} sub={p.objectives.length ? undefined : 'No objectives yet'} onClick={() => setTab('objectives')} />
        <Kpi label="Active operations" value={ops.filter((o) => ['running', 'paused'].includes(o.status)).length} tone={ops.some((o) => ['running', 'paused'].includes(o.status)) ? 'warn' : 'ok'} onClick={() => setTab('operations')} />
        <Kpi label="Unreviewed findings" value={fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status)).length} tone={fs.some((f) => ['draft', 'review', 'returned'].includes(f.status)) ? 'warn' : 'ok'} onClick={() => setTab('findings')} />
        <Kpi label="Final report" value={final ? <Status kind="report" value={final.status} size="sm" /> : 'None'} onClick={() => setTab('reports')} />
        <Kpi label="Evidence" value={evs.length} sub={`${evs.filter((e) => e.sensitive).length} sensitive, retained per policy`} onClick={() => setTab('evidence')} />
      </div>

      <Card>
        <CardHeader title="Closeout checklist" sub={`${items.filter((i) => i.ok).length + (ownerOk ? 1 : 0)}/${items.length + 1} conditions met`} />
        <Progress value={Math.round(((items.filter((i) => i.ok).length + (ownerOk ? 1 : 0)) / (items.length + 1)) * 100)} tone={failing.length ? 'warn' : 'ok'} label="Closure conditions" />
        <ul className="mt-3 divide-y divide-line/60">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
              <Status kind="check" value={i.ok ? 'pass' : 'fail'} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{i.label}</div><div className="text-xs text-muted">{i.detail}</div></div>
              {!i.ok && <Button size="sm" onClick={() => go(i.fix.page, { id: i.fix.id, tab: i.fix.tab })}>Fix</Button>}
            </li>
          ))}
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={evs.length ? 'pass' : 'review'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Evidence stored</div><div className="text-xs text-muted">{evs.length ? `${evs.length} items retained per policy` : 'No evidence in this project'}</div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={closed ? 'pass' : 'review'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Sign-off by Reviewer or Admin</div><div className="text-xs text-muted">{closed ? `Signed off ${p.closedAt || ''}` : closePending ? 'Awaiting sign-off' : 'Requested after the checks above pass'}</div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value="pass" />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Audit trail retained</div><div className="text-xs text-muted">Closing never deletes logs. <button className="text-accent underline" onClick={() => setTab('audit')}>Open audit</button></div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={ownerOk ? 'pass' : 'fail'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Handover owner assigned</div><div className="text-xs text-muted">{ownerOk ? `Owner: ${p.owner}; closure is confirmed by a Reviewer or Admin` : 'No owner assigned'}</div></div>
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Closure actions" />
        {closed ? (
          can('reopen', p.id) ? <div className="flex flex-wrap items-center gap-3"><Button variant="danger" onClick={reopen}>Reopen Project</Button><span className="text-xs text-muted">A reason is required and recorded in the audit log.</span></div> : <Locked reason="Only an Organization Admin can reopen a closed project." />
        ) : p.status === 'review' && closePending ? (
          can('confirmClose', p.id) ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => confirm({ title: `Approve closure of ${p.id}?`, body: 'The project becomes read-only; data is retained per policy.', confirmLabel: 'Approve Closure', danger: true, onConfirm: () => { const r = confirmClose(closePending.id); if (r.ok) toast(`Closed ${p.id}`); else toast(r.error || 'The closure could not be confirmed.', 'bad') } })}>Approve Closure</Button>
              <span className="text-xs text-muted">Requested by {closePending.by} on {closePending.at}</span>
            </div>
          ) : (
            <PersonaHint need="a Reviewer or Admin" persona="Pat Kim">The closure request is waiting for confirmation. The {ROLE_LABEL[me.role]} role cannot confirm it.</PersonaHint>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!canReq || !eligible || guard.ro} title={!canReq ? 'Only a Red Team Manager can request project closure' : !eligible ? 'The current project status does not allow a closure request' : undefined} onClick={() => setModal(true)}>Close Project</Button>
            {!canReq ? <Locked reason="Only a Red Team Manager can request project closure." /> : !eligible ? <Locked reason={`The project is “${p.status}”, so closure cannot be requested yet.`} /> : failing.length > 0 ? <span className="text-xs text-warn">{failing.length} conditions are not met. Open Request Closure to see them.</span> : null}
          </div>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Close Project" footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" disabled={failing.length > 0 || !reason.trim()} title={failing.length ? 'Resolve the blockers first' : !reason.trim() ? 'A reason is required' : undefined} onClick={() => { const r = requestClose(p.id, { reason: reason.trim(), waiverNoFindings: noFind && noFindingsOk }); if (!r.ok) { toast(r.error || 'The closure request was refused.', 'bad'); return } setModal(false); setReason(''); toast('Closure request submitted for sign-off') }}>Submit closure request</Button></>}>
        {failing.length === 0 ? (
          <p className="mb-3 flex items-center gap-2 text-sm"><CheckCircle2 size={16} className="text-ok" />All conditions are met. A Reviewer or Admin signs off. Closing makes the project read-only and keeps all logs.</p>
        ) : (
          <div className="mb-3">
            <p className="mb-3 text-sm font-medium text-bad">Closure is blocked. Resolve these first:</p>
            <ul className="space-y-2">{failing.map((i) => <li key={i.id} className="flex gap-2 text-sm"><XCircle size={16} className="mt-0.5 shrink-0 text-bad" /><span className="flex-1"><b className="font-medium">{i.label}</b><br /><span className="text-muted">{i.detail}</span></span><Button size="sm" onClick={() => { setModal(false); go(i.fix.page, { id: i.fix.id, tab: i.fix.tab }) }}>Resolve</Button></li>)}</ul>
          </div>
        )}
        {fs.length === 0 || noFindingsOk ? <div className="mb-3"><Check checked={noFind} onChange={setNoFind} label="Approved no-findings closure: no confirmed findings; documented in the reason below instead of a delivered report" /></div> : null}
        <Field label="Reason for closing" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. All objectives assessed; final report delivered." /></Field>
      </Modal>
    </div>
  )
}
