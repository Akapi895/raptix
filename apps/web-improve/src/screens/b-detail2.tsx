import { useState } from 'react'
import { Download, FileText, Lock, Pencil, Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { useStore, closureChecklist, ROLE_LABEL, type Route } from '../store'
import { APR, USERS, type Project, type Role, type Approval } from '../data'
import { Banner, Button, Check, Card, CardHeader, DescList, Empty, Field, IconButton, IdLink, Input, Kpi, Locked, Modal, PersonaHint, Person, Progress, Segmented, Select, Status, Table, Textarea, useGuard, type Col } from '../ui'

export function useSubmitApproval(p: Project) {
  const { db, A, toast } = useStore()
  const assets = db.assets.filter((a) => a.projectId === p.id)
  const issues: string[] = []
  if (!assets.some((a) => ['in', 'pending'].includes(a.scope))) issues.push('no in-scope assets')
  if (!p.emergency) issues.push('no emergency contact')
  if (!p.window) issues.push('no assessment window')
  return {
    issues, ready: issues.length === 0,
    submit: () => {
      A.submitApproval(p.id, APR.create, p.status === 'rejected' ? 'Resubmitted after addressing reviewer feedback.' : 'Requesting approval of the project and ROE.', `${p.roeVersion}, ${assets.filter((a) => a.scope !== 'out').length} assets`)
      toast(`Submitted ${p.id} to the reviewer`)
    },
  }
}

export function useReopen(p: Project) {
  const { A, confirm, toast } = useStore()
  return () => confirm({
    title: `Reopen project ${p.id}?`, body: 'The project returns to Active and becomes editable again. This action is recorded in the audit log.', confirmLabel: 'Reopen Project', danger: true,
    reasonLabel: 'Reason for reopening', reasonRequired: true, onConfirm: (r) => { A.reopen(p.id, r); toast(`Reopened ${p.id}`) },
  })
}

/* ───────────── PR-04 Scope & ROE ───────────── */
type Sub = 'in' | 'out' | 'roe' | 'docs' | 'hist'
export function ScopeTab({ p }: { p: Project }) {
  const { db, go, can, A, confirm, toast, setPid, pid } = useStore()
  const guard = useGuard(p.id)
  const [sub, setSub] = useState<Sub>('in')
  const [edit, setEdit] = useState(false)
  const assets = db.assets.filter((a) => a.projectId === p.id)
  const list = sub === 'in' ? assets.filter((a) => a.scope !== 'out') : assets.filter((a) => a.scope === 'out')
  const editable = !guard.ro && can('editScope', p.id)
  const why = guard.ro ? guard.reason : 'Only a Red Team Manager or Organization Admin can edit scope.'
  const scopePending = db.approvals.find((a) => a.projectId === p.id && a.type === APR.scope && a.status === 'pending')
  const blocked = db.operations.filter((o) => o.projectId === p.id && ['draft', 'ready', 'pending'].includes(o.status))
  const running = db.operations.filter((o) => o.projectId === p.id && o.status === 'running')
  const hist = db.approvals.filter((a) => a.projectId === p.id && [APR.create, APR.scope].includes(a.type as any))
  const closedP = p.status === 'closed' || p.status === 'cancelled'
  const prevV = prevRoe(p.roeVersion)
  const impact = p.roeStatus !== 'approved' && prevV && ['approved', 'active', 'paused', 'review'].includes(p.status)
    ? { prev: prevV, plans: db.plans.filter((x) => x.projectId === p.id && x.status === 'expired' && x.risks.some((r) => r.startsWith('Re-validation'))), draftOps: db.operations.filter((o) => o.projectId === p.id && ['draft', 'pending', 'ready'].includes(o.status)), running: db.operations.filter((o) => o.projectId === p.id && ['running', 'paused'].includes(o.status)) }
    : null
  const histAudit = db.audit.filter((a) => a.projectId === p.id && /scope|ROE/i.test(a.action))

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
          <Button size="sm" variant="ghost" onClick={() => go('asset', { id: a.id })}>View</Button>
          <Button size="sm" variant="ghost" disabled={!editable} title={editable ? undefined : why} onClick={() => go('asset', { id: a.id, tab: 'edit' })}>Edit</Button>
        </span>
      ),
    },
  ]

  const rePropose = () => {
    A.submitApproval(p.id, APR.scope, 'Resubmitted ROE after addressing reviewer feedback.', p.roeVersion)
    toast('Requested re-approval of scope')
  }
  const download = () => toast(`Downloading ${p.id}_${p.roeVersion.replace(' ', '')}.pdf (simulated)`, 'info')
  const addAsset = () => { if (pid !== p.id) { setPid(p.id); setTimeout(() => go('asset-new'), 80) } else go('asset-new') }

  return (
    <>
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
      <RoeCompare p={p} assets={assets} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Sub> value={sub} onChange={setSub} options={[{ id: 'in', label: `In scope (${assets.filter((a) => a.scope !== 'out').length})` }, { id: 'out', label: `Out of scope (${assets.filter((a) => a.scope === 'out').length})` }, { id: 'roe', label: 'ROE' }, { id: 'docs', label: 'Documents' }, { id: 'hist', label: 'Version history' }]} />
        <div className="flex flex-wrap items-center gap-2">
          {!editable && <Locked reason={why} />}
          <Button icon={Plus} disabled={!editable} title={editable ? undefined : why} onClick={addAsset}>Add Asset</Button>
          <Button variant="primary" icon={Pencil} disabled={!editable || closedP} title={!editable ? why : closedP ? 'Project is closed — read-only.' : undefined} onClick={() => setEdit(true)}>{p.roeStatus === 'approved' && p.status !== 'draft' ? `Edit scope (new ${bumpRoeLabel(p.roeVersion)} draft)` : 'Edit Draft'}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {(sub === 'in' || sub === 'out') && (
            <Table cols={cols} rows={list} rowKey={(a) => a.id} onRow={(a) => go('asset', { id: a.id })} empty={<Empty title={sub === 'in' ? 'No in-scope assets' : 'No out-of-scope assets'}>{sub === 'in' ? 'At least one in-scope asset is required to submit for approval.' : 'Declare excluded assets to prevent accidental impact.'}</Empty>} />
          )}
          {sub === 'roe' && <RoePanel p={p} download={download} />}
          {sub === 'docs' && (
            <Card>
              <CardHeader title="Related documents" />
              <ul className="divide-y divide-line/60">
                {[`${p.id}_${p.roeVersion}.pdf`, `${p.id}_technical-contract.pdf`].map((f) => (
                  <li key={f} className="flex min-h-12 items-center gap-3 py-2"><FileText size={16} className="text-muted" /><span className="flex-1 font-mono text-[13px]">{f}</span><Button size="sm" icon={Download} onClick={() => toast(`Downloading ${f} (simulated)`, 'info')}>Download</Button></li>
                ))}
              </ul>
            </Card>
          )}
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
          <RoePanel p={p} download={download} compact />
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

      {edit && <EditScope p={p} onClose={() => setEdit(false)} confirmReason={(patch) => {
        const needRe = ['approved', 'active'].includes(p.status) && p.roeStatus === 'approved'
        if (needRe) {
          setEdit(false)
          confirm({ title: 'Edit an approved scope?', body: `This creates ${bumpRoeLabel(p.roeVersion)} as a new draft and sends it for approval. ${db.plans.filter((x) => x.projectId === p.id && x.status === 'approved').length} approved plan(s) will need re-approval and ${db.operations.filter((x) => x.projectId === p.id && x.status === 'ready').length} ready operation(s) return to Draft. Running operations continue under ${p.roeVersion} until the new version is approved.`, confirmLabel: 'Submit change', danger: true, reasonLabel: 'Reason for scope change', reasonRequired: true, onConfirm: (r) => { A.editScope(p.id, patch, r); toast(`${bumpRoeLabel(p.roeVersion)} created. Dependent plans and operations need re-validation`, 'warn') } })
        } else { A.editScope(p.id, patch); toast('Scope updated'); setEdit(false) }
      }} />}
    </>
  )
}

const prevRoe = (v: string) => { const m = v.match(/^(.*v)(\d+)$/); return m && +m[2] > 1 ? `${m[1]}${+m[2] - 1}` : '' }
const bumpRoeLabel = (v: string) => v.replace(/v(\d+)$/, (_, n) => `v${+n + 1}`)

/** PR-V3-04: effective (approved) version vs proposed/draft version, with a scope diff */
function RoeCompare({ p, assets }: { p: Project; assets: { id: string; name: string; scope: string }[] }) {
  const approved = p.roeStatus === 'approved'
  const prev = prevRoe(p.roeVersion)
  const effective = approved ? p.roeVersion : prev
  const effAssets = assets.filter((a) => a.scope === 'in')
  const added = assets.filter((a) => a.scope === 'pending')
  const excluded = assets.filter((a) => a.scope === 'out')
  const proposed = approved ? null : p.roeVersion
  return (
    <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Effective version" sub="What policy enforces today" actions={effective ? <Status kind="roe" value="approved" label={`${effective} approved`} /> : <Status kind="roe" value="none" label="None approved yet" />} />
        <DescList cols={1} items={[
          { k: 'Approved assets', v: <span>{effAssets.length}{effAssets.length ? <span className="text-muted"> — {effAssets.map((a) => a.name).join(', ')}</span> : ''}</span> },
          { k: 'Excluded assets', v: excluded.length || 'None' },
          { k: 'Assessment window', v: effective ? p.window || '—' : 'Not effective yet' },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Proposed changes" sub={proposed ? 'Not in force until approved' : 'No open proposal'} actions={proposed ? <Status kind="roe" value={p.roeStatus} label={`${proposed} ${p.roeStatus === 'draft' ? 'Draft' : p.roeStatus === 'pending' ? 'Pending approval' : 'Returned'}`} /> : undefined} />
        {!proposed ? <p className="text-sm text-muted">The approved version is current. Editing scope creates a new draft version and sends dependent plans and operations back for re-validation.</p> : (
          <DescList cols={1} items={[
            { k: 'Assets added (pending review)', v: added.length ? <span className="text-ok">+{added.length} <span className="text-muted">— {added.map((a) => a.name).join(', ')}</span></span> : <span className="text-bad">0 assets. At least one is needed to submit</span> },
            { k: 'Assets removed', v: '0' },
            { k: 'Emergency contact', v: p.emergency || <span className="text-bad">Missing</span> },
            { k: 'Permitted window', v: p.window || <span className="text-bad">Not set</span> },
            { k: 'Impact on plans / operations', v: effective ? 'Approved plans and ready operations are marked Re-validation Required' : 'No approved plans or operations exist yet' },
          ]} />
        )}
      </Card>
    </div>
  )
}

function RoePanel({ p, download, compact }: { p: Project; download: () => void; compact?: boolean }) {
  const approval = useStore().db.approvals.find((a) => a.projectId === p.id && [APR.create, APR.scope].includes(a.type as any))
  return (
    <Card>
      <CardHeader title="Rules of Engagement (ROE)" actions={<Status kind="roe" value={p.roeStatus} />} />
      <DescList cols={1} items={[
        { k: 'Version', v: <span className="font-mono">{p.roeVersion}</span> },
        { k: 'Assessment window', v: p.window || <span className="text-bad">Not set</span> },
        { k: 'Emergency contact', v: p.emergency || <span className="text-bad">Not set. Blocks approval</span> },
        { k: 'Reviewer', v: approval?.reviewer || '—' },
        ...(compact ? [] : [{ k: 'Description', v: p.desc }]),
        { k: 'Allowed activities', v: p.methods.length ? <ul className="list-inside list-disc">{p.methods.map((m) => <li key={m}>{m}</li>)}</ul> : '—' },
        { k: 'Restrictions', v: p.restrictions.length ? <ul className="list-inside list-disc">{p.restrictions.map((m) => <li key={m}>{m}</li>)}</ul> : '—' },
      ]} />
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><FileText size={16} className="text-muted" /><span className="flex-1 truncate font-mono text-[13px]">{p.id}_{p.roeVersion}.pdf</span><Button size="sm" icon={Download} onClick={download}>Download ROE</Button></div>
    </Card>
  )
}

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
    <Modal open onClose={onClose} title="Edit Scope & ROE" width={620} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!dirty} title={dirty ? undefined : 'No changes to save'} onClick={save}>Save changes</Button></>}>
      <div className="space-y-4">
        <Field label="Assessment window" required error={tried ? err.window : ''}><Input value={f.window} onChange={(e) => setF({ ...f, window: e.target.value })} placeholder="e.g. Mon–Fri, 8:00 PM–4:00 AM (UTC+7)" /></Field>
        <Field label="Emergency contact" required error={tried ? err.emergency : ''}><Input value={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.value })} placeholder="Full name, phone (synthetic)" /></Field>
        <Field label="Allowed activities" hint="One item per line"><Textarea value={f.methods} onChange={(e) => setF({ ...f, methods: e.target.value })} /></Field>
        <Field label="Restrictions" hint="One item per line"><Textarea value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} /></Field>
        <Field label="Scope description"><Textarea value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

/* ───────────── PR-05 / PR-07 Members & Approvals ───────────── */
export function TeamTab({ p }: { p: Project }) {
  const { db, me, go, can, A, confirm, toast } = useStore()
  const guard = useGuard(p.id)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [add, setAdd] = useState(false)
  const [nu, setNu] = useState<{ user: string; role: Role }>({ user: '', role: 'operator' })
  const canEdit = !guard.ro && can('editScope', p.id)
  const why = guard.ro ? guard.reason : 'Only a Red Team Manager or Organization Admin can manage members.'
  const appr = db.approvals.filter((a) => a.projectId === p.id)
  const pend = appr.filter((a) => a.status === 'pending')
  const mayApprove = can('approve', p.id)
  const names = Array.from(new Set(USERS.map((u) => u.name))).filter((n) => !p.members.some((m) => m.user === n) && n !== p.owner)

  const setMembers = (members: Project['members'], act: string, obj: string) => {
    A.updateProject(p.id, { members })
    A.audit(act, obj, p.id)
    toast(act)
  }
  const changeRole = (user: string, role: Role) => setMembers(p.members.map((m) => (m.user === user ? { ...m, role } : m)), `Changed ${user}'s role to ${ROLE_LABEL[role]}`, user)
  const remove = (user: string) => confirm({ title: `Remove ${user} from the project?`, body: 'The member loses access to the project immediately.', confirmLabel: 'Remove member', danger: true, onConfirm: () => setMembers(p.members.filter((m) => m.user !== user), `Removed ${user} from the project`, user) })

  const decide = (a: Approval, d: 'approved' | 'returned', note: string) => {
    const r = A.decideApproval(a.id, d, note)
    if (!r.ok) { setErr(r.error || 'Could not complete the decision'); return }
    setErr(''); toast(d === 'approved' ? `Approved: ${a.type}` : `Returned: ${a.type}`)
  }
  const approve = (a: Approval) => confirm({ title: `Approve “${a.type}”?`, body: `Project ${p.id} moves to its next state based on this decision.`, confirmLabel: 'Approve', reasonLabel: 'Comment (optional)', onConfirm: (r) => (a.type === APR.close ? (A.confirmClose(a.id), toast('Project closure confirmed')) : decide(a, 'approved', r)) })
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
export function CloseTab({ p, setTab }: { p: Project; setTab: (t: string) => void }) {
  const { db, me, go, can, A, confirm, toast } = useStore()
  const guard = useGuard(p.id)
  const reopen = useReopen(p)
  const [modal, setModal] = useState(false)
  const [reason, setReason] = useState('')
  const [noFind, setNoFind] = useState(false)
  const base = closureChecklist(db, p.id)
  const heldAgents = db.agents.filter((a) => a.projectId === p.id && a.op && db.operations.some((o) => o.id === a.op && ['running', 'paused'].includes(o.status)))
  const noFindingsOk = db.findings.filter((f) => f.projectId === p.id && ['confirmed', 'remediation', 'retest', 'resolved'].includes(f.status)).length === 0
  const items = [
    ...base.map((i) => (i.id === 'c3' && noFind && noFindingsOk ? { ...i, ok: true, detail: 'Waived: approved no-findings closure (documented statement replaces the final report)' } : i)),
    { id: 'c5', label: 'Agent reservations released', ok: heldAgents.length === 0, detail: heldAgents.length ? `Still reserved: ${heldAgents.map((a) => a.id).join(', ')}` : 'No agent is reserved by an active operation', fix: { page: 'agents' } as Route },
  ]
  const ops = db.operations.filter((o) => o.projectId === p.id)
  const fs = db.findings.filter((f) => f.projectId === p.id)
  const reps = db.reports.filter((r) => r.projectId === p.id)
  const evs = db.evidence.filter((e) => e.projectId === p.id)
  const closePending = db.approvals.find((a) => a.projectId === p.id && a.type === APR.close && a.status === 'pending')
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
              <Button variant="primary" onClick={() => confirm({ title: `Approve closure of ${p.id}?`, body: 'The project becomes read-only; data is retained per policy.', confirmLabel: 'Approve Closure', danger: true, onConfirm: () => { A.confirmClose(closePending.id); toast(`Closed ${p.id}`) } })}>Approve Closure</Button>
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

      <Modal open={modal} onClose={() => setModal(false)} title="Close Project" footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" disabled={failing.length > 0 || !reason.trim()} title={failing.length ? 'Resolve the blockers first' : !reason.trim() ? 'A reason is required' : undefined} onClick={() => { A.requestClose(p.id); A.audit(noFind && noFindingsOk ? 'Closure reason (approved no-findings closure)' : 'Closure reason', p.id, p.id, 'Success', reason.trim()); setModal(false); setReason(''); toast('Closure request submitted for sign-off') }}>Submit closure request</Button></>}>
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
