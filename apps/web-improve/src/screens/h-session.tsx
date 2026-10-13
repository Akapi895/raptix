import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Ban, Bot, Clock, Copy, Eye, FileText, Loader2, Lock, OctagonX, Radio, ShieldCheck, TerminalSquare, Unplug } from 'lucide-react'
import { useStore, sessionPerm, hhmm } from '../store'
import type { Db, Session } from '../data'
import type { Persona } from '../store'
import { Banner, Button, Card, CardHeader, DemoTag, DescList, Drawer, Empty, Field, Gated, IdLink, Locked, Mono, PageHeader, Person, Segmented, Select, Status, Table, Tabs, Textarea, ConsolePane, cx } from '../ui'

export const SELECT_PROJECT = 'Select a project to continue'
export const MIN_REASON = 20
export const kindLabel = (k: Session['kind']) => (k === 'reverse' ? 'Reverse Shell' : 'Web Shell')

/** Minutes until a "Oct 13, 2026, 12:00 PM (UTC+7)" style timestamp, relative to the simulated clock. */
export function minutesUntil(exp: string, nowHHMM: string) {
  const m = /(\d+):(\d+) (AM|PM)/.exec(exp)
  if (!m) return 0
  const h = (parseInt(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)
  const [nh, nm] = nowHHMM.split(':').map(Number)
  return h * 60 + parseInt(m[2]) - (nh * 60 + nm)
}

export function useSession(id?: string) {
  const { db, me, pid } = useStore()
  const s = db.sessions.find((x) => x.id === id)
  const perm = s ? sessionPerm(db, me, s) : 'none'
  return { s, perm, allProjects: pid === 'all' }
}

/* ───────── Request access drawer (C2-08) ───────── */
export function RequestAccessDrawer({ session, open, onClose, initialMode = 'interactive' }: { session: Session; open: boolean; onClose: () => void; initialMode?: 'read-only' | 'interactive' }) {
  const { A, db, toast, go } = useStore()
  const [mode, setMode] = useState<'read-only' | 'interactive'>(initialMode)
  const [duration, setDuration] = useState('1 hour')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => { if (open) { setMode(initialMode); setReason(''); setTouched(false) } }, [open, initialMode])
  const op = db.operations.find((o) => o.id === session.opId)
  const project = db.projects.find((p) => p.id === session.projectId)
  const approvers = db.projects.find((p) => p.id === session.projectId)?.members.filter((m) => m.role === 'manager' || m.role === 'admin').map((m) => m.user) || []
  const ok = reason.trim().length >= MIN_REASON
  const submit = () => {
    setTouched(true)
    if (!ok) return
    const id = A.requestSessionAccess(session.id, mode, duration, reason.trim())
    toast(`Request ${id} submitted — the approver has been notified.`)
    onClose()
    go('c2-session', { id: session.id })
  }
  return (
    <Drawer open={open} onClose={onClose} title="Request session access" width={480}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={touched && !ok}>Submit request</Button></>}>
      <div className="space-y-4">
        <Banner tone="info" title="Access is time-limited and approval-based">An approver grants a specific scope for a limited time. Every action in the session is recorded.</Banner>
        <Field label="Requested access" required>
          <Segmented options={[{ id: 'read-only', label: 'Read-only' }, { id: 'interactive', label: 'Interactive' }]} value={mode} onChange={setMode} />
        </Field>
        <Field label="Duration" required><Select value={duration} onChange={(e) => setDuration(e.target.value)}><option>30 minutes</option><option>1 hour</option><option>2 hours</option></Select></Field>
        <Field label="Purpose / justification" required hint={`${reason.trim().length}/${MIN_REASON} characters minimum`} error={touched && !ok ? `Enter at least ${MIN_REASON} characters explaining why access is needed.` : undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need this access, and for which step?" />
        </Field>
        <DescList cols={1} items={[
          { k: 'Session', v: <Mono>{session.id} · {kindLabel(session.kind)}</Mono> },
          { k: 'Project', v: project ? `${project.id} · ${project.name}` : session.projectId },
          { k: 'Target', v: <Mono>{session.asset}</Mono> },
          { k: 'Linked operation', v: <Mono>{session.opId}{op ? ` · ${op.name}` : ''}</Mono> },
          { k: 'Approver', v: approvers.length ? approvers.join(', ') : 'Red Team Manager' },
          { k: 'Applicable ROE', v: project?.roeVersion || '—' },
          { k: 'Permission scope', v: mode === 'interactive' ? 'This session only · simulated console input' : 'This session only · read-only view' },
          { k: 'Policy summary', v: 'Interactive access is limited to in-scope targets, within the ROE window, and expires automatically.' },
        ]} />
      </div>
    </Drawer>
  )
}

/* ───────── Access state (connection and access are separate) ───────── */
export type AccessKey = 'none' | 'read-only' | 'interactive' | 'pending' | 'expired' | 'rejected' | 'changes'
export interface AccessInfo { key: AccessKey; label: string; tone: 'ok' | 'warn' | 'bad' | 'cyan' | 'neutral'; detail?: string }
export function accessOf(db: Db, me: Persona, s: Session): AccessInfo {
  if (sessionPerm(db, me, s) === 'none') return { key: 'none', label: 'None', tone: 'neutral', detail: 'No access to this project' }
  if (['terminated', 'revoking'].includes(s.state)) return { key: 'none', label: 'None', tone: 'neutral', detail: 'Session ended' }
  const g = s.grants.find((x) => x.user === me.name)
  if (g) { const until = g.expires.replace('Oct 13, 2026, ', ''); return g.perm === 'interactive' ? { key: 'interactive', label: `Interactive until ${until}`, tone: 'warn' } : { key: 'read-only', label: `Read-only until ${until}`, tone: 'cyan' } }
  const last = db.sessionRequests.find((r) => r.sessionId === s.id && r.by === me.name)
  if (last?.status === 'pending') return { key: 'pending', label: 'Pending request', tone: 'warn', detail: last.id }
  if (last?.status === 'expired') return { key: 'expired', label: 'Expired — read-only', tone: 'neutral', detail: last.id }
  if (last?.status === 'rejected') return { key: 'rejected', label: 'Request rejected — read-only', tone: 'bad', detail: last.id }
  if (last?.status === 'changes') return { key: 'changes', label: 'Changes requested — read-only', tone: 'warn', detail: last.id }
  return { key: 'read-only', label: 'Read-only', tone: 'cyan' }
}
const TONE_CLS = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', cyan: 'text-cyan', neutral: 'text-muted' }
export function AccessChip({ a }: { a: AccessInfo }) {
  return <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel px-2 py-0.5 text-xs font-medium', TONE_CLS[a.tone])}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{a.label}{a.detail && a.key !== 'none' && <span className="font-mono text-muted">· {a.detail}</span>}</span>
}

/** Expires any grant whose time has passed (checked on mount and every 15 s while a C2 screen is open). */
export function useGrantWatch() {
  const { db, A, toast, me } = useStore()
  const [t, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(i) }, [])
  useEffect(() => {
    db.sessions.forEach((s) => s.grants.forEach((g) => {
      if (minutesUntil(g.expires, hhmm()) <= 0) { A.expireGrant(s.id, g.user); if (g.user === me.name) toast(`Your ${g.perm} grant on ${s.id} expired. Input is locked.`, 'warn') }
    }))
  }, [t, db.sessions]) // eslint-disable-line
}

/* ───────── Revocation (with simulated failure) ───────── */
interface RF { sessionId: string; user: string; reason: string }
let sim = { fails: [] as RF[], failNext: false }
const subs = new Set<() => void>()
const setSim = (p: Partial<typeof sim>) => { sim = { ...sim, ...p }; subs.forEach((f) => f()) }
export function useRevokeSim() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => sim)
}
export const setFailNext = (v: boolean) => setSim({ failNext: v })

export function useTerminate() {
  const { A, db, confirm, toast } = useStore()
  return (s: Session) => {
    const op = db.operations.find((o) => o.id === s.opId)
    confirm({
      title: `Terminate ${s.id}?`, confirmLabel: 'Terminate session', danger: true, reasonRequired: true, reasonLabel: 'Reason for termination',
      body: (
        <div className="space-y-2 text-sm">
          <p>Terminate ends the whole session for everyone. This is different from revoking one person's access.</p>
          <ul className="list-disc pl-5 text-muted">
            <li>Interactive input is disabled immediately and all grants on this session are revoked.</li>
            <li>Linked operation: <Mono>{s.opId}</Mono>{op ? ` (${op.name})` : ''} may lose live visibility.</li>
            <li>Agent <Mono>{s.agentId}</Mono> stays registered; only this session ends.</li>
            <li>The recorded transcript is retained for the project retention period.</li>
          </ul>
        </div>
      ),
      onConfirm: (reason) => { A.terminateSession(s.id, reason); toast(`Termination of ${s.id} requested — waiting for acknowledgement.`, 'warn') },
    })
  }
}

export function useRevoke() {
  const { A, confirm, toast, me } = useStore()
  const perform = (s: Session, user: string, reason: string) => {
    if (sim.failNext) {
      setSim({ failNext: false, fails: [...sim.fails.filter((f) => !(f.sessionId === s.id && f.user === user)), { sessionId: s.id, user, reason }] })
      A.audit('Revocation failed', s.id, s.projectId, 'Failed', 'Revoke not acknowledged — grant may still be active')
      toast(`Revocation failed — ${user} may still have access to ${s.id}.`, 'bad')
      return
    }
    A.revokeGrant(s.id, user, reason)
    setSim({ fails: sim.fails.filter((f) => !(f.sessionId === s.id && f.user === user)) })
    toast(`Access revoked for ${user}.`, 'warn')
  }
  const revoke = (s: Session, user: string) => confirm({
    title: user === me.name ? 'Revoke my access?' : `Revoke access for ${user}?`, confirmLabel: 'Revoke access', danger: true, reasonRequired: true, reasonLabel: 'Reason for revocation',
    body: <p className="text-sm">{user === me.name ? 'You lose' : `${user} immediately loses`} control of {s.id}. The session itself stays connected (use Terminate session to end it).</p>,
    onConfirm: (reason) => perform(s, user, reason),
  })
  const retry = (s: Session, user: string) => perform(s, user, 'Retry after failed revocation')
  return Object.assign(revoke, { retry })
}

/* ───────── Session detail (C2-V3-04) ───────── */
const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>

export function SessionDetail() {
  const { db, route, go, me, can, scoped } = useStore()
  useGrantWatch()
  const { s, perm, allProjects } = useSession(route.id)
  const [drawer, setDrawer] = useState(false)
  const terminate = useTerminate()
  const revoke = useRevoke()
  const rs = useRevokeSim()
  const back = { label: 'C2 & Sessions', to: () => go('c2', { tab: 'sessions' }) }
  if (!s || !scoped([s]).length) return <><PageHeader title="Session not found" back={back} /><Empty icon={Radio} title={`No session "${route.id}" in this project`} action={<Button onClick={() => go('c2', { tab: 'sessions' })}>Back to sessions</Button>}>It may have been removed, or it belongs to another project. Switch project to view it.</Empty></>
  if (perm === 'none' && me.role !== 'viewer') return <><PageHeader title={s.id} back={back} /><Empty icon={Lock} title="You do not have access to this session" action={<Button onClick={() => go('c2', { tab: 'sessions' })}>Back to sessions</Button>}>Sessions are limited to projects you are a member of.</Empty></>
  const viewer = me.role === 'viewer'
  const acc = accessOf(db, me, s)
  const asset = db.assets.find((a) => a.name === s.asset && a.projectId === s.projectId)
  const agent = db.agents.find((a) => a.id === s.agentId)
  const channel = db.channels.find((c) => c.id === s.channelId)
  const project = db.projects.find((p) => p.id === s.projectId)
  const op = db.operations.find((o) => o.id === s.opId)
  const reqs = db.sessionRequests.filter((r) => r.sessionId === s.id)
  const approved = reqs.find((r) => r.status === 'approved')
  const myGrant = s.grants.find((g) => g.user === me.name)
  const live = s.state === 'connected'
  const dead = ['expired', 'terminated', 'revoking'].includes(s.state)
  const myPending = reqs.find((r) => r.by === me.name && r.status === 'pending')
  const blocked = allProjects ? SELECT_PROJECT : viewer ? 'The Client / Viewer role cannot open sessions.' : ''
  const canInteractive = perm === 'interactive' && live && !blocked
  const findings = db.findings.filter((f) => f.asset === s.asset && f.projectId === s.projectId)
  const audit = db.audit.filter((a) => a.obj === s.id && a.projectId === s.projectId).slice(0, 5)
  const evidence = db.evidence.filter((e) => e.projectId === s.projectId && e.opId === s.opId)
  const reqWhy = blocked || (!can('interactive') ? 'Your role cannot request interactive access.' : myPending ? `Request ${myPending.id} is already pending approval.` : dead ? `Session is ${s.state}.` : perm === 'interactive' ? 'You already have interactive access.' : '')
  const intReason = blocked || (dead ? `Session is ${s.state}. Request access again once a new session exists.` : s.state === 'disconnected' ? 'Session is disconnected. Interactive input is unavailable until it reconnects.' : perm !== 'interactive' ? (myPending ? `Access request ${myPending.id} is awaiting approval.` : 'You have read-only access. Request interactive access to continue.') : 'Session is not connected.')
  const failFor = (u: string) => rs.fails.find((f) => f.sessionId === s.id && f.user === u)
  return (
    <>
      <PageHeader back={back} title={<span className="flex items-center gap-3"><Mono>{s.id}</Mono><span className="text-base font-medium text-muted">{kindLabel(s.kind)}</span></span>}
        sub={`${s.projectId} · ${s.opId} · ${s.asset} · ${s.agentId}`}
        meta={<span className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="inline-flex items-center gap-1.5 text-xs text-muted">Connection<Status kind="session" value={s.state} /></span><span className="inline-flex items-center gap-1.5 text-xs text-muted">Your access<AccessChip a={acc} /></span><span className="inline-flex items-center gap-1 text-xs text-muted"><Radio size={12} aria-hidden />Recording</span></span>}
        actions={<>
          <Gated allowed={!blocked && perm !== 'none'} reason={blocked || 'No access.'}><Button icon={Eye} onClick={() => go('c2-console', { id: s.id })}>Open read-only view</Button></Gated>
          <Gated allowed={canInteractive} reason={intReason}><Button variant="primary" icon={TerminalSquare} onClick={() => go('c2-console', { id: s.id })}>Open interactive console</Button></Gated>
        </>} />
      <div className="space-y-4">
        {viewer && <Banner tone="info" icon={Eye} title="Metadata only">The Client / Viewer role sees session metadata. Transcripts and consoles are not available.</Banner>}
        {s.state === 'revoking' && <Banner tone="warn" title="Termination requested — waiting for acknowledgement">Interactive input is disabled. Grants are being revoked.</Banner>}
        {s.state === 'terminated' && <Banner tone="bad" icon={Ban} title="Session terminated">Terminal is disabled. Transcript is retained. Start a new operation step to create a new session.</Banner>}
        {s.state === 'expired' && <Banner tone="warn" title="Session expired">Terminal is disabled.</Banner>}
        {s.state === 'disconnected' && <Banner tone="warn" icon={Unplug} title="Connection interrupted">Disconnected is a connection state and is not the same as access denied. Your grant is unchanged. Last observed {s.last}.</Banner>}
        {s.grants.filter((g) => failFor(g.user)).map((g) => <Banner key={g.user} tone="bad" icon={OctagonX} title={`Revocation failed for ${g.user}`} action={can('approveAccess') || g.user === me.name ? <Button size="sm" variant="danger" onClick={() => revoke.retry(s, g.user)}>Retry revoke</Button> : undefined}>The revoke was not acknowledged, so the grant must be treated as still active. Retry, or terminate the session.</Banner>)}
        {!viewer && ['read-only', 'pending', 'expired', 'rejected', 'changes'].includes(acc.key) && live && <Banner tone={acc.key === 'pending' ? 'warn' : 'info'} icon={acc.key === 'pending' ? Clock : Eye} title={acc.key === 'pending' ? 'Access pending' : acc.key === 'expired' ? 'Your grant expired' : 'Read-only access'} action={!reqWhy ? <Button size="sm" variant="primary" onClick={() => setDrawer(true)}>{acc.key === 'expired' ? 'Request renewal' : 'Request access'}</Button> : undefined}>
          The session is connected, but you do not hold interactive access.{myPending ? ` Your request ${myPending.id} is pending approval.` : acc.key === 'expired' ? ' Request a new grant to continue.' : reqWhy ? ` ${reqWhy}` : ''}</Banner>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader title="Session identity" /><DescList items={[
            { k: 'Session', v: <Mono>{s.id}</Mono> }, { k: 'Type', v: kindLabel(s.kind) }, { k: 'Project', v: <Mono>{s.projectId}</Mono> },
            { k: 'Operation', v: <IdLink onClick={() => go('operation', { id: s.opId, tab: 'overview' })}>{s.opId}</IdLink> }, { k: 'Target', v: <Mono>{s.asset}</Mono> },
            { k: 'Agent', v: <span className="inline-flex items-center gap-2"><IdLink onClick={() => go('agent', { id: s.agentId })}>{s.agentId}</IdLink>{agent && <span className="text-muted">{agent.host}</span>}</span> },
            { k: 'Created', v: s.started }, { k: 'Owner', v: <Person name={op?.owner || '—'} /> }, { k: 'Account (masked)', v: <Mono>{s.account}</Mono> }, { k: 'Integrity', v: s.integrity },
          ]} /></Card>
          <Card><CardHeader title="Connection health" sub="Independent of any access grant" /><DescList items={[
            { k: 'Connection', v: <Status kind="session" value={s.state} size="sm" /> },
            { k: 'Channel', v: channel ? <span className="inline-flex items-center gap-2"><IdLink onClick={() => go('c2-channel', { id: channel.id })}>{channel.id}</IdLink><Status kind="channel" value={channel.status} size="sm" /></span> : '—' },
            { k: 'Last observed', v: s.last }, { k: 'Last heartbeat', v: channel?.last || s.last }, { k: 'Latency', v: db.c2Nodes.find((n) => n.id === channel?.nodeId)?.latency || '—' },
            { k: 'Disconnect reason', v: s.state === 'disconnected' ? `Heartbeat lost — agent ${s.agentId} (simulated)` : s.state === 'terminated' ? 'Terminated by operator' : '—' },
          ]} />
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><DemoTag />All values are simulated.</p></Card>
        </div>
        <Card><CardHeader title="Access grants" sub={`ROE ${project?.roeVersion || '—'} · approved target ${s.asset}`} actions={!reqWhy && !viewer ? <Button size="sm" onClick={() => setDrawer(true)}>{acc.key === 'expired' ? 'Request renewal' : 'Request access'}</Button> : undefined} />
          {s.grants.length === 0 ? <p className="mb-4 text-sm text-muted">No active grants. Everyone sees this session read-only.</p> : (
            <Table rows={s.grants} rowKey={(g) => g.user} dense cols={[
              { key: 'u', header: 'User', render: (g) => <Person name={g.user} /> }, { key: 'p', header: 'Scope', render: (g) => <Status kind="perm" value={g.perm} size="sm" /> },
              { key: 'e', header: 'Expires', render: (g) => <span className="whitespace-nowrap">{g.expires}</span> }, { key: 'b', header: 'Granted by', render: (g) => g.by },
              { key: 'f', header: 'Revocation', render: (g) => failFor(g.user) ? <span className="text-xs font-medium text-bad">Failed — grant still active</span> : <span className="text-xs text-muted">Active</span> },
              { key: 'a', header: '', render: (g) => g.user === me.name
                ? <Button size="sm" variant="danger" onClick={() => revoke(s, g.user)} disabled={!!blocked}>Revoke my access</Button>
                : <Gated allowed={can('approveAccess') && !blocked} reason={blocked || 'Only an approver (Red Team Manager, Reviewer or Organization Admin) can revoke another user\'s access.'}><Button size="sm" variant="danger" onClick={() => revoke(s, g.user)}>Revoke access</Button></Gated> },
            ]} />
          )}
          <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Request history</h4>
          {reqs.length === 0 ? <p className="text-sm text-muted">No access requests for this session.</p> : (
            <Table rows={reqs} rowKey={(r) => r.id} dense cols={[
              { key: 'id', header: 'Request', render: (r) => <Mono>{r.id}</Mono> }, { key: 'by', header: 'Requested by', render: (r) => r.by }, { key: 'm', header: 'Mode', render: (r) => <Status kind="perm" value={r.mode} size="sm" /> },
              { key: 's', header: 'Status', render: (r) => <Status kind="access" value={r.status} size="sm" /> }, { key: 'at', header: 'Submitted', render: (r) => <span className="whitespace-nowrap">{r.at}</span> }, { key: 'n', header: 'Decision note', render: (r) => r.note || '—' },
            ]} />
          )}
          {myGrant && <p className="mt-3 text-xs text-muted">Approval ID <Mono>{approved ? approved.id : '—'}</Mono>. A grant covers this session only and never raises your project-wide permissions.</p>}
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader title="Approved scope" />
            <DescList cols={1} items={[
              { k: 'Target', v: asset ? <span className="inline-flex items-center gap-2"><IdLink onClick={() => go('asset', { id: asset.id })}>{asset.id} · {asset.name}</IdLink><Status kind="scope" value={asset.scope} size="sm" /></span> : s.asset },
              { k: 'ROE', v: project?.roeVersion || '—' }, { k: 'Time window', v: project?.window || '—' },
              { k: 'Permitted input', v: 'Simulated safe actions only — no real commands are executed' }, { k: 'Grant limits', v: 'Time-limited, this session only, auto-expires' },
            ]} /></Card>
          <Card><CardHeader title="Recent events" sub="Sanitized transcript" actions={<DemoTag />} />
            {viewer ? <Locked reason="Transcripts are not visible to the Client / Viewer role." /> : (
              <ConsolePane className="p-3">{s.transcript.slice(-5).map((l, i) => <TLine key={i} l={l} />)}</ConsolePane>
            )}
            {!viewer && <div className="mt-3"><Button size="sm" icon={FileText} onClick={() => go('c2-console', { id: s.id })} disabled={!!blocked}>{blocked ? SELECT_PROJECT : 'Open full recorded history'}</Button></div>}
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader title="Audit" sub={<span>Correlation <Mono>COR-014-01</Mono></span>} actions={<Button size="sm" onClick={() => go('c2', { tab: 'audit' })}>Open audit & policy</Button>} />
            {audit.length === 0 ? <p className="text-sm text-muted">No audit events recorded for this session yet.</p> : (
              <Table rows={audit} rowKey={(a) => a.id} dense cols={[{ key: 'at', header: 'Time', render: (a) => <span className="whitespace-nowrap">{a.at.replace('Oct 13, 2026, ', '')}</span> }, { key: 'ac', header: 'Event', render: (a) => `${a.action} — ${a.actor}` }, { key: 'r', header: 'Result', render: (a) => a.result }]} />)}
            <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Related objects</h4>
            <DescList cols={1} items={[
              { k: 'Evidence', v: evidence.length ? <Row>{evidence.map((e) => <IdLink key={e.id} onClick={() => go('evidence', { id: e.id })}>{e.id}</IdLink>)}</Row> : 'None linked' },
              { k: 'Findings', v: findings.length ? <Row>{findings.map((f) => <IdLink key={f.id} onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink>)}</Row> : 'None linked' },
            ]} />
          </Card>
          <Card><CardHeader title="Termination controls" />
            <div className="space-y-3 text-sm">
              <div><p className="mb-1.5 text-muted"><b className="text-fg">Revoke access</b> removes one person's grant. The session keeps running.</p>
                <Row>{myGrant ? <Button variant="danger" onClick={() => revoke(s, me.name)} disabled={!!blocked}>Revoke my access</Button> : <Gated allowed={false} reason="You do not hold a grant on this session."><Button variant="danger">Revoke my access</Button></Gated>}</Row></div>
              <div><p className="mb-1.5 text-muted"><b className="text-fg">Terminate session</b> ends the session for everyone and revokes all grants. It needs a reason and an acknowledgement.</p>
                <Gated allowed={can('terminate') && !blocked && !dead} reason={blocked || (!can('terminate') ? 'Only a Red Team Manager or Organization Admin can terminate sessions.' : `Session is already ${s.state}.`)}><Button variant="danger" icon={OctagonX} onClick={() => terminate(s)}>Terminate session</Button></Gated></div>
            </div></Card>
        </div>
      </div>
      <RequestAccessDrawer session={s} open={drawer} onClose={() => setDrawer(false)} />
    </>
  )
}

export function TLine({ l }: { l: Session['transcript'][number] }) {
  const who = l.who === 'user' ? 'OPERATOR' : l.who === 'target' ? 'RESPONSE' : 'SYSTEM'
  return <div className="flex gap-3 py-0.5"><span className="shrink-0 text-console-muted">{l.ts}</span><span className={cx('w-20 shrink-0 font-semibold', l.who === 'user' ? 'text-console-fg' : 'text-console-muted')}>{who}</span><span className="min-w-0 break-words">{l.text}</span></div>
}

/* ───────── Interactive console (C2-V3-05, one component for Reverse and Web) ───────── */
const ACTIONS: Record<Session['kind'], string[]> = {
  reverse: ['Show host summary', 'List running services (simulated)', 'Show network interfaces (simulated)', 'Show current account (simulated)'],
  web: ['Show application profile', 'List exposed routes (simulated)', 'Show response headers (simulated)', 'Check session health'],
}
const BUSY_MS = 2500

export function Console() {
  const { db, route, go, me, can, A, toast, confirm, scoped } = useStore()
  useGrantWatch()
  const { s, perm, allProjects } = useSession(route.id)
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState('transcript')
  const [refresh, setRefresh] = useState<'idle' | 'busy' | 'still'>('idle')
  const [, tick] = useState(0)
  const terminate = useTerminate()
  const revoke = useRevoke()
  const rs = useRevokeSim()
  const timer = useRef<number | undefined>(undefined)
  const stRef = useRef('')
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15000); return () => { clearInterval(t); clearTimeout(timer.current) } }, [])
  const grant = s?.grants.find((g) => g.user === me.name && g.perm === 'interactive')
  const left = grant ? minutesUntil(grant.expires, hhmm()) : 0
  const back = { label: 'C2 & Sessions', to: () => go('c2', { tab: 'sessions' }) }
  if (!s || !scoped([s]).length) return <><PageHeader title="Console unavailable" back={back} /><Empty icon={TerminalSquare} title="Session not found in this project" action={<Button onClick={() => go('c2', { tab: 'sessions' })}>Back to sessions</Button>}>This session does not exist or belongs to another project.</Empty></>
  if (perm === 'none') return <><PageHeader title={s.id} back={back} /><Empty icon={Lock} title="Console not available" action={<Button onClick={() => go('c2-session', { id: s.id })}>View session metadata</Button>}>Your role or project membership does not permit viewing this console.</Empty></>

  const asset = db.assets.find((a) => a.name === s.asset && a.projectId === s.projectId)
  const project = db.projects.find((p) => p.id === s.projectId)
  const hasExpiredLine = !grant && s.transcript.some((l) => l.text.includes(`grant for ${me.name} expired`))
  const hasRevokedLine = !grant && s.transcript.some((l) => l.text.includes(`Access for ${me.name} revoked`))
  const myReq = db.sessionRequests.find((r) => r.sessionId === s.id && r.by === me.name)
  const outOfScope = asset?.scope === 'out'
  const blocked = allProjects ? SELECT_PROJECT : ''
  const myFail = rs.fails.find((f) => f.sessionId === s.id && s.grants.some((g) => g.user === f.user))
  type St = 'interactive' | 'readonly' | 'pending' | 'expired' | 'revoked' | 'terminated' | 'disconnected' | 'denied' | 'revokefail'
  const st: St = s.state === 'terminated' || s.state === 'revoking' ? 'terminated' : s.state === 'expired' ? 'expired' : s.state === 'disconnected' ? 'disconnected' : outOfScope ? 'denied'
    : grant && myFail?.user === me.name ? 'revokefail' : grant ? 'interactive' : myReq?.status === 'pending' ? 'pending' : hasExpiredLine ? 'expired' : hasRevokedLine ? 'revoked' : 'readonly'
  stRef.current = st
  const reason: Record<St, string> = {
    interactive: '', readonly: 'Interactive access requires approval. You have a read-only preview.', pending: `Access request ${myReq?.id} is awaiting approval.`,
    expired: hasExpiredLine ? 'Access expired. Request a new grant.' : 'This session has expired.', revoked: 'Access was revoked. Request a new grant.',
    terminated: s.state === 'revoking' ? 'Termination requested — waiting for acknowledgement. Input is disabled.' : 'This session was terminated.',
    disconnected: 'Session is disconnected (this is not an access denial). Input is disabled until it reconnects.', denied: 'Target is out of scope. Policy denied interactive input.',
    revokefail: 'Revocation failed — the grant may still be active. Input is locked until the revoke is confirmed.',
  }
  const busyNow = !!busy && st === 'interactive'
  const canType = st === 'interactive' && !blocked && !busyNow
  const canRequest = !blocked && can('interactive') && !['terminated', 'disconnected', 'pending', 'interactive', 'revokefail'].includes(st)
  const renew = st === 'expired' || st === 'revoked'
  const evidence = db.evidence.filter((e) => e.projectId === s.projectId && e.opId === s.opId)
  const events = db.audit.filter((a) => a.obj === s.id && a.projectId === s.projectId)
  const run = (label: string) => {
    setBusy(label)
    timer.current = window.setTimeout(() => { setBusy(null); if (stRef.current === 'interactive') A.sessionCommand(s.id, label); else toast('Command interrupted — access changed while it was running.', 'warn') }, BUSY_MS)
  }
  const mine = db.sessions.filter((x) => x.projectId === s.projectId && sessionPerm(db, me, x) !== 'none')
  const statusLabel = busyNow ? 'Busy — command in progress' : { interactive: 'Interactive authorized', readonly: 'Read-only', pending: 'Pending access', expired: 'Expired', revoked: 'Revoked', terminated: s.state === 'revoking' ? 'Termination requested' : 'Terminated', disconnected: 'Disconnected', denied: 'Policy denied', revokefail: 'Revocation failed' }[st]
  const stop = db.stopState && db.stopState.id === s.opId ? db.stopState : null
  const doRefresh = () => { setRefresh('busy'); window.setTimeout(() => setRefresh('still'), 1200) }
  const overlay = (st === 'readonly' || st === 'pending' || renew) && !blocked
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-panel px-4 py-3">
        <button className="text-sm text-accent hover:underline" onClick={() => go('c2-session', { id: s.id })}>← Session detail</button>
        <span className="flex items-center gap-2 font-semibold"><TerminalSquare size={16} aria-hidden />Interactive Session</span>
        <Mono>{s.id}</Mono><span className="rounded-md border border-line bg-subtle px-2 py-0.5 text-xs font-medium">{kindLabel(s.kind)}</span>
        <span className="text-sm text-muted"><Mono>{s.projectId}</Mono> / <Mono>{s.opId}</Mono> / <Mono>{s.agentId}</Mono> / {s.asset}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">Connection<Status kind="session" value={s.state} size="sm" /></span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">Access<AccessChip a={accessOf(db, me, s)} /></span>
        <span className="text-xs text-muted">Access owner: {s.grants.find((g) => g.perm === 'interactive')?.user || 'None'}</span>
        <span className={cx('ml-auto inline-flex items-center gap-1.5 text-sm font-medium', st === 'interactive' && left <= 10 ? 'text-warn' : 'text-fg')} aria-live="polite">
          <Clock size={14} aria-hidden />{st === 'interactive' || st === 'revokefail' ? `Expires in ${Math.max(left, 0)} min (${grant?.expires.replace('Oct 13, 2026, ', '')})` : hasExpiredLine ? 'Grant expired' : 'No active grant'}
        </span>
        <Gated allowed={can('estop') && !blocked} reason={blocked || 'Only a Red Team Manager or Organization Admin can trigger an emergency stop.'}>
          <Button size="sm" variant="danger" icon={OctagonX} onClick={() => confirm({ title: `Emergency stop ${s.opId}?`, confirmLabel: 'Request emergency stop', danger: true, reasonRequired: true, reasonLabel: 'Reason', body: <p className="text-sm">A stop is requested for operation {s.opId}. It is not confirmed until the node and agents acknowledge it.</p>, onConfirm: (r) => { A.emergencyStop('operation', s.opId, r); toast('Emergency stop requested — waiting for acknowledgement.', 'warn') } })}>Emergency stop</Button>
        </Gated>
      </div>
      <div className="mb-3"><Banner tone="info" icon={ShieldCheck} title="Simulated Console — no real commands are executed">All output is synthetic and labelled Demo data. Only the safe actions below can be sent.</Banner></div>
      {stop && <div className="mb-3"><Banner tone={stop.phase === 'stopped' ? 'ok' : stop.phase === 'failed' ? 'bad' : 'warn'} icon={OctagonX} title={stop.phase === 'requested' ? 'Emergency stop requested — not yet acknowledged' : stop.phase === 'acknowledged' || stop.phase === 'stopping' ? 'Stop acknowledged — stopping' : stop.phase === 'stopped' ? 'Stopped (acknowledged)' : stop.phase === 'failed' ? 'Emergency stop failed — no acknowledgement' : 'Emergency stop status unknown'}>Input stays disabled while sessions for {s.opId} are being revoked. Reason: {stop.reason}</Banner></div>}
      {blocked && <div className="mb-3"><Banner tone="warn" icon={Lock} title={blocked}>Console actions are disabled in All Projects mode. Pick {s.projectId} in the project selector.</Banner></div>}
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <Card pad={false} className="p-3"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Sessions in {s.projectId}</h3>
          <ul className="space-y-1">{mine.map((x) => (
            <li key={x.id}><button onClick={() => go('c2-console', { id: x.id })} className={cx('flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', x.id === s.id && 'bg-accent-soft font-medium')} aria-current={x.id === s.id}>
              <span className="font-mono text-[13px]">{x.id} · {x.kind === 'reverse' ? 'Reverse' : 'Web'}</span><span className="text-xs text-muted">{x.asset} · {x.state}</span></button></li>
          ))}</ul>
        </Card>
        <div className="min-w-0 space-y-3">
          {st === 'readonly' && <Banner tone="info" icon={Eye} title="Read-only preview" action={canRequest ? <Button size="sm" variant="primary" onClick={() => setDrawer(true)}>Request time-limited access</Button> : undefined}>{reason.readonly} {!can('interactive') ? 'Your role cannot request interactive access.' : ''}</Banner>}
          {st === 'pending' && <Banner tone="warn" icon={Clock} title="Pending access">{reason.pending} The console stays read-only until it is approved.</Banner>}
          {st === 'revokefail' && <Banner tone="bad" icon={OctagonX} title="Revocation failed — input locked" action={<Button size="sm" variant="danger" onClick={() => revoke.retry(s, me.name)}>Retry revoke</Button>}>{reason.revokefail} Retry the revoke or ask an approver to terminate the session. The failure is recorded in the audit log.</Banner>}
          {busyNow && <Banner tone="warn" icon={Loader2} title="Busy — command in progress">Input is disabled until the simulated command completes (about {BUSY_MS / 1000} s): {busy}</Banner>}
          {st === 'disconnected' && <Banner tone="warn" icon={Unplug} title="Disconnected — input disabled" action={<span className="flex gap-2"><Button size="sm" onClick={doRefresh} disabled={refresh === 'busy'}>{refresh === 'busy' ? 'Refreshing…' : 'Retry health refresh'}</Button><Button size="sm" onClick={back.to}>Back to sessions</Button></span>}>{reason.disconnected} Last observed {s.last}.{refresh === 'still' ? ' Health refresh finished: the agent is still unreachable.' : ''}</Banner>}
          {(st === 'expired' || st === 'revoked' || st === 'terminated' || st === 'denied') && <Banner tone="bad" icon={Ban} title={`${statusLabel} — input disabled`} action={canRequest ? <Button size="sm" variant="primary" onClick={() => setDrawer(true)}>{renew ? 'Request renewal' : 'Request access again'}</Button> : undefined}>{reason[st]}</Banner>}
          {st === 'interactive' && !busyNow && <Banner tone="ok" icon={ShieldCheck} title="Interactive authorized">Only the approved safe actions below are available. Every action is recorded and attributed to {me.name}.</Banner>}
          <Tabs tabs={[{ id: 'transcript', label: 'Transcript' }, { id: 'events', label: 'Session Events', count: events.length }, { id: 'evidence', label: 'Evidence', count: evidence.length }, { id: 'policy', label: 'Policy' }]} value={tab} onChange={setTab} />
          {tab === 'transcript' && (
            <div className="relative">
              <ConsolePane className="h-80 p-3"><div role="log" aria-label="Recorded transcript">{s.transcript.map((l, i) => <TLine key={i} l={l} />)}{busyNow && <div className="text-console-muted">… command in progress (simulated)</div>}</div></ConsolePane>
              {overlay && <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-console-line bg-console/95 p-3 text-console-fg">
                <span className="flex items-center gap-2 text-sm font-medium"><Lock size={14} aria-hidden />{renew ? reason[st] : st === 'pending' ? reason.pending : 'Interactive access requires approval'}</span>
                {canRequest && <Button size="sm" variant="primary" onClick={() => setDrawer(true)}>{renew ? 'Request renewal' : 'Request time-limited access'}</Button>}</div>}
            </div>
          )}
          {tab === 'events' && <Card pad={false}><Table rows={events} rowKey={(a) => a.id} dense empty={<Empty icon={Radio} title="No audit events for this session yet">Events appear as access is requested, granted or revoked.</Empty>} cols={[
            { key: 'at', header: 'Timestamp', render: (a) => <span className="whitespace-nowrap">{a.at.replace('Oct 13, 2026, ', '')}</span> }, { key: 'a', header: 'Actor', render: (a) => a.actor }, { key: 'ac', header: 'Event', render: (a) => a.action },
            { key: 'c', header: 'Correlation ID', render: (a) => <Mono className="whitespace-nowrap">{a.corr || '—'}</Mono> }, { key: 'r', header: 'Audit status', render: (a) => a.result }]} /></Card>}
          {tab === 'evidence' && <Card>{evidence.length === 0 ? <Empty icon={FileText} title="No evidence linked to this session">Evidence captured from this operation will appear here.</Empty> : <ul className="space-y-2 text-sm">{evidence.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-3"><IdLink onClick={() => go('evidence', { id: e.id })}>{e.id}</IdLink><span>{e.name}</span><span className="text-muted">{e.kind} · {e.source}</span>{e.sensitive && <span className="text-xs text-muted">Redacted</span>}</li>)}</ul>}</Card>}
          {tab === 'policy' && <Card><DescList cols={1} items={[
            { k: 'Policy decision', v: st === 'denied' ? 'Blocked — target out of scope' : st === 'interactive' ? 'Allowed — approved grant, in scope' : 'Needs approval — interactive input not granted' },
            { k: 'Rules', v: 'Interactive input needs an approved, time-limited, per-session grant on an in-scope target.' }, { k: 'ROE', v: project?.roeVersion || '—' },
            { k: 'Simulation', v: 'This UI simulates policy checks. No real enforcement or command execution takes place.' }]} /></Card>}
          <div className="rounded-xl border border-line bg-panel p-3">
            {canType ? (
              <div><p className="mb-2 text-xs font-medium text-muted">Safe actions (simulated) — output is labelled Demo data</p>
                <div className="flex flex-wrap gap-2">{ACTIONS[s.kind].map((a) => <Button key={a} size="sm" onClick={() => run(a)}>{a}</Button>)}</div></div>
            ) : (
              <div><input disabled aria-label="Command input" placeholder={busyNow ? 'Command in progress…' : 'Interactive input available only for authorized sessions'} className="h-10 w-full cursor-not-allowed rounded-lg border border-line bg-subtle px-3 text-sm text-muted" />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} aria-hidden />{blocked || (busyNow ? 'Input is disabled while a command is in progress.' : reason[st])}</p></div>
            )}
            <p className="mt-2 border-t border-line pt-2 text-xs text-muted">Each action records Actor ({me.name}), timestamp, Correlation ID <Mono>COR-014-01</Mono>, Audit status (Logged). Source: recorded transcript. Retention: project retention period (demo).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Gated allowed={canRequest} reason={blocked || (st === 'interactive' ? 'You already have interactive access.' : st === 'pending' ? 'A request is already pending.' : !can('interactive') ? 'Your role cannot request interactive access.' : 'Session is not active.')}><Button icon={TerminalSquare} onClick={() => setDrawer(true)}>{renew ? 'Request renewal' : 'Request time-limited access'}</Button></Gated>
            <Gated allowed={!!grant && !blocked} reason="You do not currently hold a grant."><Button variant="danger" onClick={() => revoke(s, me.name)}>Revoke my access</Button></Gated>
            <Gated allowed={can('terminate') && !blocked && st !== 'terminated'} reason={blocked || (!can('terminate') ? 'Only a Red Team Manager or Organization Admin can terminate sessions.' : 'Session is already terminated.')}><Button variant="danger" icon={OctagonX} onClick={() => terminate(s)}>Terminate session</Button></Gated>
            <Button size="sm" variant="ghost" onClick={() => go('c2-session', { id: s.id })}>Close</Button>
            <Gated allowed={st === 'interactive'} reason="Demo control is only available while a grant is active."><Button size="sm" variant="ghost" onClick={() => { A.expireGrant(s.id, me.name); toast('Demo: grant expiry simulated.', 'warn') }}>Demo: simulate expiry</Button></Gated>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={rs.failNext} onChange={(e) => setFailNext(e.target.checked)} />Demo: next revoke fails</label>
            <Gated allowed={!!s.transcript.length && !blocked} reason={blocked}><Button size="sm" variant="ghost" icon={Copy} onClick={() => { navigator.clipboard?.writeText(s.transcript.map((l) => `${l.ts} ${l.who} ${l.text}`).join('\n')); toast('Transcript copied (demo data).') }}>Copy transcript</Button></Gated>
          </div>
        </div>
        <Card><CardHeader title="Session info" actions={<span className="text-xs font-medium text-muted" aria-live="polite">{statusLabel}</span>} />
          <DescList cols={1} items={[
            { k: s.kind === 'web' ? 'Endpoint alias (masked)' : 'Asset', v: s.kind === 'web' ? <Mono>web-endpoint-••{s.id.slice(-2)}</Mono> : asset ? <IdLink onClick={() => go('asset', { id: asset.id })}>{asset.name}</IdLink> : s.asset },
            ...(s.kind === 'web' ? [{ k: 'Asset scope', v: asset ? <Status kind="scope" value={asset.scope} size="sm" /> : '—' }] : []),
            { k: 'Agent', v: <IdLink onClick={() => go('agent', { id: s.agentId })}>{s.agentId}</IdLink> },
            { k: 'Linked operation', v: <IdLink onClick={() => go('operation', { id: s.opId, tab: 'overview' })}>{s.opId}</IdLink> },
            { k: 'Approved ROE', v: project?.roeVersion || '—' },
            { k: 'Access grant', v: grant ? `Interactive until ${grant.expires}` : 'None' },
            { k: 'Last reviewer', v: grant?.by || db.sessionRequests.find((r) => r.sessionId === s.id && r.decidedBy)?.decidedBy || '—' },
            { k: 'Last observed', v: s.last },
            ...(s.kind === 'web' ? [{ k: 'HTTP session health', v: s.state === 'connected' ? 'Stable (demo)' : 'Unavailable' }] : []),
          ]} />
          <div className="mt-3"><Button size="sm" icon={Bot} onClick={() => go('ai-operator')}>Ask AI to explain output</Button><p className="mt-1 text-xs text-muted">Observe only — the AI cannot send input.</p></div>
        </Card>
      </div>
      <RequestAccessDrawer session={s} open={drawer} onClose={() => setDrawer(false)} />
    </>
  )
}
