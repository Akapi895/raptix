import { useState, type ReactNode } from 'react'
import { AlertTriangle, Bell, CheckCircle2, CircleHelp, Clock, Download, KeyRound, Lock, LogOut, MinusCircle, MoreHorizontal, OctagonX, Plug, RefreshCw, Save, ShieldAlert, ShieldCheck, Trash2, UserPlus, XCircle } from 'lucide-react'
import { useStore, useDirty } from '../store'
import { ROLE_LABEL } from '../auth/policy'
import { USERS, TECHNIQUES, type Integration, type Policy, type Retention, type Role, type DetectState } from '../data'
import { OrgReadError, useAudit, useIntegrationWrites, useIntegrations, useOrgMembers, useOrgProfile, useOrgWrites, usePolicies, usePolicyWrites, useRetention, useRetentionWrites } from '../features/settings/query'
import { auditCorr, type AuditRead, type IntegrationsRead, type OrgMembersRead, type OrgProfile, type OrgProfileRead, type PoliciesRead, type RetentionRead } from '../features/settings/service'
import { Avatar, Banner, Button, Card, CardHeader, DescList, Drawer, Empty, Field, FilterBar, Input, Menu, Modal, Mono, PageHeader, Pager, SearchBox, Segmented, Select, Skeleton, Status, Table, Tabs, Textarea, Timeline, Toggle, cx, usePaged } from '../ui'

type TabId = 'org' | 'users' | 'integrations' | 'policies' | 'retention' | 'templates' | 'detection' | 'audit' | 'notifications' | 'security'
const ROLES: Role[] = ['admin', 'manager', 'operator', 'reviewer', 'analyst', 'viewer']

function Forbidden({ reason }: { reason: string }) {
  return <Empty icon={Lock} title="You do not have access to this section">{reason}</Empty>
}
const ReadOnlyNote = ({ children }: { children: ReactNode }) => <p className="mb-4 flex items-start gap-1.5 text-xs text-muted"><Lock size={13} className="mt-0.5 shrink-0" />{children}</p>

export function SettingsPage() {
  const { route, go, me } = useStore()
  const tab = (route.tab || 'org') as TabId
  const r = me.role
  const staff = r !== 'viewer' && r !== 'operator' && r !== 'analyst'
  const acc: Record<TabId, { ok: boolean; why: string }> = {
    org: { ok: true, why: '' },
    users: { ok: staff, why: 'The user list is visible to Organization Admins, Red Team Managers and Reviewers. Ask an admin if you need access.' },
    integrations: { ok: staff, why: 'Integrations are visible to Organization Admins, Red Team Managers and Reviewers.' },
    policies: { ok: r !== 'viewer', why: 'The Client / Viewer role cannot view organization policies.' },
    retention: { ok: staff, why: 'Retention policies are visible to Organization Admins, Red Team Managers and Reviewers.' },
    templates: { ok: r !== 'viewer', why: 'The Client / Viewer role cannot view report templates.' },
    detection: { ok: r !== 'viewer', why: 'The Client / Viewer role cannot view detection mapping.' },
    audit: { ok: staff, why: 'The audit log is visible to Organization Admins, Red Team Managers and Reviewers.' },
    notifications: { ok: true, why: '' },
    security: { ok: true, why: '' },
  }
  const labels: [TabId, string][] = [['org', 'Organization'], ['users', 'Users & roles'], ['integrations', 'Integrations'], ['policies', 'Policies'], ['retention', 'Retention'], ['templates', 'Templates'], ['detection', 'Detection'], ['audit', 'Audit log'], ['notifications', 'Notifications'], ['security', 'Security']]
  const body = () => {
    if (!acc[tab]) return <Empty title="Settings section not found" />
    if (!acc[tab].ok) return <Forbidden reason={acc[tab].why} />
    switch (tab) {
      case 'org': return <OrgTab />
      case 'users': return <UsersTab />
      case 'integrations': return <IntegrationsTab />
      case 'policies': return <PoliciesTab />
      case 'retention': return <RetentionTab />
      case 'templates': return <TemplatesTab />
      case 'detection': return <DetectionTab />
      case 'audit': return <AuditTab />
      case 'notifications': return <NotifTab />
      case 'security': return <SecurityTab />
    }
  }
  const personal = tab === 'notifications' || tab === 'security'
  return (
    <>
      <PageHeader title="Organization Settings" meta={<span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent"><ShieldCheck size={12} aria-hidden />Organization-wide</span>} sub="Acme Security (Demo) · Raptix Workspace — Test Lab. This is a simulation: the backend enforces every control." />
      <div role="note" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-accent-line bg-accent-soft px-4 py-2.5 text-sm">
        <span className="font-semibold text-accent">Organization-wide</span>
        <span className="min-w-0 flex-1 text-fg">{personal ? 'You are in your personal preferences. They apply to you across all projects and never change organization policy. Emergency and expired-access alerts cannot be muted by quiet hours.' : 'Changes here apply to every project in this workspace, including RT-2026-014 and RT-2026-017, and to running operations and sessions. Project-specific settings (ROE, scope, members) live inside each project. Every change is audited.'}</span>
      </div>
      <Tabs value={tab} onChange={(t) => go('settings', { tab: t })} tabs={labels.map(([id, label]) => ({ id, label, icon: acc[id].ok ? undefined : Lock }))} />
      {body()}
    </>
  )
}

/* ───────── ST-10 Organization / workspace general (ticket 56: typed service) ───────── */
function OrgTab() {
  const q = useOrgProfile()
  if (q.isPending) return <div aria-busy="true" aria-label="Loading organization settings"><Skeleton className="h-96" /></div>
  if (q.isError || !q.data) return <Empty icon={AlertTriangle} title="Organization settings unavailable" action={<Button onClick={() => q.refetch()}>Retry</Button>}>{q.error instanceof OrgReadError ? q.error.failure.message : 'The organization profile could not be loaded.'}</Empty>
  return <OrgForm read={q.data} />
}

function OrgForm({ read }: { read: OrgProfileRead }) {
  const { me, toast } = useStore()
  const writes = useOrgWrites()
  const admin = me.role === 'admin'
  const saved = read.profile
  const [f, setF] = useState<OrgProfile>(saved)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const save = async () => {
    setErr(''); setBusy(true)
    const res = await writes.updateProfile(f)
    setBusy(false)
    if (!res.ok) { setErr(res.failure.message); return }
    toast('Organization settings saved')
  }
  useDirty(dirty && admin, save)
  const set = (k: keyof OrgProfile, v: string) => setF({ ...f, [k]: v })
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <div>
        {!admin && <ReadOnlyNote>Only Organization Admins can edit these settings. Ask an admin to change them; you are viewing read-only.</ReadOnlyNote>}
        {err && <Banner tone="bad" title="Change not saved">{err}</Banner>}
        <Card>
          <CardHeader title="Organization profile" actions={<>
            <Button disabled={!dirty || busy} title={dirty ? 'Discard unsaved changes' : 'No changes to discard'} onClick={() => { setF(saved); setErr('') }}>Reset</Button>
            <Button variant="primary" icon={Save} disabled={!admin || !dirty || busy || !f.name.trim()} title={!admin ? 'Only Organization Admins can save' : !dirty ? 'No changes to save' : !f.name.trim() ? 'Enter an organization name' : undefined} onClick={save}>Save</Button>
          </>} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Organization name" required error={!f.name.trim() ? 'Required.' : ''}><Input value={f.name} disabled={!admin} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Current workspace" hint="Switch workspaces from the list on the right."><Input value="Raptix Workspace — Test Lab" readOnly disabled /></Field>
            <Field label="Logo"><div className="flex items-center gap-3"><Avatar name="Acme Security" size={40} /><Button disabled={!admin} title={admin ? undefined : 'Only Organization Admins can change the logo'} onClick={() => toast('Simulated: choose a logo file (PNG/SVG, up to 1 MB).', 'info')}>Change logo</Button></div></Field>
            <Field label="Time zone"><Select value={f.tz} disabled={!admin} onChange={(e) => set('tz', e.target.value)}><option>Asia/Ho_Chi_Minh (UTC+7)</option><option>UTC (UTC+0)</option></Select></Field>
            <Field label="Date format"><Select value={f.dateFmt} disabled={!admin} onChange={(e) => set('dateFmt', e.target.value)}><option>MMM D, YYYY</option><option>YYYY-MM-DD</option></Select></Field>
            <Field label="Default landing page"><Select value={f.landing} disabled={!admin} onChange={(e) => set('landing', e.target.value)}><option>Dashboard</option><option>Projects</option><option>Approvals</option></Select></Field>
            <Field label="Language" hint="English only for now."><Select value="en" disabled><option value="en">English</option></Select></Field>
            <Field label="Admin contact" className="md:col-span-2" hint={read.contactMasked ? 'Masked for your role; only Organization Admins see the full address.' : undefined}><Input type="email" value={f.contact} disabled={!admin} onChange={(e) => set('contact', e.target.value)} /></Field>
            <Field label="Data policy" className="md:col-span-2"><Textarea value={f.policy} disabled={!admin} onChange={(e) => set('policy', e.target.value)} /></Field>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Workspaces" sub="Choose the default workspace at sign-in." />
        <ul className="space-y-2">
          {read.workspaces.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{w.name}</div><div className="text-xs text-muted"><Mono className="whitespace-nowrap">{w.id}</Mono> · {w.state}</div></div>
              {f.defWorkspace === w.id ? <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] text-accent">Default</span> : <Button size="sm" disabled={!admin || w.state === 'Read-only'} title={!admin ? 'Only Organization Admins' : w.state === 'Read-only' ? 'A read-only workspace cannot be the default' : undefined} onClick={() => set('defWorkspace', w.id)}>Set default</Button>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

/* ───────── ST-02/03 Users & roles (ticket 56: typed service) ───────── */
const SPEC_ROLES: Role[] = ['admin', 'manager', 'reviewer', 'operator', 'analyst', 'viewer']
const MATRIX: [string, string[]][] = [
  ['View allowed project', ['Y', 'Y', 'Y', 'Y', 'Y', 'R']], ['Create project draft', ['Y', 'Y', '—', 'Req', '—', '—']], ['Approve project / ROE', ['Y', 'Req', 'Y', '—', '—', '—']],
  ['Create AI plan draft', ['Y', 'Y', 'R', 'Y', 'Req', '—']], ['Approve AI plan', ['Y', 'Req', 'Y', '—', '—', '—']], ['Run approved operation', ['Y', 'Y*', '—', 'Y*', '—', '—']],
  ['View live operation', ['Y', 'Y', 'R', 'Y', 'R', 'Restricted']], ['Request session access', ['Y', 'Y', 'R', 'Req', 'Req', '—']], ['Approve session access', ['Y', 'Y*', 'Y*', '—', '—', '—']],
  ['Interact with approved demo console', ['Y*', 'Y*', '—', 'Y*', 'Req', '—']], ['Review / confirm finding', ['Y', 'Req', 'Y', 'Req', 'Req', 'R']], ['Approve report', ['Y', 'Req', 'Y', '—', '—', '—']],
  ['Export / deliver report', ['Y*', 'Y*', 'R', '—', '—', 'R (delivered only)']], ['Change org policy', ['Y', '—', '—', '—', '—', '—']], ['Emergency Stop', ['Y', 'Y', 'Y*', 'Y*', '—', '—']],
]
const CELL: Record<string, { tip: string; cls: string }> = {
  Y: { tip: 'Can perform', cls: 'text-ok' }, 'Y*': { tip: 'Can perform only when project-specific policy or approval allows it', cls: 'text-ok' }, R: { tip: 'Read-only view', cls: 'text-cyan' },
  Req: { tip: 'Must request approval; cannot approve own request', cls: 'text-warn' }, '—': { tip: 'No access', cls: 'text-neutral' }, Restricted: { tip: 'Restricted view', cls: 'text-cyan' }, 'R (delivered only)': { tip: 'Read-only, delivered reports only', cls: 'text-cyan' },
}
const corr = auditCorr
const actorType = (a: { actor: string; role: string }) => a.actor === 'AI Operator' ? 'AI' : a.role === 'System' || a.actor === 'System' ? 'System' : 'Human'
const utcOf = (at: string) => { const t = Date.parse(at.replace(/\s*\(UTC\+7\)/, '')); return Number.isNaN(t) ? '—' : new Date(t - 7 * 3600000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (UTC)' }
function UsersTab() {
  const q = useOrgMembers()
  if (q.isPending) return <div aria-busy="true" aria-label="Loading users"><Skeleton className="h-72" /></div>
  if (q.isError || !q.data) return <Forbidden reason={q.error instanceof OrgReadError ? q.error.failure.message : 'The user list could not be loaded.'} />
  return <UsersPanel read={q.data} />
}
function UsersPanel({ read }: { read: OrgMembersRead }) {
  const { me, toast, confirm, A } = useStore()
  const writes = useOrgWrites()
  const admin = read.canEdit
  const [view, setView] = useState<'users' | 'roles' | 'invites'>('users')
  const [open, setOpen] = useState(false)
  const [hist, setHist] = useState<string | null>(null)
  const [inv, setInv] = useState({ email: '', role: 'operator' as Role, project: '', days: '7', note: '' })
  const [touched, setTouched] = useState(false)
  const [invErr, setInvErr] = useState('')
  const why = 'Only Organization Admins can change user access. Ask an admin to make the change.'
  const emailErr = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inv.email) ? 'Enter a valid email address.' : [...read.members.map((u) => u.email), ...read.invites.map((i) => i.email)].includes(inv.email) ? 'This email already exists or has been invited.' : ''
  const roleErr = inv.role === 'admin' && inv.project ? 'Organization Admins have organization-wide access. Clear the project to continue.' : ''
  const send = async () => {
    setTouched(true); setInvErr('')
    if (emailErr || roleErr) return
    const res = await writes.inviteMember({ email: inv.email, role: inv.role, project: inv.project, days: inv.days, note: inv.note })
    if (!res.ok) { setInvErr(res.failure.message); return }
    toast(`Invitation sent to ${inv.email}`); setOpen(false); setTouched(false); setInv({ ...inv, email: '', note: '' }); setView('invites')
  }
  const act = (name: string, kind: 'lock' | 'unlock' | 'revoke') => confirm({
    title: `${kind === 'lock' ? 'Disable account for' : kind === 'unlock' ? 'Re-enable' : 'Revoke access for'} ${name}?`, body: kind === 'revoke' ? 'The user loses all project access. This is audited.' : 'This is audited.',
    confirmLabel: 'Confirm', danger: kind !== 'unlock', reasonLabel: 'Reason', reasonRequired: kind !== 'unlock',
    onConfirm: (reason) => { void writes.setMemberStatus(name, kind, reason).then((res) => { if (res.ok) toast('User updated'); else toast(res.failure.message, 'bad') }) },
  })
  const changeRole = (name: string, cur: Role, role: Role) => { if (role === cur) return; confirm({ title: `Change role for ${name}`, body: `${ROLE_LABEL[cur]} to ${ROLE_LABEL[role]}. The new permissions apply immediately and are audited.`, confirmLabel: 'Change Role', danger: role === 'admin', reasonLabel: 'Reason', reasonRequired: true, onConfirm: (reason) => { void writes.setMemberRole(name, role, reason).then((res) => { if (res.ok) toast('Role changed'); else toast(res.failure.message, 'bad') }) } }) }
  const users = read.members
  const invites = read.invites
  const histMember = read.members.find((m) => m.name === hist)
  const histRows = histMember?.history ?? []
  return (
    <>
      <FilterBar right={<Button variant="primary" icon={UserPlus} disabled={!admin} title={admin ? undefined : why} onClick={() => setOpen(true)}>Invite User</Button>}>
        <Segmented value={view} onChange={setView} options={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles & permissions' }, { id: 'invites', label: `Invitations (${invites.length})` }]} />
      </FilterBar>
      {!admin && <ReadOnlyNote>{why} You are viewing read-only.</ReadOnlyNote>}
      {view === 'users' && (
        <Table rows={users} rowKey={(u) => u.name} cols={[
          { key: 'n', header: 'User', render: (u) => <div className="flex items-center gap-3"><Avatar name={u.name} /><div><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></div></div> },
          { key: 'r', header: 'Role', render: (u) => admin ? <Select aria-label={`Role of ${u.name}`} className="!h-9 w-48" value={u.role} onChange={(e) => changeRole(u.name, u.role, e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select> : ROLE_LABEL[u.role] },
          { key: 'p', header: 'Projects', hideBelow: 'md', render: (u) => { const ps = u.role === 'admin' || u.role === 'manager' || u.role === 'reviewer' ? 'All projects' : u.projects.join(', ') || '—'; return <span className="text-sm">{u.revoked ? 'Revoked' : ps}</span> } },
          { key: 's', header: 'Status', render: (u) => <Status kind="generic" value={u.revoked ? 'bad' : u.locked ? 'warn' : 'ok'} label={u.revoked ? 'Access revoked' : u.locked ? 'Disabled' : 'Active'} /> },
          { key: 'i', header: 'Invited', hideBelow: 'lg', render: () => <span className="text-muted">Sep 1, 2026</span> },
          { key: 'l', header: 'Last active', hideBelow: 'lg', render: (u) => <span className="text-muted">{u.name === me.name ? 'Online now' : 'Oct 13, 2026, 9:' + String(10 + (u.name.length * 7) % 50) + ' AM (UTC+7)'}</span> },
          { key: 'x', header: '', render: (u) => <Menu trigger={<Button size="sm" icon={MoreHorizontal} aria-label={`Actions for ${u.name}`}>Actions</Button>} items={[
            { label: 'View Access History', onClick: () => setHist(u.name) },
            { label: u.locked ? 'Re-enable account' : 'Disable Account', onClick: () => act(u.name, u.locked ? 'unlock' : 'lock'), disabled: !admin || u.self, hint: !admin ? 'Admins only' : u.self ? 'You cannot disable your own account' : undefined },
            { label: 'Revoke access', danger: true, onClick: () => act(u.name, 'revoke'), disabled: !admin || u.self || u.revoked, hint: !admin ? 'Admins only' : undefined },
            { label: 'Assign as reviewer', onClick: () => changeRole(u.name, u.role, 'reviewer'), disabled: !admin || u.role === 'reviewer', hint: !admin ? 'Admins only' : undefined },
          ]} /> },
        ]} />
      )}
      {view === 'roles' && (
        <>
          <div className="no-scrollbar overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="h-11 px-4 font-medium">Action</th>{SPEC_ROLES.map((r) => <th key={r} className="whitespace-nowrap px-3 text-center font-medium">{ROLE_LABEL[r]}</th>)}</tr></thead>
              <tbody>{MATRIX.map(([p, cells]) => (
                <tr key={p} className="h-11 border-b border-line/60 last:border-0"><td className="px-4">{p}</td>{cells.map((c, i) => <td key={i} className="px-2 text-center"><span title={`${ROLE_LABEL[SPEC_ROLES[i]]}: ${CELL[c].tip}`} className={cx('whitespace-nowrap text-xs font-semibold', CELL[c].cls)}>{c}</span></td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mt-3 rounded-lg border border-line bg-bg p-3 text-xs text-muted">
            <span className="font-medium text-fg">Legend:</span> <b className="text-ok">Y</b> can perform · <b className="text-cyan">R</b> read-only · <b className="text-warn">Req</b> requires approval · <b className="text-neutral">—</b> no access · <b className="text-ok">*</b> only when a project-specific policy or approval allows it.
            <p className="mt-1">Separation of duties: the creator of a proposal cannot approve it when policy requires it. Requesting and performing are separate permissions. This matrix is a UX proposal for demo purposes; real permissions are decided by the backend. The demo role switch (Security tab) is a demo tool, not a real permission.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!admin} title={admin ? undefined : why} onClick={() => toast('Simulated: role editor opened as a draft.', 'info')}>Create Role</Button>
            <Button disabled={!admin} title={admin ? undefined : why} onClick={() => toast('Simulated: no pending permission changes.', 'info')}>Review Permission Changes</Button>
            <Button disabled={!admin} title={admin ? undefined : why} onClick={() => { A.audit('Saved role policy draft (simulated)', 'ROLES', '', 'Success', ''); toast('Policy draft saved') }}>Save Policy Draft</Button>
            <Button variant="primary" disabled={!admin} title={admin ? undefined : why} onClick={() => { A.audit('Requested role policy approval (simulated)', 'ROLES', '', 'Pending', ''); toast('Approval requested from the Reviewer group') }}>Request Approval</Button>
          </div>
        </>
      )}
      {view === 'invites' && (
        <Table rows={invites} rowKey={(i) => i.email} empty={<Empty icon={UserPlus} title="No invitations yet">Sent invitations appear here with their expiry.</Empty>} cols={[
          { key: 'e', header: 'Email', render: (i) => i.email }, { key: 'r', header: 'Role', render: (i) => ROLE_LABEL[i.role] }, { key: 'p', header: 'Project', render: (i) => i.project || 'Organization-wide' },
          { key: 'd', header: 'Expires in', render: (i) => `${i.days} days` }, { key: 's', header: 'Status', render: () => <Status kind="approval" value="pending" label="Sent, awaiting acceptance" /> },
        ]} />
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite User" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={send}>Send invitation</Button></>}>
        <div className="space-y-4">
          <Field label="Email" required error={(touched && emailErr) || invErr}><Input type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="name@company.example.test" /></Field>
          <Field label="Role" required error={touched ? roleErr : ''}><Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
          <Field label="Project access"><Select value={inv.project} onChange={(e) => setInv({ ...inv, project: e.target.value })}><option value="">Organization-wide</option>{read.projectOptions.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}</Select></Field>
          <Field label="Invitation expiry"><Select value={inv.days} onChange={(e) => setInv({ ...inv, days: e.target.value })}><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option></Select></Field>
          <Field label="Notes"><Textarea value={inv.note} onChange={(e) => setInv({ ...inv, note: e.target.value })} /></Field>
        </div>
      </Modal>
      <Drawer open={!!hist} onClose={() => setHist(null)} title={`Access history — ${hist || ''}`}>
        {histRows.length === 0 ? <Empty title="No access events">No audit events are recorded for this user yet.</Empty> : <Timeline items={histRows.map((a) => ({ at: a.at, title: `${a.action} — ${a.obj}`, sub: `${a.result}${a.reason ? ' · ' + a.reason : ''}`, tone: a.result === 'Denied' ? 'bad' : a.result === 'Pending' ? 'warn' : 'accent' }))} />}
      </Drawer>
    </>
  )
}

/* ───────── ST-06 Integrations (ticket 57: typed service) ───────── */
function IntegrationsTab() {
  const q = useIntegrations()
  if (q.isPending) return <div aria-busy="true" aria-label="Loading integrations"><Skeleton className="h-96" /></div>
  if (q.isError || !q.data) return <Forbidden reason={q.error instanceof OrgReadError ? q.error.failure.message : 'The integration registry could not be loaded.'} />
  return <IntegrationsPanel read={q.data} />
}

function IntegrationsPanel({ read }: { read: IntegrationsRead }) {
  const { A, toast, confirm } = useStore()
  const writes = useIntegrationWrites()
  const admin = read.canEdit
  const [reauth, setReauth] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [det, setDet] = useState<string | null>(null)
  const why = 'Only Organization Admins can connect or disconnect integrations. Ask an admin.'
  const d = read.integrations.find((i) => i.id === det)
  const setConn = (i: Integration, action: 'connect' | 'disconnect', reason: string, okMsg: string, tone?: 'warn') => {
    void writes.setConnection(i.id, action, reason).then((res) => {
      if (res.ok) toast(okMsg, tone)
      else toast(res.failure.message, 'bad')
    })
  }
  return (
    <>
      {!admin && <ReadOnlyNote>{why} API keys are always masked, and only admins see the configuration area.</ReadOnlyNote>}
      {read.siem && !read.siem.connected && <Banner tone="warn" title="SIEM is not connected">Analysis screens will show "No detection data yet" instead of guessed charts.</Banner>}
      <div className="mb-3 flex justify-end"><Button disabled={!admin} title={admin ? undefined : why} onClick={() => { A.audit('Requested integration (simulated)', 'IN-new', '', 'Pending', ''); toast('Integration request submitted for review', 'info') }}>Request Integration</Button></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {read.integrations.map((i) => (
          <Card key={i.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2"><div><div className="font-medium">{i.name}</div><div className="text-xs text-muted">{i.kind}</div></div><Status kind="integ" value={i.status} /></div>
            {i.status === 'authfail' && <Banner tone="bad" title="Authentication failed">{i.history[0]?.split('— ')[1] || 'The key is invalid.'}. Integration data is not syncing.</Banner>}
            <DescList cols={1} items={[{ k: 'Data scope', v: i.scope }, { k: 'Owner', v: i.owner }, { k: 'Last sync', v: i.updated }, { k: 'Access key', v: <span className="inline-flex items-center gap-1.5 font-mono text-[13px]"><KeyRound size={13} aria-hidden />{i.secret} <span className="font-sans text-xs text-muted">(masked)</span></span> }]} />
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              {i.status === 'authfail'
                ? <Button size="sm" variant="primary" icon={KeyRound} disabled={!admin} title={admin ? undefined : why} onClick={() => { setKey(''); setReauth(i.id) }}>Re-enter key</Button>
                : i.status === 'connected'
                  ? <Button size="sm" variant="danger" disabled={!admin} title={admin ? undefined : why} onClick={() => confirm({ title: `Disconnect ${i.name}?`, body: 'Integration data stops syncing; dependent screens will show "No data".', confirmLabel: 'Disconnect', danger: true, reasonLabel: 'Reason', reasonRequired: true, onConfirm: (rs) => setConn(i, 'disconnect', rs, `Disconnected ${i.name}`, 'warn') })}>Disconnect</Button>
                  : <Button size="sm" variant="primary" icon={Plug} disabled={!admin} title={admin ? undefined : why} onClick={() => setConn(i, 'connect', '', `Connected ${i.name}`)}>Connect</Button>}
              <Button size="sm" icon={RefreshCw} disabled={i.status !== 'connected'} title={i.status !== 'connected' ? 'Connect the integration before testing it' : undefined} onClick={() => toast(`Test Connection for ${i.name}: passed (simulated, 142 ms)`)}>Test Connection</Button>
              <Button size="sm" variant="ghost" onClick={() => setDet(i.id)}>View Details</Button>
            </div>
          </Card>
        ))}
      </div>
      <Modal open={!!reauth} onClose={() => setReauth(null)} title="Re-enter access key" footer={<><Button onClick={() => setReauth(null)}>Cancel</Button><Button variant="primary" disabled={key.length < 8} title={key.length < 8 ? 'The key needs at least 8 characters' : undefined} onClick={() => { if (reauth) { void writes.reauthenticate(reauth, key).then((res) => { toast(res.ok ? 'Re-authenticated. The key is masked and stored in the backend.' : res.failure.message, res.ok ? undefined : 'bad') }) } setReauth(null) }}>Authenticate</Button></>}>
        <Field label="API key / token" hint="The value is masked and never shown again after saving (simulated)."><Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></Field>
      </Modal>
      <Drawer open={!!d} onClose={() => setDet(null)} title={d ? `Details — ${d.name}` : ''}>
        {d && <Timeline items={d.history.map((h) => { const [at, t] = h.split(' — '); return { at, title: t || h, tone: /fail/i.test(h) ? 'bad' : 'accent' } })} />}
      </Drawer>
    </>
  )
}

/* ───────── ST-05/07/09 Policies ───────── */
const APPROVAL_MATRIX = [
  { id: 'PM-1', name: 'Project creation', impact: 'New projects start as Pending Approval', ver: 'v1.2', prev: 'v1.1', owner: 'Dana Whitfield', req: 'Red Team Manager, Operator (request)', appr: 'Reviewer, Org Admin', diff: 'Operators may now request a draft; approval still needs a Reviewer.' },
  { id: 'PM-2', name: 'Scope change', impact: 'Plans and operations are re-validated; ROE needs a new version', ver: 'v1.4', prev: 'v1.3', owner: 'Dana Whitfield', req: 'Red Team Manager', appr: 'Reviewer', diff: 'Added: running operations show a re-validation required notice.' },
  { id: 'PM-3', name: 'Run operation', impact: 'Operation cannot start with a failed preflight check', ver: 'v2.0', prev: 'v1.9', owner: 'Dana Whitfield', req: 'Operator, Red Team Manager', appr: 'Red Team Manager (project policy)', diff: 'Eligibility now requires an approved ROE and at least one online project agent.' },
  { id: 'PM-4', name: 'Prohibited assets', impact: 'Out-of-scope assets never appear in target pickers', ver: 'v1.1', prev: 'v1.0', owner: 'Dana Whitfield', req: 'Red Team Manager', appr: 'Org Admin only', diff: 'Restricted-zone list reviewed Sep 1, 2026.' },
  { id: 'PM-5', name: 'AI tool execution', impact: 'AI proposes; no tool runs without an approved plan', ver: 'v1.3', prev: 'v1.2', owner: 'Dana Whitfield', req: 'Operator, Analyst (plan draft)', appr: 'Reviewer', diff: 'Plan revisions bump the version and need re-approval.' },
  { id: 'PM-6', name: 'Session access', impact: 'Consoles are read-only until a time-boxed grant is approved', ver: 'v1.2', prev: 'v1.1', owner: 'Dana Whitfield', req: 'Operator, Analyst', appr: 'Red Team Manager, Reviewer (if project policy allows)', diff: 'Grants expire automatically; connection state is tracked separately from the grant.' },
  { id: 'PM-7', name: 'Evidence access', impact: 'Sensitive evidence is masked by role', ver: 'v1.0', prev: 'v1.0', owner: 'Pat Kim', req: 'Analyst, Client Viewer', appr: 'Reviewer', diff: 'No earlier version.' },
  { id: 'PM-8', name: 'Report delivery', impact: 'Only approved and exported reports can be delivered', ver: 'v1.1', prev: 'v1.0', owner: 'Pat Kim', req: 'Red Team Manager', appr: 'Reviewer, Org Admin', diff: 'Delivery now records recipient, method and acknowledgement.' },
]
function ApprovalMatrix() {
  const { me, A, toast, confirm } = useStore()
  const [cmp, setCmp] = useState<string | null>(null)
  const c = APPROVAL_MATRIX.find((x) => x.id === cmp)
  const admin = me.role === 'admin'
  return (
    <>
      <Banner tone="info" title="Only Organization Admins approve changes to global policy">Everyone else can request a change; the request is reviewed and audited. Policy changes apply organization-wide, to every project in this workspace.</Banner>
      <Table rows={APPROVAL_MATRIX} rowKey={(x) => x.id} cols={[
        { key: 'n', header: 'Policy', render: (x) => <div className="min-w-[150px]"><div className="font-medium">{x.name}</div><Mono className="text-muted">{x.id}</Mono></div> },
        { key: 'i', header: 'Impact', hideBelow: 'md', render: (x) => <span className="text-sm text-muted">{x.impact}</span> },
        { key: 'v', header: 'Version', render: (x) => <Mono>{x.ver}</Mono> },
        { key: 'o', header: 'Owner', hideBelow: 'lg', render: (x) => <span className="whitespace-nowrap">{x.owner}</span> },
        { key: 'r', header: 'Requested by', hideBelow: 'lg', render: (x) => x.req },
        { key: 'a', header: 'Approved by', hideBelow: 'lg', render: (x) => x.appr },
        { key: 'x', header: '', render: (x) => <div className="flex gap-1.5 whitespace-nowrap">
          <Button size="sm" onClick={() => setCmp(x.id)}>Compare Versions</Button>
          <Button size="sm" onClick={() => confirm({ title: `Request change to "${x.name}"`, body: admin ? 'You are an Org Admin. Separation of duties: another admin or the Policy Owner must approve your own request.' : 'The request goes to the policy owner and Organization Admins. Nothing changes until an admin approves it.', confirmLabel: 'Request Change', reasonLabel: 'What should change and why', reasonRequired: true, onConfirm: (rs) => { A.audit('Requested policy change', x.id, '', 'Pending', rs); toast(`Change requested for ${x.name}. Awaiting Organization Admin approval.`, 'info') } })}>Request Change</Button>
        </div> },
      ]} />
      <Drawer open={!!c} onClose={() => setCmp(null)} title={c ? `${c.name} — compare versions` : ''}>
        {c && <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2"><div className="rounded-lg border border-line bg-bg p-3"><div className="text-xs text-muted">Previous</div><Mono>{c.prev}</Mono></div><div className="rounded-lg border border-accent-line bg-accent-soft p-3"><div className="text-xs text-muted">Current</div><Mono>{c.ver}</Mono></div></div>
          <div><div className="mb-1 text-xs font-medium text-muted">What changed</div><p>{c.diff}</p></div>
          <div><div className="mb-1 text-xs font-medium text-muted">Scope of impact</div><p>Organization-wide. {c.impact}.</p></div>
          <p className="text-xs text-neutral">Simulated comparison; the backend keeps the full version history.</p>
        </div>}
      </Drawer>
    </>
  )
}

function PoliciesTab() {
  const [pv, setPv] = useState<'matrix' | 'list'>('matrix')
  return (
    <>
      <div className="mb-4"><Segmented value={pv} onChange={setPv} options={[{ id: 'matrix', label: 'Approval matrix' }, { id: 'list', label: 'Policy switches & session rules' }]} /></div>
      {pv === 'matrix' ? <ApprovalMatrix /> : <PolicyList />}
    </>
  )
}

function PolicyList() {
  const q = usePolicies()
  if (q.isPending) return <div aria-busy="true" aria-label="Loading policies"><Skeleton className="h-96" /></div>
  if (q.isError || !q.data) return <Forbidden reason={q.error instanceof OrgReadError ? q.error.failure.message : 'The policy list could not be loaded.'} />
  return <PolicyListPanel read={q.data} />
}

function PolicyListPanel({ read }: { read: PoliciesRead }) {
  const { A, toast, confirm } = useStore()
  const writes = usePolicyWrites()
  const admin = read.canEdit
  const why = 'Only Organization Admins can enable or disable policies. Ask an admin to request the change.'
  const [sim, setSim] = useState({ role: 'operator' as Role, type: 'Interactive', approved: true })
  const allowed = (sim.role === 'operator' || sim.role === 'manager') && sim.approved && sim.type !== 'Unapproved type'
  const reason = !sim.approved ? 'Denied: no approved, time-boxed access grant (PL-11).' : sim.role !== 'operator' && sim.role !== 'manager' ? `Denied: the ${ROLE_LABEL[sim.role]} role cannot open interactive sessions.` : sim.type === 'Unapproved type' ? 'Denied: this session type is not allowed for the project.' : 'Allowed: approved grant, permitted role, session type allowed in the project.'
  const setEnabled = (p: Policy, enabled: boolean, rs = '') => {
    void writes.setEnabled(p.id, enabled, rs).then((res) => {
      if (res.ok) toast(`${enabled ? 'Enabled' : 'Disabled'} "${p.name}"`, enabled ? undefined : 'warn')
      else toast(res.failure.message, 'bad')
    })
  }
  return (
    <>
      <Banner tone="info" title="Policy simulation">This screen simulates policies. Enforcement is independent of the AI prompt and the frontend; there is no unconditional bypass. Every change is audited.</Banner>
      {!admin && <ReadOnlyNote>{why}</ReadOnlyNote>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {read.policies.map((p) => {
          const hist = read.recentAudit.filter((a) => a.obj === p.id).slice(0, 2)
          const estop = p.id === 'PL-7'
          return (
            <Card key={p.id}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Mono className="whitespace-nowrap text-muted">{p.id}</Mono><span className="font-medium">{p.name}</span></div><p className="mt-0.5 text-sm text-muted">{p.desc}</p></div>
                <div className="flex flex-col items-end gap-1"><Toggle on={p.enabled} label={`${p.enabled ? 'Disable' : 'Enable'} policy ${p.name}`} disabled={!admin} onChange={() => {
                  if (p.enabled) confirm({ title: `Disable policy "${p.name}"?`, body: <>Impact: {p.impact}. Disabling reduces controls and is audited.</>, confirmLabel: 'Disable policy', danger: true, reasonLabel: 'Reason for disabling', reasonRequired: true, onConfirm: (rs) => setEnabled(p, false, rs) })
                  else setEnabled(p, true)
                }} /><span className={cx('inline-flex items-center gap-1 text-xs', p.enabled ? 'text-ok' : 'text-neutral')}>{p.enabled ? <CheckCircle2 size={12} /> : <MinusCircle size={12} />}{p.enabled ? 'Enabled' : 'Disabled'}</span></div>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div><dt className="text-muted">Approvers</dt><dd className="mt-0.5 text-sm">{p.approvers}</dd></div>
                <div><dt className="text-muted">Approvals required</dt><dd className="mt-0.5 text-sm">{p.count || 'None'}</dd></div>
                <div><dt className="text-muted">Updated</dt><dd className="mt-0.5 text-sm">{p.updated}</dd></div>
              </dl>
              <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-xs text-muted"><span className="font-medium text-fg">Impact:</span> {p.impact}</p>
              {estop && <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs"><OctagonX size={13} className="mt-0.5 shrink-0 text-bad" aria-hidden /><span><span className="font-medium">Emergency stop policy:</span> stopped operations and sessions never restart automatically. Scope is This Operation, This Project or Workspace, only where your role is authorized. A reason is required and the event is audited.</span></p>}
              {hist.length > 0 && <p className="mt-2 text-xs text-muted">Last change: {hist[0].at} by {hist[0].actor}{hist[0].reason ? ` — ${hist[0].reason}` : ''}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => toast(`Policy ${p.id} version history: current version dated ${p.updated} (simulated).`, 'info')}>Compare Policy Versions</Button>
                <Button size="sm" variant="ghost" disabled={admin} title={admin ? 'Admins change this policy with the toggle above' : undefined} onClick={() => { A.audit('Requested policy change (simulated)', p.id, '', 'Pending', ''); toast(`Policy change requested for ${p.name}`, 'info') }}>Request Policy Change</Button>
              </div>
            </Card>
          )
        })}
      </div>

      <h2 className="mb-2 mt-8 text-base font-semibold">C2 & session policies</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Session access configuration" sub="Describes control behavior only; no channel or payload details are shown." />
          <DescList cols={1} items={[
            { k: 'Session types allowed per project', v: 'Observe, Interactive (grant required)' },
            { k: 'Role-based access', v: 'Operator and Red Team Manager request; Red Team Manager approves' },
            { k: 'Approval validity', v: '60 minutes, then expires automatically' },
            { k: 'Idle timeout', v: '15 minutes' },
            { k: 'Recording & redaction', v: 'Transcripts recorded; secrets redacted' },
            { k: 'Termination policy', v: 'Revoke on operation stop, expiry or emergency stop' },
          ]} />
        </Card>
        <Card>
          <CardHeader title="Access decision simulation" sub="Preview the outcome for a request." />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Role"><Select value={sim.role} onChange={(e) => setSim({ ...sim, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
            <Field label="Session type"><Select value={sim.type} onChange={(e) => setSim({ ...sim, type: e.target.value })}><option>Interactive</option><option>Unapproved type</option></Select></Field>
            <Field label="Approved grant"><Select value={sim.approved ? 'yes' : 'no'} onChange={(e) => setSim({ ...sim, approved: e.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></Select></Field>
          </div>
          <div className={cx('mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm', allowed ? 'border-ok/30 bg-ok/5' : 'border-bad/30 bg-bad/5')}>
            {allowed ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden /> : <XCircle size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />}
            <div><div className="font-medium">{allowed ? 'Allowed' : 'Denied'}</div><div className="text-muted">{reason}</div></div>
          </div>
        </Card>
      </div>
    </>
  )
}

/* ───────── Retention (ticket 58: typed service, session-persistent simulation) ───────── */
function RetentionTab() {
  const q = useRetention()
  if (q.isPending) return <div aria-busy="true" aria-label="Loading retention policies"><Skeleton className="h-96" /></div>
  if (q.isError || !q.data) return <Forbidden reason={q.error instanceof OrgReadError ? q.error.failure.message : 'The retention policies could not be loaded.'} />
  return <RetentionPanel read={q.data} />
}

function RetentionPanel({ read }: { read: RetentionRead }) {
  const { toast, confirm } = useStore()
  const writes = useRetentionWrites()
  const admin = read.canEdit
  const why = 'Only Organization Admins can change retention policies. Ask an admin to make the change.'
  const held = (id: string) => read.holds.includes(id)
  const [view, setView] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  const [f, setF] = useState({ period: '', label: '' })
  const [err, setErr] = useState('')
  const expiring = read.policies.filter((r) => r.state === 'Expiring soon' && !held(r.id))
  const v = read.policies.find((r) => r.id === view)
  const e = read.policies.find((r) => r.id === edit)
  const periodErr = !/^\d{1,3} (month|year)s$/.test(f.period.trim()) ? 'Use a positive period such as “24 months”.' : ''
  const labelErr = !f.label.trim() ? 'Required.' : ''
  const dirty = !!e && (f.period.trim() !== e.period || f.label.trim() !== e.label)
  const openEdit = (r: Retention) => { setF({ period: r.period, label: r.label }); setErr(''); setEdit(r.id) }
  const resetEdit = () => { if (e) setF({ period: e.period, label: e.label }); setErr('') }
  const save = async () => {
    if (!e) return
    setErr('')
    const res = await writes.save(e.id, { period: f.period.trim(), label: f.label.trim() })
    if (!res.ok) { setErr(res.failure.message); return }
    toast('Retention policy saved (simulated)'); setEdit(null)
  }
  const hold = (r: Retention, on: boolean) => confirm({
    title: `${on ? 'Place a legal hold on' : 'Release the legal hold on'} "${r.name}"?`,
    body: on ? 'The item will not be deleted on schedule until the hold is released. The hold persists for this demo session and is audited.' : 'The item becomes eligible for scheduled deletion again. The release is audited.',
    confirmLabel: on ? 'Place legal hold' : 'Release hold', danger: on, reasonLabel: on ? 'Legal basis' : 'Reason for releasing', reasonRequired: true,
    onConfirm: (rs) => { void writes.setHold(r.id, on, rs).then((res) => { if (res.ok) toast(on ? 'Legal hold placed' : 'Legal hold released'); else toast(res.failure.message, 'bad') }) },
  })
  const delWhy = (r: Retention) => !admin ? why : held(r.id) ? 'A legal hold is active, so deletion is blocked. Release the hold first.' : r.state !== 'Expired' ? 'Not yet due for deletion under the policy.' : ''
  return (
    <>
      {expiring.map((r) => <Banner key={r.id} tone="warn" title={`Expiring soon: ${r.name}`} action={admin ? <Button size="sm" onClick={() => hold(r, true)}>Place legal hold</Button> : undefined}>Scope {r.scope} expires {r.expires}. Review before data is deleted under the policy.</Banner>)}
      <Banner tone="info" title="Simulated retention controls">Save, hold and delete are validated, permission-gated and persist for this demo session (Demo reset restores the recorded policy). Deletion under policy is recorded and audited; demo data is never destroyed and the backend enforces the real schedule.</Banner>
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {[{ t: 'Close', d: 'The project becomes read-only. Evidence and reports are not deleted.', i: CheckCircle2 }, { t: 'Archive', d: 'Data moves to the archive and stays retrievable by permission during the retention period.', i: Clock }, { t: 'Delete under policy', d: 'Only after expiry, with no legal hold, a confirmation and a reason. Audited.', i: Trash2 }].map((x) => <Card key={x.t}><div className="flex items-center gap-2 font-medium"><x.i size={16} className="text-accent" aria-hidden />{x.t}</div><p className="mt-1 text-sm text-muted">{x.d}</p></Card>)}
      </div>
      {!admin && <ReadOnlyNote>{why}</ReadOnlyNote>}
      <Table rows={read.policies} rowKey={(r) => r.id} cols={[
        { key: 'n', header: 'Policy', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.scope}</div></div> },
        { key: 'p', header: 'Retention', render: (r) => r.period },
        { key: 'l', header: 'Label', hideBelow: 'md', render: (r) => r.label },
        { key: 'o', header: 'Owner', hideBelow: 'lg', render: (r) => r.owner },
        { key: 'e', header: 'Expires', render: (r) => <span className="whitespace-nowrap">{r.expires}</span> },
        { key: 's', header: 'Status', render: (r) => held(r.id) ? <Status kind="generic" value="warn" label="Legal hold" /> : <Status kind="generic" value={r.state === 'Expiring soon' ? 'warn' : r.state.startsWith('Deleted') ? 'bad' : 'ok'} label={r.state} /> },
        { key: 'x', header: '', render: (r) => { const w = delWhy(r); return <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setView(r.id)}>View Retention Policy</Button>
          <Button size="sm" disabled={!admin} title={admin ? undefined : why} onClick={() => openEdit(r)}>Edit</Button>
          {held(r.id)
            ? <Button size="sm" disabled={!admin} title={admin ? undefined : why} onClick={() => hold(r, false)}>Release hold</Button>
            : <Button size="sm" disabled={!admin} title={admin ? undefined : why} onClick={() => hold(r, true)}>Place legal hold</Button>}
          <Button size="sm" variant="danger" icon={Trash2} disabled={!!w} title={w || undefined} onClick={() => confirm({ title: 'Delete under policy?', body: `${r.name} — simulated: the deletion is recorded and audited; demo data is never destroyed.`, confirmLabel: 'Delete', danger: true, reasonLabel: 'Reason', reasonRequired: true, onConfirm: (rs) => { void writes.remove(r.id, rs).then((res) => { if (res.ok) toast('Deletion recorded (simulated)'); else toast(res.failure.message, 'bad') }) } })}>Delete</Button>
        </div> } },
      ]} />
      <Card className="mt-5">
        <CardHeader title="Retention history" sub="Scoped, sensitive-filtered rows from the same canonical history as the Audit log tab." />
        {read.history.length ? <Timeline items={read.history.map((a) => ({ at: a.at, title: `${a.action} — ${a.obj}`, sub: `${a.actor}${a.reason ? ' · ' + a.reason : ''}` }))} /> : <p className="text-sm text-muted">No retention events yet.</p>}
      </Card>
      <Drawer open={!!v} onClose={() => setView(null)} title={v?.name || ''}>
        {v && <DescList cols={1} items={[{ k: 'Scope', v: v.scope }, { k: 'Retention period', v: v.period }, { k: 'Classification label', v: v.label }, { k: 'Storage', v: 'Cold archive, demo region (simulated)' }, { k: 'Export / delete authority', v: `${v.owner} (deletion needs confirmation and a reason)` }, { k: 'Expires', v: v.expires }, { k: 'Legal hold', v: held(v.id) ? 'Active' : 'None' }]} />}
      </Drawer>
      <Modal open={!!e} onClose={() => setEdit(null)} title="Edit retention policy" footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button onClick={resetEdit} disabled={!dirty} title={dirty ? 'Restore the saved values' : 'No changes to discard'}>Reset</Button><Button variant="primary" disabled={!dirty || !!periodErr || !!labelErr} title={!dirty ? 'No changes to save' : periodErr || labelErr || undefined} onClick={save}>Save</Button></>}>
        {e && <div className="space-y-4">
          {err && <Banner tone="bad" title="Change not saved">{err}</Banner>}
          <Field label="Policy"><Input value={e.name} readOnly disabled /></Field>
          <Field label="Retention period" required error={periodErr} hint="Simulated: validated here, enforced by the backend."><Input value={f.period} onChange={(ev) => setF({ ...f, period: ev.target.value })} placeholder="24 months" /></Field>
          <Field label="Classification label" required error={labelErr}><Select value={f.label} onChange={(ev) => setF({ ...f, label: ev.target.value })}>{['Confidential', 'Internal', 'Public'].map((l) => <option key={l}>{l}</option>)}</Select></Field>
        </div>}
      </Modal>
    </>
  )
}

/* ───────── Templates ───────── */
function TemplatesTab() {
  const { db, go, me, setFilter } = useStore()
  const use = (name: string) => { setFilter('reportNewTemplate', name); go('report-new') }
  return (
    <>
      <Banner tone="info" title="Report templates">Published templates can be used for formal reports. Draft templates can only be tried in a draft report and cannot be used for formal delivery. Create, duplicate and publish from Reports.</Banner>
      <Table rows={db.templates} rowKey={(t) => t.id} cols={[
        { key: 'n', header: 'Template', render: (t) => <div><div className="font-medium">{t.name}</div><Mono className="text-muted">{t.id}</Mono></div> },
        { key: 'k', header: 'Type', render: (t) => t.kind },
        { key: 'v', header: 'Version', render: (t) => <Mono>{t.version}</Mono> },
        { key: 's', header: 'Status', render: (t) => <Status kind="generic" value={t.status === 'published' ? 'ok' : 'warn'} label={t.status === 'published' ? 'Published' : 'Draft — not for formal delivery'} /> },
        { key: 'o', header: 'Owner', hideBelow: 'md', render: (t) => t.owner },
        { key: 'u', header: 'Updated', hideBelow: 'md', render: (t) => <span className="whitespace-nowrap">{t.updated}</span> },
        { key: 'x', header: '', render: (t) => <div className="flex gap-1.5 whitespace-nowrap"><Button size="sm" variant="primary" onClick={() => use(t.name)}>{t.status === 'published' ? 'Use template' : 'Try in Draft'}</Button><Button size="sm" onClick={() => go('reports', { tab: 'templates' })} title={me.role === 'admin' ? undefined : 'Admins manage templates; you can view and use them'}>Open in Reports</Button></div> },
      ]} />
    </>
  )
}

/* ───────── Detection ───────── */
const DET_UI: Record<DetectState, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  detected: { label: 'Detected', icon: ShieldCheck, cls: 'text-ok' },
  undetected: { label: 'Not detected', icon: ShieldAlert, cls: 'text-bad' },
  nodata: { label: 'No data', icon: CircleHelp, cls: 'text-neutral' },
}
function DetectionTab() {
  const { db, go } = useStore()
  const siem = db.integrations.find((i) => i.kind === 'SIEM')
  const rows = Object.entries(db.detection).flatMap(([pid, m]) => Object.entries(m).map(([tid, st]) => ({ pid, tid, st, name: TECHNIQUES.find((t) => t.id === tid)?.name || tid })))
  const pg = usePaged(rows, 12)
  return (
    <>
      {siem && siem.status !== 'connected'
        ? <Banner tone="warn" title="Detection source is not connected" action={<Button size="sm" onClick={() => go('settings', { tab: 'integrations' })}>View integrations</Button>}>Mappings below may be stale. Unknown results are shown as "No data", never as guessed values.</Banner>
        : <Banner tone="info" title="Detection mapping">Maps tested techniques to monitoring outcomes from the connected detection source ({siem?.name}). "No data" means nothing was reported, not that nothing happened.</Banner>}
      <Table rows={pg.rows} rowKey={(r) => r.pid + r.tid} cols={[
        { key: 'p', header: 'Project', render: (r) => <Mono className="whitespace-nowrap">{r.pid}</Mono> },
        { key: 't', header: 'Technique', render: (r) => <div><Mono className="whitespace-nowrap">{r.tid}</Mono> <span className="text-muted">{r.name}</span></div> },
        { key: 's', header: 'Detection result', render: (r) => { const u = DET_UI[r.st]; return <span className={cx('inline-flex items-center gap-1.5 text-sm', u.cls)}><u.icon size={14} aria-hidden />{u.label}</span> } },
      ]} />
      <Pager {...pg} />
    </>
  )
}

/* ───────── ST-08 Audit (ticket 58: canonical typed history) ───────── */
const AUDIT_F = { q: '', actor: '', act: '', proj: '', res: '', origin: '', corr: '', kind: '' }
function AuditTab() {
  const { persistFilters, setFilter } = useStore()
  const F = (persistFilters.auditF || AUDIT_F) as typeof AUDIT_F
  const set = (patch: Partial<typeof F>) => setFilter('auditF', { ...F, ...patch })
  const q = useAudit({ q: F.q, actor: F.actor, action: F.act, project: F.proj, result: F.res, origin: F.origin as '' | 'human' | 'ai', corr: F.corr, kind: F.kind as '' | 'estop' })
  if (q.isPending) return <div aria-busy="true" aria-label="Loading audit log"><Skeleton className="h-96" /></div>
  if (q.isError || !q.data) return <Forbidden reason={q.error instanceof OrgReadError ? q.error.failure.message : 'The audit log could not be loaded.'} />
  return <AuditPanel read={q.data} F={F} set={set} clear={() => setFilter('auditF', undefined)} />
}

function AuditPanel({ read, F, set, clear }: { read: AuditRead; F: typeof AUDIT_F; set: (patch: Partial<typeof AUDIT_F>) => void; clear: () => void }) {
  const { A, toast, accessible } = useStore()
  const { q, actor, act, proj, res, origin } = F
  const [sel, setSel] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const isAi = (a: { actor: string }) => a.actor === 'AI Operator'
  const rows = read.items
  const pg = usePaged(rows, 12)
  const canExport = read.canExport
  const exportCsv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const csv = ['Event ID,Time (UTC+7),Time (UTC),Actor Type,Actor,Role,Project,Action,Object,Result,Approval,Correlation ID,Reason', ...rows.map((a) => [a.id, a.at, utcOf(a.at), actorType(a), a.actor, a.role, a.projectId || 'Workspace', a.action, a.obj, a.result, approval(a), corr(a), a.reason].map(esc).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const el = document.createElement('a'); el.href = url; el.download = 'raptix-audit-log-simulated.csv'; el.click(); URL.revokeObjectURL(url)
    A.audit('Exported audit log (CSV)', 'AUDIT', '', 'Success', `${rows.length} records`); toast(`Exported ${rows.length} records (simulated CSV)`)
  }
  const a = rows.find((x) => x.id === sel)
  const tone = (r: string) => r === 'Success' ? 'ok' : r === 'Pending' || r === 'Warning' ? 'warn' : 'bad'
  const approval = (x: { actor: string; action: string; result: string }) => isAi(x) ? 'AI proposal / system (not a human approval)' : /Approved|approved/.test(x.action) ? 'Human approval' : x.result === 'Pending' ? 'Awaiting approval' : '—'
  return (
    <>
      <Banner tone="info" title="Read-only, append-only log">Every consequential action — from legacy screens and migrated features alike — commits to this one history. Records cannot be edited or deleted from this interface. Times are shown in Asia/Ho_Chi_Minh (UTC+7); the event detail also shows UTC. Sensitive content is masked by role. AI-originated proposals are labeled separately from human approvals and actual operation events.</Banner>
      <FilterBar right={<><Button icon={Download} onClick={exportCsv} disabled={!rows.length || !canExport} title={!canExport ? 'Only Organization Admins and Reviewers can export the audit log' : !rows.length ? 'No records to export' : undefined}>Export Audit Log</Button></>}>
        <SearchBox value={q} onChange={(v) => set({ q: v })} placeholder="Search actor, action, object…" className="w-full sm:w-72" />
        <Select aria-label="Correlation ID" className="w-44" value={F.corr} onChange={(e) => set({ corr: e.target.value })}><option value="">All correlation IDs</option>{read.options.corrs.map((x) => <option key={x}>{x}</option>)}</Select>
        <Select aria-label="Result" className="w-36" value={res} onChange={(e) => set({ res: e.target.value })}><option value="">All results</option>{read.options.results.map((x) => <option key={x}>{x}</option>)}</Select>
        <Button size="sm" variant={F.kind ? 'primary' : 'secondary'} icon={OctagonX} aria-pressed={!!F.kind} onClick={() => set({ kind: F.kind ? '' : 'estop' })}>Emergency stop events</Button>
        <Button size="sm" variant={more || actor || act || proj || origin ? 'primary' : 'secondary'} aria-expanded={more} onClick={() => setMore(!more)}>More filters{[actor, act, proj, origin].filter(Boolean).length ? ` (${[actor, act, proj, origin].filter(Boolean).length})` : ''}</Button>
        {more && <>
          <Select aria-label="Actor" className="w-40" value={actor} onChange={(e) => set({ actor: e.target.value })}><option value="">All actors</option>{read.options.actors.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select aria-label="Action" className="w-48" value={act} onChange={(e) => set({ act: e.target.value })}><option value="">All actions</option>{read.options.actions.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select aria-label="Project" className="w-40" value={proj} onChange={(e) => set({ proj: e.target.value })}><option value="">All projects</option>{accessible.map((p) => <option key={p.id}>{p.id}</option>)}</Select>
          <Select aria-label="Origin" className="w-40" value={origin} onChange={(e) => set({ origin: e.target.value })}><option value="">Human and AI</option><option value="human">Human events</option><option value="ai">AI-originated</option></Select>
        </>}
        {(q || actor || act || proj || res || origin || F.corr || F.kind) && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
      </FilterBar>
      {F.kind && <Banner tone="info" title="Emergency stop events">An emergency stop is logged as Requested, then Acknowledged (agents confirmed halt) or Failed / Unknown (no confirmation). Requested alone does not mean anything has stopped.</Banner>}
      <Table rows={pg.rows} rowKey={(x) => x.id} onRow={(x) => setSel(x.id)} empty={<Empty icon={Clock} title={F.kind ? 'No emergency stop events yet' : 'No matching records'} action={<Button onClick={clear}>Clear filters</Button>}>{F.kind ? 'Events appear here when an Emergency Stop is requested, acknowledged or fails. Trigger one from a running operation.' : 'Try fewer filters or a different correlation ID.'}</Empty>} cols={[
        { key: 'id', header: 'Event ID', render: (x) => <Mono className="whitespace-nowrap">{x.id}</Mono> },
        { key: 'at', header: 'Time', render: (x) => <span className="whitespace-nowrap font-mono text-[13px] text-muted">{x.at}</span> },
        { key: 'ac', header: 'Actor', render: (x) => <div><div className="flex items-center gap-1.5">{x.actor}<span className="rounded border border-line px-1 text-[10px] text-muted">{actorType(x)}</span></div><div className="text-xs text-muted">{x.role}</div></div> },
        { key: 'p', header: 'Project', hideBelow: 'md', render: (x) => <Mono className="whitespace-nowrap text-muted">{x.projectId || 'Workspace'}</Mono> },
        { key: 'a', header: 'Action', render: (x) => x.action },
        { key: 'o', header: 'Object', render: (x) => <Mono className="whitespace-nowrap">{x.obj || '—'}</Mono> },
        { key: 'r', header: 'Result', render: (x) => <Status kind="generic" value={tone(x.result)} label={x.result} /> },
        { key: 'ap', header: 'Approval', hideBelow: 'lg', render: (x) => <span className="text-muted">{approval(x)}</span> },
        { key: 'c', header: 'Correlation ID', hideBelow: 'lg', render: (x) => <Mono className="whitespace-nowrap text-muted">{corr(x)}</Mono> },
      ]} />
      <Pager {...pg} />
      <Drawer open={!!a} onClose={() => setSel(null)} title="View Event">
        {a && <div className="space-y-5">
          <DescList items={[{ k: 'Event ID', v: <Mono className="whitespace-nowrap">{a.id}</Mono> }, { k: 'Time (display)', v: <span className="whitespace-nowrap">{a.at.includes('UTC') ? a.at : `${a.at} (UTC+7)`}</span> }, { k: 'Time (UTC)', v: <span className="whitespace-nowrap">{utcOf(a.at)}</span> }, { k: 'Display timezone', v: 'Asia/Ho_Chi_Minh (UTC+7)' }, { k: 'Actor type', v: actorType(a) }, { k: 'Actor', v: `${a.actor} (${a.role})` }, { k: 'Action', v: a.action }, { k: 'Object', v: <Mono className="whitespace-nowrap">{a.obj}</Mono> }, { k: 'Project', v: a.projectId || 'Workspace' }, { k: 'Result', v: a.result }, { k: 'Approval', v: approval(a) }, { k: 'Correlation ID', v: <Mono className="whitespace-nowrap">{corr(a)}</Mono> }, { k: 'Source', v: 'Raptix Web (simulated)' }, { k: 'Reason', v: a.reason || '—' }]} />
          {isAi(a) && <Banner tone="info" title="AI-originated event">This event came from the AI Operator (a proposal or blocked tool call). It is not a human approval and not an executed operation event.</Banner>}
          {/(policy|scope|Approved|Revoked|Stop|Changed|Updated|Exported|Disabled|Closed|hold|retention)/i.test(a.action) && (
            <div><div className="mb-2 text-xs font-medium text-muted">Before / after</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div className="rounded-lg border border-line bg-bg p-3 text-xs"><div className="mb-1 text-muted">Before</div><Mono className="whitespace-nowrap">{a.action.includes('Disabled') ? 'enabled: true' : 'state: before action'}</Mono></div><div className="rounded-lg border border-line bg-bg p-3 text-xs"><div className="mb-1 text-muted">After</div><Mono className="whitespace-nowrap">{a.action.includes('Disabled') ? 'enabled: false' : 'state: after action'}</Mono></div></div>
              <p className="mt-1 text-[11px] text-neutral">Simulated values; the backend stores the full diff.</p></div>
          )}
        </div>}
      </Drawer>
    </>
  )
}

/* ───────── Notifications & appearance ───────── */
const NTYPES = ['Approvals', 'Operation failed', 'Agent disconnected', 'Finding needs review', 'Report approved']
const NDEF = { m: Object.fromEntries(NTYPES.map((t, i) => [t, [true, i % 2 === 0, i === 1 || i === 2]])) as Record<string, boolean[]>, quiet: true, from: '22:00', to: '07:00', theme: 'light' as 'dark' | 'light' | 'system', density: 'comfortable' as 'comfortable' | 'compact' }
function NotifTab() {
  const { theme, setTheme, toast, persistFilters, setFilter } = useStore()
  const saved = { ...NDEF, theme, ...(persistFilters.prefs || {}) } as typeof NDEF
  const [p, setP] = useState(saved)
  const dirty = JSON.stringify(p) !== JSON.stringify(saved)
  const apply = (t: 'dark' | 'light' | 'system') => setTheme(t === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t)
  const save = () => { setFilter('prefs', p); apply(p.theme); document.documentElement.dataset.density = p.density; toast('Preferences saved') }
  useDirty(dirty, save)
  const ch = ['In app', 'Email', 'Webhook']
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Notification preferences" sub="Personal preferences. They do not change organization policy." />
          <div className="no-scrollbar overflow-x-auto"><table className="w-full min-w-[460px] text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="h-10 font-medium">Notification type</th>{ch.map((c) => <th key={c} className="px-2 text-center font-medium">{c}</th>)}</tr></thead>
            <tbody>{NTYPES.map((t) => <tr key={t} className="h-12 border-t border-line/60"><td>{t}</td>{ch.map((c, i) => <td key={c} className="text-center"><Toggle on={p.m[t][i]} label={`${t} — ${c}`} onChange={(v) => setP({ ...p, m: { ...p.m, [t]: p.m[t].map((x, j) => (j === i ? v : x)) } })} /></td>)}</tr>)}</tbody>
          </table></div>
          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-4">
            <div className="flex items-center gap-2"><Toggle on={p.quiet} label="Quiet hours" onChange={(v) => setP({ ...p, quiet: v })} /><span className="text-sm">Quiet hours</span></div>
            <Field label="From" className="w-28"><Input type="time" value={p.from} disabled={!p.quiet} onChange={(e) => setP({ ...p, from: e.target.value })} /></Field>
            <Field label="To" className="w-28"><Input type="time" value={p.to} disabled={!p.quiet} onChange={(e) => setP({ ...p, to: e.target.value })} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Appearance" sub="Light Red/White is the default. The dark theme is optional; consoles stay dark independently." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Theme"><Segmented value={p.theme} onChange={(v) => setP({ ...p, theme: v })} options={[{ id: 'light', label: 'Light (default)' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'System' }]} /></Field>
            <Field label="Table density"><Segmented value={p.density} onChange={(v) => setP({ ...p, density: v })} options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]} /></Field>
          </div>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Save} onClick={save} disabled={!dirty} title={dirty ? undefined : 'No changes to save'}>Save preferences</Button>
          <Button onClick={() => { setP({ ...NDEF }); toast('Defaults restored. Select Save preferences to apply.', 'info') }}>Restore defaults</Button>
        </div>
      </div>
      <Card>
        <CardHeader title="Notification preview" />
        <div className="space-y-2">
          {[{ t: 'FD-011 needs review', s: 'RT-2026-014 · Oct 13, 2026, 10:20 AM (UTC+7)' }, { t: 'AG-009 disconnected since Oct 12, 6:05 PM', s: 'RT-2026-014 · Oct 12, 2026, 6:20 PM (UTC+7)' }].map((n) => (
            <div key={n.t} className="flex items-start gap-3 rounded-lg border border-line bg-bg p-3"><Bell size={16} className="mt-0.5 text-accent" aria-hidden /><div><div className="text-sm">{n.t}</div><div className="text-xs text-muted">{n.s}</div></div></div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{p.quiet ? `Non-urgent notifications are held between ${p.from} and ${p.to}. Emergency stop and approval-expiry alerts always come through.` : 'Quiet hours are off.'}</p>
      </Card>
    </div>
  )
}

/* ───────── Security / my account ───────── */
function SecurityTab() {
  const { me, setMe, logout, toast, db } = useStore()
  const live = db.operations.filter((o) => ['running', 'paused'].includes(o.status)).length
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title="My account" />
        <div className="mb-4 flex items-center gap-3"><Avatar name={me.name} size={48} /><div><div className="text-base font-semibold">{me.name}</div><div className="text-sm text-muted">{ROLE_LABEL[me.role]}</div></div></div>
        <DescList items={[{ k: 'Name', v: me.name }, { k: 'Email', v: me.email }, { k: 'Role', v: ROLE_LABEL[me.role] }, { k: 'Organization', v: 'Acme Security (Demo)' }, { k: 'Session', v: 'Signed in, expires after 8 hours idle' }, { k: 'Multi-factor', v: 'Enabled (simulated)' }]} />
        <div className="mt-5 flex gap-2"><Button icon={KeyRound} onClick={() => toast('Simulated: a password reset link was sent to your email.', 'info')}>Change password</Button><Button variant="danger" icon={LogOut} onClick={logout}>Sign out</Button></div>
      </Card>
      <Card>
        <CardHeader title="Switch role (demo)" sub="Use this to test permissions across approval, review and delivery flows." />
        <ul className="space-y-2">
          {USERS.map((u) => (
            <li key={u.name} className={cx('flex items-center gap-3 rounded-lg border p-3', u.name === me.name ? 'border-accent/50 bg-accent-soft' : 'border-line')}>
              <Avatar name={u.name} /><div className="min-w-0 flex-1"><div className="text-sm font-medium">{u.name}</div><div className="truncate text-xs text-muted">{ROLE_LABEL[u.role]} · {u.email}</div></div>
              {u.name === me.name ? <span className="text-xs text-accent">Current</span> : <Button size="sm" onClick={() => { setMe(u.name); toast(`Switched to ${u.name}`, 'info') }}>Switch</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Emergency controls" sub="Status of the stop mechanism in your scope." />
        <DescList cols={3} items={[{ k: 'Live operations in scope', v: live }, { k: 'Stop mechanism', v: <span className="inline-flex items-center gap-1.5 text-ok"><CheckCircle2 size={13} aria-hidden />Ready</span> }, { k: 'Last drill', v: 'Sep 28, 2026, 2:00 PM (UTC+7)' }, { k: 'Emergency contact', v: 'SOC duty line (demo)' }, { k: 'Your role', v: ['admin', 'manager', 'operator'].includes(me.role) ? 'Authorized to stop' : 'View only' }]} />
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />Emergency Stop is available on each running operation and in the top bar. It needs a reason, is audited, and never restarts automatically.</p>
      </Card>
      {void XCircle}
    </div>
  )
}
