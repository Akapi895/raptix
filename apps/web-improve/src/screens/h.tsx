import { useMemo, useState, type ComponentType } from 'react'
import { Activity, ClipboardCheck, Download, Eye, Lock, OctagonX, Radio, RadioTower, ShieldAlert, SlidersHorizontal, TerminalSquare, TriangleAlert } from 'lucide-react'
import { useStore, sessionPerm } from '../store'
import type { Session, SessionRequest } from '../data'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Empty, Field, FilterBar, Gated, IdLink, Kpi, Mono, PageHeader, Person, Progress, SearchBox, Segmented, Select, Status, Table, Tabs, Textarea, Timeline, usePaged, Pager, DemoTag, Modal, cx } from '../ui'
import { AccessChip, Console, RequestAccessDrawer, SELECT_PROJECT, SessionDetail, accessOf, kindLabel, useGrantWatch, useTerminate, MIN_REASON } from './h-session'

const TABS = [
  { id: 'infrastructure', label: 'Infrastructure' }, { id: 'channels', label: 'Channels' }, { id: 'sessions', label: 'Active Sessions' },
  { id: 'requests', label: 'Access Requests' }, { id: 'audit', label: 'Audit & Policy' },
]
const short = (t: string) => t.replace('Oct 13, 2026, ', '')

function C2Overview() {
  const { db, scoped, route, go, pid, me, project } = useStore()
  useGrantWatch()
  const tab = route.tab || 'infrastructure'
  const all = pid === 'all'
  const nodes = db.c2Nodes.filter((n) => all ? n.projectIds.some((p) => scoped([{ projectId: p }]).length) || n.projectIds.length === 0 : n.projectIds.includes(pid))
  const channels = scoped(db.channels)
  const sessions = scoped(db.sessions).filter((s) => sessionPerm(db, me, s) !== 'none' || me.role === 'viewer')
  const requests = scoped(db.sessionRequests)
  const agents = scoped(db.agents).filter((a) => a.status === 'online' || a.status === 'idle')
  const pending = requests.filter((r) => r.status === 'pending')
  const stop = db.stopState
  const noC2 = !all && nodes.length === 0 && channels.length === 0
  const degraded = nodes.filter((n) => n.status === 'degraded' || n.status === 'offline')
  const viaNode = (nid: string) => sessions.filter((s) => channels.find((c) => c.id === s.channelId)?.nodeId === nid && s.state === 'connected').length
  const noC2Reasons = project ? [project.roeStatus !== 'approved' ? `ROE ${project.roeVersion} is ${project.roeStatus}, not approved` : '', agents.length === 0 ? 'No agents are assigned to this project' : '', 'No C2 node or channel is allocated to this project'].filter(Boolean) : []
  return (
    <>
      <PageHeader title="C2 & Sessions" sub="Authorized infrastructure, channels and sessions. Interactive access always needs an approved, time-limited grant."
        actions={<><Button icon={Eye} onClick={() => go('c2', { tab: 'audit' })}>View audit log</Button>
          <Gated allowed={!all && !noC2} reason={all ? SELECT_PROJECT : 'This project has no sessions to request access to.'}><Button variant="primary" icon={TerminalSquare} onClick={() => go('c2', { tab: 'sessions' })}>Request session access</Button></Gated></>} />
      {all && <div className="mb-4"><Banner tone="info" icon={Lock} title="All Projects — read-only summary">{SELECT_PROJECT}. Session actions are disabled in this mode.</Banner></div>}
      {stop && <div className="mb-4"><Banner tone={stop.phase === 'stopped' ? 'ok' : stop.phase === 'failed' ? 'bad' : 'warn'} icon={OctagonX} title={stop.phase === 'requested' ? 'Emergency stop requested — awaiting acknowledgement' : stop.phase === 'stopped' ? 'Emergency stop acknowledged and completed' : stop.phase === 'failed' ? 'Emergency stop failed — no acknowledgement' : stop.phase === 'unknown' ? 'Emergency stop status unknown' : 'Emergency stop acknowledged — stopping'}>Sessions for {stop.scope} {stop.id} are being revoked. Reason: {stop.reason}</Banner></div>}
      {noC2 && <div className="mb-4"><Banner tone="info" icon={RadioTower} title={`No C2 infrastructure for ${pid}`} action={<Button size="sm" onClick={() => go('project', { id: pid })}>Open project readiness</Button>}>{noC2Reasons.join('. ')}. Allocate nodes and agents once the ROE is approved. Nothing from other projects is shown here.</Banner></div>}
      {degraded.map((n) => <div key={n.id} className="mb-4"><Banner tone={n.status === 'offline' ? 'bad' : 'warn'} icon={TriangleAlert} title={`${n.id} ${n.name} is ${n.status} (${n.latency})`} action={<Button size="sm" onClick={() => go('c2', { tab: 'infrastructure', id: n.id })}>View node</Button>}>{viaNode(n.id) ? `${viaNode(n.id)} connected session(s) in this project route through this node. Expect delays.` : 'No connected session in this project currently routes through this node.'}</Banner></div>)}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Healthy nodes" value={`${nodes.filter((n) => n.status === 'healthy').length}/${nodes.length}`} tone={degraded.length ? 'warn' : 'ok'} icon={RadioTower} onClick={() => go('c2', { tab: 'infrastructure' })} />
        <Kpi label="Active channels" value={channels.filter((c) => c.status !== 'disconnected').length} icon={Activity} onClick={() => go('c2', { tab: 'channels' })} />
        <Kpi label="Connected agents" value={agents.length} onClick={() => go('agents')} />
        <Kpi label="Active sessions" value={sessions.filter((s) => s.state === 'connected').length} tone="accent" icon={Radio} onClick={() => go('c2', { tab: 'sessions' })} />
        <Kpi label="Pending access" value={pending.length} tone={pending.length ? 'warn' : undefined} icon={ClipboardCheck} onClick={() => go('c2', { tab: 'requests' })} />
        <Kpi label="Terminated sessions" value={sessions.filter((s) => s.state === 'terminated').length} onClick={() => go('c2', { tab: 'sessions' })} />
      </div>
      {nodes.length > 0 && <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{nodes.map((n) => (
        <button key={n.id} onClick={() => go('c2', { tab: 'infrastructure', id: n.id })} className="rounded-xl border border-line bg-panel p-3 text-left hover:bg-hover">
          <div className="mb-1 flex items-center justify-between gap-2"><Mono>{n.id}</Mono><Status kind="c2" value={n.status} size="sm" /></div>
          <div className="text-sm font-medium">{n.name}</div>
          <div className="mb-2 text-xs text-muted">{n.kind} · {n.latency} · {channels.filter((c) => c.nodeId === n.id).length} channel(s)</div>
          <Progress value={n.load} tone={n.load > 70 ? 'warn' : 'accent'} label={`${n.load}% load`} />
        </button>))}</div>}
      <Tabs tabs={TABS.map((t) => ({ ...t, count: t.id === 'requests' ? pending.length : undefined }))} value={tab} onChange={(t) => go('c2', { tab: t })} />
      <div className="mt-4">
        {tab === 'infrastructure' && <Infra nodes={nodes} noC2={noC2} />}
        {tab === 'channels' && <Channels rows={channels} noC2={noC2} />}
        {tab === 'sessions' && <Sessions rows={sessions} all={all} />}
        {tab === 'requests' && <Requests rows={requests} all={all} />}
        {tab === 'audit' && <AuditViewer />}
      </div>
    </>
  )
}

function Infra({ nodes, noC2 }: { nodes: ReturnType<typeof useStore>['db']['c2Nodes']; noC2: boolean }) {
  const { db, go, scoped, route, pid, me } = useStore()
  const [sel, setSel] = useState<string | null>(route.id && nodes.some((x) => x.id === route.id) ? route.id : null)
  const n = nodes.find((x) => x.id === sel)
  const chans = (id: string) => scoped(db.channels).filter((c) => c.nodeId === id)
  const projs = (ids: string[]) => ids.filter((p) => pid === 'all' ? scoped([{ projectId: p }]).length : p === pid)
  return (
    <>
      <Card pad={false}><Table rows={nodes} rowKey={(r) => r.id} onRow={(r) => setSel(r.id)}
        empty={<Empty icon={RadioTower} title="No C2 nodes for this project" action={noC2 ? <Button onClick={() => go('project', { id: pid })}>Open project readiness</Button> : undefined}>Nodes appear once infrastructure is allocated to the project and its ROE is approved.</Empty>}
        cols={[
          { key: 'id', header: 'Node ID', render: (r) => <Mono className="whitespace-nowrap">{r.id}</Mono> }, { key: 'n', header: 'Friendly name', render: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'k', header: 'Type', render: (r) => r.kind, hideBelow: 'md' }, { key: 'r', header: 'Environment / region', render: (r) => <span>Lab · {r.region}</span>, hideBelow: 'lg' },
          { key: 'o', header: 'Owner', render: () => 'Platform Ops (demo)', hideBelow: 'lg' },
          { key: 'p', header: 'Project scope', render: (r) => projs(r.projectIds).join(', ') || 'Unassigned', hideBelow: 'lg' },
          { key: 'h', header: 'Health', render: (r) => <Status kind="c2" value={r.status} size="sm" /> },
          { key: 'c', header: 'Channels', render: (r) => chans(r.id).map((c) => c.id).join(', ') || '—', hideBelow: 'md' },
          { key: 'hb', header: 'Last seen', render: (r) => <span className="whitespace-nowrap">{short(r.last)}</span>, hideBelow: 'lg' },
          { key: 'a', header: '', render: (r) => <Button size="sm" onClick={() => setSel(r.id)}>View details</Button> },
        ]} /></Card>
      <Drawer open={!!n} onClose={() => setSel(null)} title={n ? `${n.id} · ${n.name}` : ''} footer={n && <><Button onClick={() => { setSel(null); go('c2', { tab: 'channels' }) }}>View channels</Button><Gated allowed={false} reason="Policy changes need an approved change request from an Organization Admin."><Button>Request change</Button></Gated></>}>
        {n && <div className="space-y-4"><Status kind="c2" value={n.status} />
          {n.status === 'degraded' && <Banner tone="warn" title="Degraded">Latency is above the 150 ms threshold. Sessions stay connected but may respond slowly.</Banner>}
          {n.status === 'maintenance' && <Banner tone="info" title="Maintenance window">This node is unassigned and not accepting channels.</Banner>}
          <DescList cols={1} items={[
            { k: 'Region (metadata)', v: n.region }, { k: 'Role', v: n.kind }, { k: 'Version', v: n.version }, { k: 'Latency', v: n.latency }, { k: 'Capacity used', v: <Progress value={n.load} tone={n.load > 70 ? 'warn' : 'accent'} label={`${n.load}%`} /> },
            { k: 'Certificate status', v: n.status === 'offline' ? 'Unknown' : 'Valid (demo)' }, { k: 'Access policy', v: 'Project-scoped interactive access v2' },
            { k: 'Linked channels', v: chans(n.id).length ? chans(n.id).map((c) => <span key={c.id} className="mr-2"><IdLink onClick={() => go('c2-channel', { id: c.id })}>{c.id}</IdLink></span>) : 'None in this project' },
            { k: 'Related sessions', v: scoped(db.sessions).filter((s) => sessionPerm(db, me, s) !== 'none' && db.channels.find((c) => c.id === s.channelId)?.nodeId === n.id).length },
          ]} />
          <Timeline items={[{ at: n.last, title: n.status === 'healthy' ? 'Heartbeat received' : n.status === 'degraded' ? 'High latency detected' : 'Maintenance window', tone: n.status === 'healthy' ? 'ok' : 'warn' }]} />
          <DemoTag /></div>}
      </Drawer>
    </>
  )
}

function Channels({ rows, noC2 }: { rows: ReturnType<typeof useStore>['db']['channels']; noC2: boolean }) {
  const { go, pid } = useStore()
  return <Card pad={false}><Table rows={rows} rowKey={(r) => r.id} onRow={(r) => go('c2-channel', { id: r.id })} empty={<Empty icon={Activity} title="No channels for this project" action={noC2 ? <Button onClick={() => go('project', { id: pid })}>Open project readiness</Button> : undefined}>Channels are created when a C2 node is allocated to the project.</Empty>}
    cols={[
      { key: 'id', header: 'Channel', render: (r) => <IdLink onClick={() => go('c2-channel', { id: r.id })}>{r.id}</IdLink> }, { key: 'n', header: 'Name', render: (r) => r.name },
      { key: 'p', header: 'Protocol', render: (r) => r.protocol }, { key: 'node', header: 'C2 node', render: (r) => <Mono>{r.nodeId}</Mono> }, { key: 'pr', header: 'Project', render: (r) => <Mono className="whitespace-nowrap">{r.projectId}</Mono>, hideBelow: 'md' },
      { key: 's', header: 'State', render: (r) => <Status kind="channel" value={r.status} size="sm" /> }, { key: 'ss', header: 'Sessions', render: (r) => r.sessions }, { key: 'l', header: 'Last heartbeat', render: (r) => <span className="whitespace-nowrap">{short(r.last)}</span>, hideBelow: 'lg' },
    ]} /></Card>
}

function Sessions({ rows, all }: { rows: Session[]; all: boolean }) {
  const { db, go, me, can, route, pid } = useStore()
  const [q, setQ] = useState(''), [f, setF] = useState('all'), [type, setType] = useState('all')
  const [more, setMore] = useState(false), [agent, setAgent] = useState(route.id && route.id.startsWith('AG-') ? route.id : 'all'), [op, setOp] = useState('all'), [acc, setAcc] = useState('all')
  const [drawer, setDrawer] = useState<Session | null>(null)
  const terminate = useTerminate()
  const list = rows.filter((s) => {
    const a = accessOf(db, me, s)
    return (agent === 'all' || s.agentId === agent) && (op === 'all' || s.opId === op) && (type === 'all' || s.kind === type) && (acc === 'all' || a.key === acc)
      && (f === 'all' || (f === 'ended' ? ['terminated', 'revoking', 'expired'].includes(s.state) : s.state === f))
      && (!q || `${s.id} ${s.asset} ${s.agentId} ${s.opId}`.toLowerCase().includes(q.toLowerCase()))
  })
  const pg = usePaged(list, 10)
  const nMore = (agent !== 'all' ? 1 : 0) + (op !== 'all' ? 1 : 0) + (acc !== 'all' ? 1 : 0)
  const agentIds = [...new Set(rows.map((s) => s.agentId))], opIds = [...new Set(rows.map((s) => s.opId))]
  return (
    <>
      <FilterBar right={<div className="relative"><Button size="sm" icon={SlidersHorizontal} aria-expanded={more} onClick={() => setMore(!more)}>More filters{nMore ? ` (${nMore})` : ''}</Button>
        {more && <div className="absolute right-0 top-full z-30 mt-1.5 w-64 space-y-3 rounded-xl border border-line bg-panel p-3 shadow-xl">
          <Field label="Agent"><Select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="all">All agents</option>{agentIds.map((a) => <option key={a}>{a}</option>)}</Select></Field>
          <Field label="Operation"><Select value={op} onChange={(e) => setOp(e.target.value)}><option value="all">All operations</option>{opIds.map((a) => <option key={a}>{a}</option>)}</Select></Field>
          <Field label="Your access"><Select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="all">Any</option><option value="interactive">Interactive</option><option value="read-only">Read-only</option><option value="pending">Pending request</option><option value="expired">Expired</option><option value="none">None</option></Select></Field>
          <Button size="sm" variant="ghost" onClick={() => { setAgent('all'); setOp('all'); setAcc('all') }}>Clear</Button></div>}</div>}>
        <SearchBox value={q} onChange={setQ} placeholder="Search session, target, agent…" className="w-64" />
        <Select value={f} onChange={(e) => setF(e.target.value)} aria-label="Filter by connection" className="w-44"><option value="all">All connections</option><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="ended">Ended</option></Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type" className="w-40"><option value="all">All types</option><option value="reverse">Reverse Shell</option><option value="web">Web Shell</option></Select>
      </FilterBar>
      <Card pad={false}><Table rows={pg.rows} rowKey={(r) => r.id} onRow={(r) => go('c2-session', { id: r.id })}
        empty={<Empty icon={Radio} title={all ? 'No sessions in your projects' : `No sessions in ${pid}`} action={<Button onClick={() => go('agents')}>View agents</Button>}>Sessions appear when a running operation connects an agent to an approved asset. This project has none yet.</Empty>}
        cols={[
          { key: 'id', header: 'Session', render: (r) => <IdLink onClick={() => go('c2-session', { id: r.id })}>{r.id}</IdLink> }, { key: 't', header: 'Type', render: (r) => <span className="whitespace-nowrap">{kindLabel(r.kind)}</span> },
          { key: 'a', header: 'Target', render: (r) => r.asset, hideBelow: 'md' }, { key: 'ag', header: 'Agent', render: (r) => <Mono className="whitespace-nowrap">{r.agentId}</Mono>, hideBelow: 'lg' }, { key: 'op', header: 'Operation', render: (r) => <Mono className="whitespace-nowrap">{r.opId}</Mono>, hideBelow: 'lg' },
          { key: 's', header: 'Connection', render: (r) => <Status kind="session" value={r.state} size="sm" /> },
          { key: 'pm', header: 'Your access', render: (r) => <AccessChip a={accessOf(db, me, r)} /> },
          { key: 'x', header: 'Expires', render: (r) => { const g = r.grants.find((x) => x.user === me.name); return <span className="whitespace-nowrap">{g ? short(g.expires) : '—'}</span> }, hideBelow: 'lg' },
          { key: 'l', header: 'Last activity', render: (r) => <span className="whitespace-nowrap">{short(r.last)}</span>, hideBelow: 'lg' },
          { key: 'act', header: '', render: (r) => {
            const a = accessOf(db, me, r), dead = ['expired', 'terminated', 'revoking'].includes(r.state)
            const noConsole = all ? SELECT_PROJECT : dead ? `Session is ${r.state}.` : r.state === 'disconnected' ? 'Session is disconnected.' : a.key === 'pending' ? `Interactive access is pending (${a.detail}).` : 'Interactive access is not granted. Request access first.'
            const noReq = all ? SELECT_PROJECT : dead ? `Session is ${r.state}.` : a.key === 'interactive' ? 'You already have interactive access.' : a.key === 'pending' ? `Request ${a.detail} is already pending.` : 'Your role cannot request interactive access.'
            return <span className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Gated allowed={!all && a.key === 'interactive' && r.state === 'connected'} reason={noConsole}><Button size="sm" icon={TerminalSquare} onClick={() => go('c2-console', { id: r.id })}>Open console</Button></Gated>
              <Gated allowed={!all && can('interactive') && !dead && a.key !== 'interactive' && a.key !== 'pending'} reason={noReq}><Button size="sm" onClick={() => setDrawer(r)}>{a.key === 'expired' ? 'Request renewal' : 'Request access'}</Button></Gated>
              {can('terminate') && !dead && !all && <Button size="sm" variant="danger" onClick={() => terminate(r)}>Terminate</Button>}
            </span>
          } },
        ]} /></Card>
      <Pager page={pg.page} pages={pg.pages} setPage={pg.setPage} total={list.length} />
      <p className="mt-2 text-xs text-muted">Connection and Your access are separate: a session can be Connected while your access is Pending or Read-only.</p>
      {drawer && <RequestAccessDrawer session={drawer} open onClose={() => setDrawer(null)} />}
    </>
  )
}

function Requests({ rows, all }: { rows: SessionRequest[]; all: boolean }) {
  const { A, db, me, can, toast, go } = useStore()
  const approver = can('approveAccess')
  const [sel, setSel] = useState<{ r: SessionRequest; d: 'approved' | 'rejected' | 'changes' } | null>(null)
  const [note, setNote] = useState('')
  const [mins, setMins] = useState<'30' | '60'>('30')
  const [err, setErr] = useState(false)
  const [renew, setRenew] = useState<Session | null>(null)
  const sorted = [...rows].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
  const open = (r: SessionRequest, d: 'approved' | 'rejected' | 'changes') => { setSel({ r, d }); setMins(/^30/.test(r.duration) ? '30' : '60'); setNote(''); setErr(false) }
  const submit = () => {
    if (!sel) return
    if (note.trim().length < MIN_REASON / 2) { setErr(true); return }
    A.decideSessionRequest(sel.r.id, sel.d, note.trim(), sel.d === 'approved' ? parseInt(mins) : undefined)
    toast(sel.d === 'approved' ? `${sel.r.id} approved for ${mins} minutes. The grant applies to ${sel.r.sessionId} only.` : `${sel.r.id} ${sel.d === 'changes' ? 'returned for changes' : 'rejected'}.`); setSel(null)
  }
  return (
    <>
      {!approver && <div className="mb-3"><Banner tone="info" icon={Lock} title="Approver view is read-only for your role">You can see request status. Decisions are made by a Red Team Manager, Reviewer or Organization Admin.</Banner></div>}
      <Card pad={false}><Table rows={sorted} rowKey={(r) => r.id} empty={<Empty icon={ClipboardCheck} title="No access requests in this project">Open a session and choose Request access to start one.</Empty>} cols={[
        { key: 'id', header: 'Request', render: (r) => <Mono className="whitespace-nowrap">{r.id}</Mono> }, { key: 's', header: 'Session', render: (r) => <IdLink onClick={() => go('c2-session', { id: r.sessionId })}>{r.sessionId}</IdLink> },
        { key: 'by', header: 'Requester', render: (r) => <Person name={r.by} /> }, { key: 'm', header: 'Scope', render: (r) => <Status kind="perm" value={r.mode} size="sm" /> }, { key: 'd', header: 'Duration', render: (r) => <span className="whitespace-nowrap">{r.duration}</span>, hideBelow: 'md' },
        { key: 'r', header: 'Purpose', render: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}{r.note ? ` — Decision: ${r.note}` : ''}</span>, hideBelow: 'lg' },
        { key: 'st', header: 'Status', render: (r) => <span className="flex flex-col gap-0.5"><Status kind="access" value={r.status} size="sm" />{r.status === 'pending' && <span className="text-xs text-muted">Awaiting reviewer</span>}</span> },
        { key: 'a', header: '', render: (r) => {
          if (r.status === 'expired') { const ses = db.sessions.find((x) => x.id === r.sessionId); return r.by === me.name && ses ? <Gated allowed={!all && can('interactive') && ses.state === 'connected'} reason={all ? SELECT_PROJECT : 'Session is not connected or your role cannot request access.'}><Button size="sm" variant="primary" onClick={() => setRenew(ses)}>Request renewal</Button></Gated> : <span className="text-xs text-muted">Grant expired</span> }
          if (r.status !== 'pending') return <span className="text-xs text-muted">{r.decidedBy ? `By ${r.decidedBy}` : ''}</span>
          const why = all ? SELECT_PROJECT : r.by === me.name ? 'You cannot review your own request.' : 'Only a Red Team Manager, Reviewer or Organization Admin can decide access requests.'
          return <Gated allowed={approver && !all && r.by !== me.name} reason={why}><span className="flex gap-1.5"><Button size="sm" variant="primary" onClick={() => open(r, 'approved')}>Approve</Button><Button size="sm" onClick={() => open(r, 'changes')}>Request changes</Button><Button size="sm" variant="danger" onClick={() => open(r, 'rejected')}>Reject</Button></span></Gated>
        } },
      ]} /></Card>
      <Modal open={!!sel} onClose={() => { setSel(null); setErr(false) }} title={sel ? `${sel.d === 'approved' ? 'Approve access' : sel.d === 'rejected' ? 'Reject' : 'Request changes'} — ${sel.r.id}` : ''}
        footer={<><Button onClick={() => setSel(null)}>Cancel</Button><Button variant={sel?.d === 'rejected' ? 'danger' : 'primary'} onClick={submit}>{sel?.d === 'approved' ? `Approve for ${mins}m` : 'Confirm decision'}</Button></>}>
        {sel && <div className="space-y-3 text-sm"><p>{sel.r.by} requests <b>{sel.r.mode}</b> access to <Mono>{sel.r.sessionId}</Mono> (requested: {sel.r.duration}).</p><p className="rounded-lg bg-subtle p-3 text-muted">“{sel.r.reason}”</p>
          {sel.d === 'approved' && <><Field label="Grant duration"><Segmented options={[{ id: '30', label: '30 minutes' }, { id: '60', label: '60 minutes' }]} value={mins} onChange={setMins} /></Field><p className="text-muted">The grant is limited to this session and expires automatically. It does not raise project-wide permissions.</p></>}
          <Field label="Reason for decision" required error={err ? 'A decision reason is required.' : undefined}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>}
      </Modal>
      {renew && <RequestAccessDrawer session={renew} open onClose={() => setRenew(null)} />}
    </>
  )
}

function AuditViewer() {
  const { db, scoped, toast, can, pid, go } = useStore()
  const [t, setT] = useState('access')
  const [q, setQ] = useState('')
  const re: Record<string, RegExp> = { access: /access|grant/i, events: /session|connect/i, policy: /policy|denied|blocked|tool call/i, term: /terminat|revok|stop/i }
  const rows = useMemo(() => scoped(db.audit.filter((a) => re[t].test(a.action) || (t === 'policy' && a.result === 'Denied'))).filter((a) => !q || `${a.corr || ''} ${a.obj} ${a.actor} ${a.action}`.toLowerCase().includes(q.toLowerCase())), [db.audit, t, q, pid]) // eslint-disable-line
  const pg = usePaged(rows, 10)
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2"><Tabs tabs={[{ id: 'access', label: 'Access history' }, { id: 'events', label: 'Connection events' }, { id: 'policy', label: 'Policy decisions' }, { id: 'term', label: 'Revocation & termination' }]} value={t} onChange={setT} />
        <span className="ml-auto flex items-center gap-2"><SearchBox value={q} onChange={setQ} placeholder="Search or paste COR-014-01…" className="w-56" /><Gated allowed={can('admin')} reason="Exporting the audit log requires Organization Admin authorization."><Button icon={Download} onClick={() => toast('Audit log export queued (demo).')}>Export audit log</Button></Gated></span></div>
      {q.startsWith('COR-') && <div className="mb-3"><Banner tone="info" title={`Correlation ${q}`}>Showing events that share this correlation ID across access, session and policy records.</Banner></div>}
      <Card pad={false}><Table rows={pg.rows} rowKey={(r) => r.id} empty={<Empty icon={ShieldAlert} title="No events in this view">{pid === 'all' ? 'Nothing matches this filter.' : `No ${t === 'term' ? 'revocation or termination' : t} events recorded for ${pid} yet.`} Events appear as sessions are requested, granted and ended.</Empty>} cols={[
        { key: 'at', header: 'Timestamp', render: (r) => <span className="whitespace-nowrap">{short(r.at)}</span> }, { key: 'a', header: 'Actor', render: (r) => r.actor },
        { key: 'c', header: 'Correlation ID', render: (r) => r.corr ? <button className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => setQ(r.corr!)}>{r.corr}</button> : '—' },
        { key: 'p', header: 'Project', render: (r) => <span className="whitespace-nowrap">{r.projectId || '—'}</span>, hideBelow: 'md' },
        { key: 'o', header: 'Object', render: (r) => /^SS-/.test(r.obj) ? <IdLink onClick={() => go('c2-session', { id: r.obj })}>{r.obj}</IdLink> : <Mono>{r.obj}</Mono> }, { key: 'ac', header: 'Action', render: (r) => r.action }, { key: 'r', header: 'Result', render: (r) => <span className={cx('font-medium', r.result === 'Failed' || r.result === 'Denied' ? 'text-bad' : '')}>{r.result}</span> },
        { key: 'rs', header: 'Reason', render: (r) => r.reason || '—', hideBelow: 'lg' },
      ]} /></Card>
      <Pager page={pg.page} pages={pg.pages} setPage={pg.setPage} total={rows.length} />
      {t === 'policy' && <Card className="mt-3"><CardHeader title="Active session policy" actions={<DemoTag />} /><DescList cols={1} items={[{ k: 'Interactive sessions', v: 'Require an approved, time-limited, per-session grant' }, { k: 'Targets', v: 'Only in-scope assets under an approved ROE' }, { k: 'Grant limits', v: '30 or 60 minutes, auto-expire, never project-wide' }, { k: 'Enforcement', v: 'Simulated in this prototype — no real policy engine or C2 enforcement' }]} /></Card>}
      <p className="mt-2 text-xs text-muted">Metadata is masked. Termination events show requested and acknowledged states separately.</p>
    </>
  )
}

function ChannelDetail() {
  const { db, route, go, me, scoped } = useStore()
  const [tab, setTab] = useState('overview')
  const c = db.channels.find((x) => x.id === route.id)
  const back = { label: 'C2 & Sessions', to: () => go('c2', { tab: 'channels' }) }
  if (!c || !scoped([c]).length) return <><PageHeader title="Channel not found" back={back} /><Empty icon={Activity} title={`No channel "${route.id}" in this project`} action={<Button onClick={() => go('c2', { tab: 'channels' })}>Back to channels</Button>}>It may belong to another project. Switch project to view it.</Empty></>
  const node = db.c2Nodes.find((n) => n.id === c.nodeId)
  const sess = db.sessions.filter((s) => s.channelId === c.id && sessionPerm(db, me, s) !== 'none')
  const agents = db.agents.filter((a) => sess.some((s) => s.agentId === a.id))
  const ops = db.operations.filter((o) => sess.some((s) => s.opId === o.id))
  const bad = c.status !== 'connected'
  return (
    <>
      <PageHeader back={back} title={<span className="flex items-center gap-3"><Mono>{c.id}</Mono><span className="text-base font-medium text-muted">{c.name}</span></span>} meta={<Status kind="channel" value={c.status} />}
        actions={<Button onClick={() => go('c2', { tab: 'sessions' })}>View sessions</Button>} />
      <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'agents', label: 'Connected agents', count: agents.length }, { id: 'health', label: 'Health history' }, { id: 'ops', label: 'Related operations', count: ops.length }, { id: 'policy', label: 'Policy' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'overview' && <Card><DescList items={[{ k: 'Owning C2 node', v: node ? <span>{node.id} · {node.name} <Status kind="c2" value={node.status} size="sm" /></span> : c.nodeId }, { k: 'Approved project', v: <Mono>{c.projectId}</Mono> }, { k: 'Protocol', v: c.protocol }, { k: 'Check-in interval', v: `${c.beacon} (jitter ${c.jitter})` }, { k: 'Latency', v: node?.latency || '—' }, { k: 'Last heartbeat', v: c.last }, { k: 'Sessions', v: c.sessions }, { k: 'Callback configuration', v: <span className="inline-flex items-center gap-1.5 text-muted"><Lock size={12} aria-hidden /><Mono>••••••••••</Mono> masked — Organization Admin only</span> }, { k: 'Policy status', v: 'Compliant (demo)' }]} /></Card>}
        {tab === 'agents' && <Card pad={false}><Table rows={agents} rowKey={(a) => a.id} empty={<Empty icon={Activity} title="No agents connected through this channel">Agents appear here once a session is established over {c.id}.</Empty>} cols={[{ key: 'i', header: 'Agent', render: (a) => <IdLink onClick={() => go('agent', { id: a.id })}>{a.id}</IdLink> }, { key: 'h', header: 'Host', render: (a) => a.host }, { key: 's', header: 'Status', render: (a) => <Status kind="agent" value={a.status} size="sm" /> }, { key: 'l', header: 'Last seen', render: (a) => <span className="whitespace-nowrap">{short(a.lastSeen)}</span> }]} /></Card>}
        {tab === 'health' && <Card><CardHeader title="Health history" actions={<DemoTag />} /><Timeline items={[
          { at: c.last, title: c.status === 'connected' ? 'Heartbeat received' : c.status === 'degraded' ? `Latency above threshold (${node?.latency || '—'})` : 'Connection lost', tone: bad ? 'warn' : 'ok' },
          ...(c.status === 'degraded' ? [{ at: 'Oct 13, 2026, 10:15 AM (UTC+7)', title: 'Latency crossed 150 ms', tone: 'warn' as const }] : []),
          { at: 'Oct 13, 2026, 9:30 AM (UTC+7)', title: 'Channel connected', tone: 'ok' },
        ]} /></Card>}
        {tab === 'ops' && <Card pad={false}><Table rows={ops} rowKey={(o) => o.id} empty={<Empty icon={Activity} title="No operations use this channel yet">Operations that open sessions over {c.id} will be listed.</Empty>} cols={[{ key: 'i', header: 'Operation', render: (o) => <IdLink onClick={() => go('operation', { id: o.id, tab: 'overview' })}>{o.id}</IdLink> }, { key: 'n', header: 'Name', render: (o) => o.name }, { key: 's', header: 'Status', render: (o) => <Status kind="op" value={o.status} size="sm" /> }]} /></Card>}
        {tab === 'policy' && <Card><DescList cols={1} items={[{ k: 'Access policy', v: 'Project-scoped interactive access v2' }, { k: 'Interactive sessions', v: 'Require approval and a time limit' }, { k: 'Recording', v: 'Always on' }]} /><p className="mt-3 text-sm text-muted">Need a change? <Button size="sm" onClick={() => go('c2', { tab: 'requests' })}>Request support</Button></p></Card>}
      </div>
    </>
  )
}

export const routes: Record<string, ComponentType> = { c2: C2Overview, 'c2-channel': ChannelDetail, 'c2-session': SessionDetail, 'c2-console': Console }
