import { useEffect, useState } from 'react'
import { Lock, Pin, PinOff, Plus, SearchX, ShieldOff, Send, ArrowRight, CheckCircle2, CircleDashed, ChevronDown, Sparkles } from 'lucide-react'
import { useStore, canAccessProject, ROLE_LABEL, eligibility, readiness, completion } from '../store'
import { APR, planVer, type Project } from '../data'
import { Banner, Button, Card, CardHeader, Empty, FilterBar, IconButton, IdLink, Kpi, Menu, PageHeader, Pager, Person, Progress, Select, Status, Sev, Table, Tabs, Timeline, usePaged, useGuard, type Col } from '../ui'
import { ScopeTab, TeamTab, CloseTab, useSubmitApproval, useReopen } from './b-detail2'

export const parseDate = (s: string) => { const d = new Date(s.replace(/,?\s*\d{1,2}:\d{2}.*$/, '')); return isNaN(d.getTime()) ? new Date(2026, 9, 13) : d }
export const NOW = new Date(2026, 9, 13)

export const MAIN_TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'scope', label: 'Scope & ROE' }, { id: 'operations', label: 'Operations' }, { id: 'plans', label: 'AI Plans' }, { id: 'findings', label: 'Findings' }, { id: 'reports', label: 'Reports' },
]
export const MORE_TABS = [
  { id: 'objectives', label: 'Objectives' }, { id: 'activity', label: 'Activity' }, { id: 'team', label: 'Members & Approvals' }, { id: 'sessions', label: 'C2 Sessions' }, { id: 'evidence', label: 'Evidence' }, { id: 'audit', label: 'Audit' }, { id: 'close', label: 'Closeout' },
]
export const TAB_LIST = [...MAIN_TABS, ...MORE_TABS]
/** Old tab ids that may still appear in deep links */
const TAB_ALIAS: Record<string, string> = { closure: 'close', closeout: 'close', members: 'team', approvals: 'team', 'ai-plans': 'plans', c2: 'sessions', 'audit-log': 'audit', roe: 'scope' }

/** Access-blocked / not-found state. Never reveals project data. */
function Blocked({ kind, id }: { kind: 'forbidden' | 'notfound'; id?: string }) {
  const { go } = useStore()
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Empty
        icon={kind === 'forbidden' ? ShieldOff : SearchX}
        title={kind === 'forbidden' ? 'You do not have access to this project' : 'Project not found'}
        action={<div className="flex gap-2"><Button variant="primary" onClick={() => go('projects')}>Back to Projects</Button><Button onClick={() => go('command-center')}>Go to Command Center</Button></div>}
      >
        {kind === 'forbidden'
          ? 'Your account has not been added to this project, so its details are hidden. Ask the project owner to request access for you.'
          : `Project ${id ? `"${id}" ` : ''}does not exist or is not in the list you can view.`}
      </Empty>
    </div>
  )
}

export function ProjectPage() {
  const { route, db, me } = useStore()
  const id = route.id
  const p = db.projects.find((x) => x.id === id)
  if (!id || !p) return <Blocked kind="notfound" id={id} />
  if (!canAccessProject(db, me, id)) return <Blocked kind="forbidden" />
  return <Detail key={id} p={p} />
}

function Detail({ p }: { p: Project }) {
  const { db, me, go, route, A, toast, pid, setPid, confirm, can } = useStore()
  const rt = route.tab ? TAB_ALIAS[route.tab] || route.tab : ''
  const tab = TAB_LIST.some((t) => t.id === rt) ? rt : 'overview'
  const elig = eligibility(db, p.id)
  const guard = useGuard(p.id)
  const sub = useSubmitApproval(p)
  const reopen = useReopen(p)

  // Lock context: select the viewed project in the project switcher
  useEffect(() => { if (pid !== p.id) setPid(p.id) }, [pid, p.id, setPid])

  const ops = db.operations.filter((o) => o.projectId === p.id)
  const fs = db.findings.filter((f) => f.projectId === p.id)
  const reps = db.reports.filter((r) => r.projectId === p.id)
  const evs = db.evidence.filter((e) => e.projectId === p.id)
  const plans = db.plans.filter((x) => x.projectId === p.id)
  const sess = db.sessions.filter((x) => x.projectId === p.id)
  const pending = db.approvals.filter((a) => a.projectId === p.id && a.status === 'pending')
  const scopePending = pending.find((a) => a.type === APR.scope)

  const via = (page: string, opts?: { id?: string; tab?: string }) => { if (pid !== p.id) { setPid(p.id); setTimeout(() => go(page, opts), 80) } else go(page, opts) }
  const setTab = (t: string) => go('project', { id: p.id, tab: t })
  const canOp = !guard.ro && can('run', p.id)
  const closed = p.status === 'closed' || p.status === 'cancelled'
  const count = (id: string) => id === 'operations' ? ops.length : id === 'plans' ? plans.length : id === 'sessions' ? sess.length : id === 'findings' ? fs.length : id === 'reports' ? reps.length : id === 'evidence' ? evs.length : id === 'team' && pending.length ? pending.length : undefined
  const inMore = MORE_TABS.some((t) => t.id === tab)
  const canSubmit = (p.status === 'draft' || p.status === 'rejected') && can('editScope', p.id)

  const actions = (
    <>
      <IconButton
        icon={p.pinned ? PinOff : Pin} label={p.pinned ? 'Unpin project' : 'Pin project'} disabled={me.role === 'viewer'}
        onClick={() => { A.updateProject(p.id, { pinned: !p.pinned }); toast(p.pinned ? `Unpinned ${p.id}` : `Pinned ${p.id}`) }}
      />
      {canSubmit && (
        <Button icon={Send} variant="primary" disabled={!sub.ready} title={sub.ready ? undefined : `Cannot submit yet: ${sub.issues.join('; ')}`} onClick={sub.submit}>
          {p.status === 'rejected' ? 'Resubmit for Approval' : 'Request Approval'}
        </Button>
      )}
      {closed ? (
        can('reopen', p.id) ? <Button variant="danger" onClick={reopen}>Reopen Project</Button> : <span title="Only an Organization Admin can reopen a closed project"><Button disabled>Reopen Project</Button></span>
      ) : (
        <Button
          disabled={!can('requestClose', p.id)} onClick={() => setTab('close')}
          title={can('requestClose', p.id) ? 'Review the checklist and request project closure' : 'Only a Red Team Manager can request project closure'}
        >Close Project</Button>
      )}
      <Button icon={Sparkles} disabled={closed} title={closed ? 'Project is closed — read-only.' : 'Open AI Operator for this project'} onClick={() => via('ai-operator')}>Ask AI</Button>
      <Button variant="primary" icon={Plus} disabled={!canOp} title={canOp ? (elig.kind === 'locked' ? 'Saves a draft operation. Run stays blocked until execution is unlocked.' : undefined) : guard.ro ? guard.reason : 'Your role cannot create operations'} onClick={() => via('operation-new')}>Create Operation</Button>
    </>
  )

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: p.client }, { label: p.id }]}
        title={p.name}
        sub={<span><span className="font-mono">{p.id}</span> · {p.client} · {p.type} · {p.start} – {p.end} · Owner: {p.owner}</span>}
        meta={<span className="flex flex-wrap items-center gap-2"><Status kind="project" value={p.status} /><Status kind="generic" value={elig.tone === 'cyan' ? 'ok' : elig.tone} size="sm" label={elig.label} />{p.roeStatus !== 'approved' ? <span className="inline-flex"><Status kind="roe" value={p.roeStatus} label={p.roeStatus === 'none' ? 'No ROE' : 'ROE not approved'} /></span> : <Status kind="roe" value="approved" label={`${p.roeVersion} approved`} />}</span>}
        actions={actions}
      />
      {closed && <Banner tone="warn" icon={Lock} title={`${p.status === 'closed' ? 'Closed' : 'Cancelled'}${p.closedAt ? ` on ${p.closedAt}` : ''}`}>This project is read-only. Data is retained per policy; operations cannot be started and nothing can be edited. {p.status === 'closed' && 'Only an Organization Admin can reopen it, with a reason that is recorded in the audit log.'}</Banner>}
      {!closed && pending.length > 0 && (
        <Banner tone="warn" title={scopePending ? 'Awaiting approval of a new scope' : `Awaiting approval: ${pending[0].type}`} action={tab !== 'team' ? <Button size="sm" onClick={() => setTab('team')}>View approval request</Button> : undefined}>
          Submitted by {pending[0].by} on {pending[0].at}; reviewer: {pending[0].reviewer}.{scopePending && ' Operations that have not started are blocked by check PRE-03 until the new ROE is approved.'}
        </Banner>
      )}
      {!closed && pending.length === 0 && p.roeStatus === 'rejected' && (
        <Banner tone="bad" title="ROE returned for changes" action={<Button size="sm" onClick={() => setTab('scope')}>Edit scope</Button>}>Read the reviewer's note, update the scope, then resubmit for approval.</Banner>
      )}

      <div role="tablist" className="mb-5 flex items-center gap-1 border-b border-line">
        <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
          {MAIN_TABS.map((t) => {
            const c = count(t.id)
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`-mb-px inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium transition ${tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
                {t.label}{c !== undefined && <span className="rounded-full bg-hover px-1.5 text-xs text-muted">{c}</span>}
              </button>
            )
          })}
        </div>
        <div className="-mb-px shrink-0">
          <Menu align="left" trigger={<span role="tab" aria-selected={inMore} aria-haspopup="menu" className={`inline-flex h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium transition ${inMore ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>{inMore ? MORE_TABS.find((t) => t.id === tab)!.label : 'More'}<ChevronDown size={14} aria-hidden /></span>} items={MORE_TABS.map((t) => ({ label: `${t.label}${count(t.id) !== undefined ? ` (${count(t.id)})` : ''}`, onClick: () => setTab(t.id) }))} />
        </div>
      </div>

      {tab === 'overview' && <Overview p={p} via={via} setTab={setTab} />}
      {tab === 'scope' && <ScopeTab p={p} />}
      {tab === 'objectives' && <Objectives p={p} />}
      {tab === 'activity' && <Activity p={p} />}
      {tab === 'team' && <TeamTab p={p} />}
      {tab === 'operations' && <OpsTab p={p} via={via} setTab={setTab} />}
      {tab === 'plans' && <PlansTab p={p} />}
      {tab === 'sessions' && <SessionsTab p={p} />}
      {tab === 'findings' && <FindingsTab p={p} via={via} />}
      {tab === 'reports' && <ReportsTab p={p} via={via} />}
      {tab === 'evidence' && <EvidenceTab p={p} />}
      {tab === 'audit' && <AuditTab p={p} />}
      {tab === 'close' && <CloseTab p={p} setTab={setTab} />}
    </>
  )
}

type Via = (page: string, opts?: { id?: string; tab?: string }) => void

/* ───────────── PR-03 Overview ───────────── */
function Overview({ p, via, setTab }: { p: Project; via: Via; setTab: (t: string) => void }) {
  const { db, go, can } = useStore()
  const guard = useGuard(p.id)
  const ops = db.operations.filter((o) => o.projectId === p.id)
  const fs = db.findings.filter((f) => f.projectId === p.id)
  const reps = db.reports.filter((r) => r.projectId === p.id)
  const agents = db.agents.filter((a) => a.projectId === p.id)
  const assets = db.assets.filter((a) => a.projectId === p.id)
  const running = ops.filter((o) => o.status === 'running')
  const openF = fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status))
  const audit = db.audit.filter((a) => a.projectId === p.id).slice(0, 5)
  const elig = eligibility(db, p.id)
  const rd = readiness(db, p.id)
  const cp = completion(db, p.id)
  const go2 = (to?: { page: string; id?: string; tab?: string }) => { if (!to) return; if (to.page === 'project') setTab(to.tab || 'overview'); else via(to.page, { id: to.id, tab: to.tab }) }
  const total = Math.max(1, parseDate(p.end).getTime() - parseDate(p.start).getTime())
  const elapsed = Math.max(0, Math.min(total, NOW.getTime() - parseDate(p.start).getTime()))
  const daysLeft = Math.round((parseDate(p.end).getTime() - NOW.getTime()) / 86400000)
  const objAvg = p.objectives.length ? Math.round(p.objectives.reduce((a, o) => a + o.progress, 0) / p.objectives.length) : 0

  const next: { label: string; sub: string; onClick: () => void; disabled?: boolean; title?: string }[] = []
  const live = !['closed', 'cancelled'].includes(p.status)
  if (live) elig.reasons.forEach((r) => next.push({ label: `Resolve: ${r.text}`, sub: 'Blocks Preflight and Run, not drafting', onClick: () => go2(r.to) }))
  if (p.status === 'draft' || p.status === 'rejected') next.push({ label: p.status === 'rejected' ? 'Edit & resubmit' : 'Complete setup & request approval', sub: 'Add scope and an emergency contact, then submit', onClick: () => setTab('scope') })
  if (p.status === 'pending') next.push({ label: 'View approval request', sub: 'Track the reviewer and notes', onClick: () => setTab('team') })
  if (live) {
    const locked = elig.kind === 'locked'
    next.push({ label: locked ? 'Create Operation (save as draft)' : 'Create Operation', sub: locked ? 'A draft can be saved now; Run stays blocked until ROE is approved' : 'Prepare a new operation', onClick: () => via('operation-new'), disabled: guard.ro || !can('run', p.id), title: guard.ro ? guard.reason : 'Your role cannot create operations' })
    next.push({ label: 'Create Plan Draft', sub: 'AI-proposed plans stay Draft until the ROE is approved', onClick: () => via('ai-operator'), disabled: guard.ro, title: guard.ro ? guard.reason : undefined })
    next.push({ label: 'Create Report Draft', sub: 'Drafts can be saved at any time', onClick: () => via('report-new'), disabled: guard.ro || !can('editReport', p.id), title: guard.ro ? guard.reason : 'Your role cannot create reports' })
    next.push({ label: 'Add scope', sub: 'Add assets to scope (may need re-approval)', onClick: () => via('asset-new'), disabled: guard.ro || !can('editScope', p.id), title: guard.ro ? guard.reason : 'Only a Manager or Admin can add scope' })
  }
  if (running[0]) next.push({ label: `Open running operation ${running[0].id}`, sub: running[0].name, onClick: () => go('operation', { id: running[0].id }) })
  if (openF.length) next.push({ label: `Review ${openF.length} findings`, sub: openF.map((f) => f.id).join(', '), onClick: () => setTab('findings') })
  next.push({ label: 'Manage assets', sub: `${assets.length} project assets`, onClick: () => via('assets') })
  if (p.status === 'closed') next.push({ label: 'Back to Command Center', sub: 'Return to the workspace overview', onClick: () => go('command-center') })

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Running Operations" value={running.length} sub={`${ops.length} total`} onClick={() => setTab('operations')} tone={running.length ? 'ok' : undefined} />
          <Kpi label="Agents" value={agents.length} sub={`${agents.filter((a) => a.status === 'online').length} online, ${agents.filter((a) => a.status === 'lost').length} lost`} onClick={() => via('agents')} tone={agents.some((a) => a.status === 'lost') ? 'warn' : undefined} />
          <Kpi label="Open Findings" value={openF.length} sub={`${fs.length} total`} onClick={() => setTab('findings')} tone={openF.length ? 'warn' : undefined} />
          <Kpi label="Reports" value={reps.length} sub={reps.length ? `${reps.filter((r) => r.status === 'delivered').length} delivered` : 'No reports yet'} onClick={() => setTab('reports')} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Execution Readiness" sub={`${rd.done}/${rd.total} ready. Can reach 100% before anything runs.`} />
            <div className="mb-3"><Progress value={rd.pct} tone={rd.pct === 100 ? 'ok' : 'accent'} label="Execution readiness" /></div>
            <ul className="divide-y divide-line/60">
              {rd.items.map((i) => (
                <li key={i.id}>
                  <button onClick={() => go2(i.to)} className="flex min-h-11 w-full items-center gap-3 py-1.5 text-left transition hover:bg-hover/60">
                    {i.ok ? <CheckCircle2 size={16} className="shrink-0 text-ok" aria-label="Met" /> : <CircleDashed size={16} className="shrink-0 text-warn" aria-label="Not met" />}
                    <span className="min-w-0 flex-1"><span className="block text-sm">{i.label}</span><span className="block truncate text-xs text-muted">{i.detail}</span></span>
                    <ArrowRight size={14} className="shrink-0 text-neutral" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Project Completion" sub="Grows with results, report delivery and closeout. Independent of readiness." />
            <div className="mb-3"><Progress value={cp.pct} tone={cp.pct >= 100 ? 'ok' : 'cyan'} label="Project completion" /></div>
            <ul className="divide-y divide-line/60 text-sm">
              <li><button onClick={() => setTab('objectives')} className="flex min-h-11 w-full items-center justify-between py-1.5 text-left hover:bg-hover/60"><span>Objectives</span><span className="text-muted">{p.objectives.length ? `${cp.objPct}% average` : 'No data yet'}</span></button></li>
              <li><button onClick={() => setTab('operations')} className="flex min-h-11 w-full items-center justify-between py-1.5 text-left hover:bg-hover/60"><span>Operations completed</span><span className="text-muted">{cp.ops ? `${cp.opsDone}/${cp.ops}` : 'None yet'}</span></button></li>
              <li><button onClick={() => setTab('findings')} className="flex min-h-11 w-full items-center justify-between py-1.5 text-left hover:bg-hover/60"><span>Findings</span><span className="text-muted">{cp.confirmed} confirmed · {cp.inReview} in review{cp.suggested ? ` · ${cp.suggested} AI-suggested (unverified)` : ''}</span></button></li>
              <li><button onClick={() => setTab('reports')} className="flex min-h-11 w-full items-center justify-between py-1.5 text-left hover:bg-hover/60"><span>Report</span><span className="text-muted">{cp.repLabel}</span></button></li>
              <li><button onClick={() => setTab('close')} className="flex min-h-11 w-full items-center justify-between py-1.5 text-left hover:bg-hover/60"><span>Closeout checklist</span><span className="text-muted">{cp.closeDone}/{cp.closeTotal}</span></button></li>
            </ul>
          </Card>
        </div>

        <Card>
          <CardHeader title="Execution Eligibility" sub={elig.label} actions={<Status kind="generic" value={elig.tone === 'cyan' ? 'ok' : elig.tone} size="sm" label={elig.kind === 'locked' ? 'Locked' : elig.kind === 'closed' ? 'Read-only' : 'Not blocked'} />} />
          {elig.reasons.length === 0 ? <p className="text-sm text-muted">{elig.kind === 'closed' ? 'This project is closed. Nothing can run.' : 'No blocking reasons. Preflight and policy checks still apply to each operation.'}</p> : (
            <ul className="space-y-1.5 text-sm">
              {elig.reasons.map((r) => (
                <li key={r.text} className="flex items-center gap-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" /><span className="flex-1">{r.text}</span>{r.to && <button className="text-xs text-accent underline" onClick={() => go2(r.to)}>Resolve</button>}</li>
              ))}
            </ul>
          )}
          {elig.kind === 'locked' && <p className="mt-3 text-xs text-muted">Drafts of operations, plans and reports can still be saved. Only Preflight, Run and Submit are gated.</p>}
        </Card>

        <Card>
          <CardHeader title="Objectives" sub={p.objectives.length ? `Average progress ${objAvg}%` : undefined} actions={<Button size="sm" variant="ghost" onClick={() => setTab('objectives')}>Details</Button>} />
          {p.objectives.length === 0 ? <p className="text-sm text-muted">No objectives yet.</p> : (
            <ul className="space-y-4">
              {p.objectives.map((o) => (
                <li key={o.id}>
                  <div className="mb-1 flex items-start justify-between gap-3 text-sm"><span>{o.text}</span><span className="shrink-0 text-xs text-muted">{o.owner}</span></div>
                  {o.progress === 0 && p.status !== 'active' ? <div className="text-xs text-muted">No measurement data yet</div> : <Progress value={o.progress} label={o.text} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent Operations" actions={<Button size="sm" variant="ghost" onClick={() => setTab('operations')}>All</Button>} />
          {ops.length === 0 ? <p className="text-sm text-muted">No operations yet. Use “Create Operation” to start.</p> : (
            <ul className="divide-y divide-line/60">
              {ops.slice(0, 4).map((o) => (
                <li key={o.id} className="flex min-h-12 items-center gap-3 py-2">
                  <IdLink onClick={() => go('operation', { id: o.id })}>{o.id}</IdLink>
                  <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
                  <Status kind="op" value={o.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Schedule" />
          <div className="mb-2 flex justify-between text-sm"><span>{p.start}</span><span>{p.end}</span></div>
          <Progress value={Math.round((elapsed / total) * 100)} tone={daysLeft < 0 && p.status !== 'closed' ? 'bad' : 'cyan'} label="Schedule progress" />
          <div className="mt-2 text-xs text-muted">
            {p.status === 'closed' ? `Closed on ${p.closedAt}` : daysLeft < 0 ? `Overdue by ${-daysLeft} days` : parseDate(p.start) > NOW ? `Starts in ${Math.round((parseDate(p.start).getTime() - NOW.getTime()) / 86400000)} days` : `${daysLeft} days left, due ${p.end}`} · {p.tz}
          </div>
        </Card>

        <Card>
          <CardHeader title="Suggested Actions" />
          <ul className="space-y-2">
            {next.map((n) => (
              <li key={n.label}>
                <button disabled={n.disabled} title={n.disabled ? n.title : undefined} onClick={n.onClick} className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{n.label}</span><span className="block truncate text-xs text-muted">{n.disabled && n.title ? n.title : n.sub}</span></span>
                  {n.disabled ? <Lock size={14} className="text-muted" /> : <ArrowRight size={14} className="text-neutral" />}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Latest Activity" actions={<Button size="sm" variant="ghost" onClick={() => setTab('activity')}>View all</Button>} />
          {audit.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : <Timeline items={audit.map((a) => ({ at: a.at, title: `${a.action} — ${a.obj}`, sub: `${a.actor}${a.reason ? ' · ' + a.reason : ''}`, tone: a.result === 'Success' ? 'ok' : 'warn' }))} />}
        </Card>
      </div>
    </div>
  )
}

/* ───────────── PR-06 Objectives ───────────── */
function Objectives({ p }: { p: Project }) {
  const { db, go } = useStore()
  const ops = db.operations.filter((o) => o.projectId === p.id)
  type O = Project['objectives'][number]
  const cols: Col<O>[] = [
    { key: 'text', header: 'Objective', render: (o) => <div className="max-w-sm py-2"><div className="font-medium">{o.text}</div></div> },
    { key: 'crit', header: 'Success Criteria', render: (o) => <span className="text-muted">{o.criteria || '—'}</span>, hideBelow: 'md' },
    { key: 'owner', header: 'Owner', render: (o) => <Person name={o.owner} /> },
    { key: 'prog', header: 'Progress', width: '160px', render: (o) => (o.progress === 0 ? <span className="text-xs text-muted">No data yet</span> : <Progress value={o.progress} label={o.text} />) },
    {
      key: 'ops', header: 'Related Operations', render: (o) => {
        const l = ops.filter((x) => x.owner === o.owner)
        return l.length ? <span className="flex flex-wrap gap-2">{l.map((x) => <IdLink key={x.id} onClick={() => go('operation', { id: x.id })}>{x.id}</IdLink>)}</span> : <span className="text-xs text-muted">Not linked</span>
      },
    },
    { key: 'res', header: 'Validation', render: (o) => <Status kind="generic" value={o.progress >= 100 ? 'ok' : o.progress > 0 ? 'warn' : 'neutral'} size="sm" label={o.progress >= 100 ? 'Criteria met' : o.progress > 0 ? 'Partially validated' : 'No data yet'} /> },
  ]
  return (
    <>
      <p className="mb-3 text-sm text-muted">Objectives are validated against the operations run by each owner. Projects with no operations show “No data yet” instead of 0%.</p>
      <Table cols={cols} rows={p.objectives} rowKey={(o) => o.id} empty={<Empty title="No objectives">This project has no specific objectives. Add them in the creation wizard or through a change request.</Empty>} />
    </>
  )
}

/* ───────────── PR-08 Activity ───────────── */
const CATS: Record<string, { label: string; re: RegExp }> = {
  scope: { label: 'Scope / assets', re: /scope|asset/i },
  approval: { label: 'Approvals', re: /approv|return|submitted|decid/i },
  op: { label: 'Operations / agents', re: /operation|preflight|agent|stop|session/i },
  finding: { label: 'Findings', re: /finding/i },
  report: { label: 'Reports', re: /report/i },
  close: { label: 'Closure / reopen', re: /clos|reopen/i },
}
function Activity({ p }: { p: Project }) {
  const { db } = useStore()
  const [cat, setCat] = useState('')
  const list = db.audit.filter((a) => a.projectId === p.id && (!cat || CATS[cat].re.test(a.action)))
  return (
    <>
      <FilterBar>
        <Select aria-label="Filter by type" className="w-56" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All activity types</option>
          {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <span className="text-xs text-muted">{list.length} events</span>
      </FilterBar>
      <Card>
        {list.length === 0 ? <Empty title="No activity yet">{cat ? 'No events of the selected type.' : 'Scope changes, approvals, operations, findings and reports will appear here.'}</Empty> : (
          <Timeline items={list.map((a) => ({ at: a.at, title: <span><b className="font-medium">{a.action}</b> — <span className="font-mono text-[13px]">{a.obj}</span></span>, sub: `${a.actor} (${a.role})${a.reason ? ' · Reason: ' + a.reason : ''}${a.result !== 'Success' ? ' · ' + a.result : ''}`, tone: a.result === 'Success' || a.result === 'Pass' || a.result === 'Resolved' ? 'ok' : a.result === 'Denied' || a.result === 'Failed' ? 'bad' : 'warn' }))} />
        )}
      </Card>
    </>
  )
}

/* ───────────── Context shortcuts ───────────── */
function OpsTab({ p, via, setTab }: { p: Project; via: Via; setTab: (t: string) => void }) {
  const { db, go, can } = useStore()
  const guard = useGuard(p.id)
  const ops = db.operations.filter((o) => o.projectId === p.id)
  const pg = usePaged(ops, 8)
  const canOp = !guard.ro && can('run', p.id)
  const elig = eligibility(db, p.id)
  type O = (typeof ops)[number]
  const cols: Col<O>[] = [
    { key: 'id', header: 'ID', render: (o) => <IdLink onClick={() => go('operation', { id: o.id })}>{o.id}</IdLink> },
    { key: 'name', header: 'Operation', render: (o) => <span className="font-medium">{o.name}</span> },
    { key: 'st', header: 'Status', render: (o) => <Status kind="op" value={o.status} /> },
    { key: 'owner', header: 'Performed by', render: (o) => <Person name={o.owner} />, hideBelow: 'md' },
    { key: 'at', header: 'Started', render: (o) => <span className="font-mono text-xs text-muted">{o.startedAt}</span>, hideBelow: 'md' },
    {
      key: 'res', header: 'Result', render: (o) => {
        if (!o.steps.length) return <span className="text-xs text-muted">No data yet</span>
        const ok = o.steps.filter((s) => s.status === 'ok').length
        return <span className="text-sm tabular-nums">{ok}/{o.steps.length} steps succeeded</span>
      },
    },
    {
      key: 'pf', header: '', render: (o) => {
        if (!['draft', 'ready'].includes(o.status)) return null
        const blockedWhy = elig.kind === 'locked' ? `Run blocked: ${elig.reasons.map((r) => r.text).join('; ')}` : guard.ro ? guard.reason : !can('run', p.id) ? 'Your role cannot run operations' : ''
        return (
          <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => go('operation', { id: o.id })}>Open draft</Button>
            <Button size="sm" variant="primary" disabled={!!blockedWhy} title={blockedWhy || 'Open preflight for this operation'} onClick={() => go('preflight', { id: o.id })}>Run</Button>
          </span>
        )
      },
    },
  ]
  return (
    <>
      <FilterBar right={<><Button size="sm" onClick={() => via('operations')}>Open in Operations</Button><Button variant="primary" icon={Plus} disabled={!canOp} title={canOp ? 'Saves a draft; Run is gated separately' : guard.ro ? guard.reason : 'Your role cannot create operations'} onClick={() => via('operation-new')}>Create Operation</Button></>}>
        <span className="text-sm text-muted">{ops.length} operations in {p.id}</span>
      </FilterBar>
      {elig.kind === 'locked' && (
        <Banner tone="warn" title="Run is blocked for this project. Drafts can still be saved." action={<Button size="sm" onClick={() => setTab('scope')}>Open Scope & ROE</Button>}>
          <ul className="list-disc pl-4">{elig.reasons.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
          <span className="mt-1 block text-xs">Create Operation, Create Plan Draft and Create Report Draft stay available.</span>
        </Banner>
      )}
      {!canOp && <div className="mb-3"><span className="inline-flex items-center gap-1.5 text-xs text-muted"><Lock size={13} />{guard.ro ? guard.reason : 'Your role cannot create operations.'}</span></div>}
      <Table cols={cols} rows={pg.rows} rowKey={(o) => o.id} onRow={(o) => go('operation', { id: o.id })} empty={<Empty title="No operations in this project">Create a draft operation now; Run unlocks once the ROE is approved.</Empty>} />
      <Pager {...pg} />
    </>
  )
}

function FindingsTab({ p, via }: { p: Project; via: Via }) {
  const { db, go, can } = useStore()
  const guard = useGuard(p.id)
  const fs = db.findings.filter((f) => f.projectId === p.id)
  const pg = usePaged(fs, 8)
  const ok = !guard.ro && can('createFinding', p.id)
  type F = (typeof fs)[number]
  const cols: Col<F>[] = [
    { key: 'id', header: 'ID', render: (f) => <IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink> },
    { key: 'title', header: 'Title', render: (f) => <span className="font-medium">{f.title}</span> },
    { key: 'sev', header: 'Severity', render: (f) => <Sev v={f.severity} /> },
    { key: 'st', header: 'Status', render: (f) => <Status kind="finding" value={f.status} /> },
    { key: 'asset', header: 'Asset', render: (f) => <span className="font-mono text-xs">{f.asset}</span>, hideBelow: 'md' },
    { key: 'owner', header: 'Owner', render: (f) => f.owner, hideBelow: 'lg' },
    { key: 'up', header: 'Updated', render: (f) => <span className="font-mono text-xs text-muted">{f.updated}</span>, hideBelow: 'lg' },
  ]
  return (
    <>
      <FilterBar right={<><Button size="sm" onClick={() => via('findings')}>Open in Findings</Button><Button variant="primary" icon={Plus} disabled={!ok} title={ok ? undefined : guard.ro ? guard.reason : 'Your role cannot create findings'} onClick={() => via('finding-new')}>Create Finding</Button></>}>
        <span className="text-sm text-muted">{fs.length} findings in {p.id}</span>
      </FilterBar>
      <Table cols={cols} rows={pg.rows} rowKey={(f) => f.id} onRow={(f) => go('finding', { id: f.id })} empty={<Empty title="No findings yet">Findings are created from operation results or entered manually.</Empty>} />
      <Pager {...pg} />
    </>
  )
}

function ReportsTab({ p, via }: { p: Project; via: Via }) {
  const { db, go, can } = useStore()
  const guard = useGuard(p.id)
  const reps = db.reports.filter((r) => r.projectId === p.id)
  const ok = !guard.ro && can('editReport', p.id)
  type R = (typeof reps)[number]
  const cols: Col<R>[] = [
    { key: 'id', header: 'ID', render: (r) => <IdLink onClick={() => go('report', { id: r.id })}>{r.id}</IdLink> },
    { key: 'title', header: 'Title', render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'ver', header: 'Version', render: (r) => <span className="font-mono text-xs">{r.version}</span> },
    { key: 'st', header: 'Status', render: (r) => <Status kind="report" value={r.status} /> },
    { key: 'au', header: 'Author', render: (r) => r.author, hideBelow: 'md' },
    { key: 'rv', header: 'Reviewer', render: (r) => r.reviewer, hideBelow: 'md' },
    { key: 'up', header: 'Updated', render: (r) => <span className="font-mono text-xs text-muted">{r.updated}</span>, hideBelow: 'lg' },
  ]
  return (
    <>
      <FilterBar right={<><Button size="sm" onClick={() => via('reports')}>Open in Reports</Button><Button variant="primary" icon={Plus} disabled={!ok} title={ok ? 'Drafts can be saved at any time' : guard.ro ? guard.reason : 'Your role cannot create reports'} onClick={() => via('report-new')}>Create Report Draft</Button></>}>
        <span className="text-sm text-muted">{reps.length} reports in {p.id}</span>
      </FilterBar>
      <Table cols={cols} rows={reps} rowKey={(r) => r.id} onRow={(r) => go('report', { id: r.id })} empty={<Empty title="No reports yet">Create a report from a template once findings are confirmed.</Empty>} />
    </>
  )
}

function EvidenceTab({ p }: { p: Project }) {
  const { db, go, can } = useStore()
  const evs = db.evidence.filter((e) => e.projectId === p.id)
  const sens = can('viewSensitive', p.id)
  type E = (typeof evs)[number]
  const cols: Col<E>[] = [
    { key: 'id', header: 'ID', render: (e) => <span className="font-mono text-[13px]">{e.id}</span> },
    { key: 'name', header: 'File name', render: (e) => (e.sensitive && !sens ? <span className="inline-flex items-center gap-1.5 text-muted"><Lock size={13} />Redacted (sensitive)</span> : <span className="font-mono text-[13px]">{e.name}</span>) },
    { key: 'kind', header: 'Type', render: (e) => (e.sensitive && !sens ? '••••' : e.kind), hideBelow: 'md' },
    { key: 'src', header: 'Source', render: (e) => (e.opId ? <IdLink onClick={() => go('operation', { id: e.opId! })}>{e.source}</IdLink> : e.source), hideBelow: 'md' },
    { key: 'fin', header: 'Finding', render: (e) => (e.findingId ? <IdLink onClick={() => go('finding', { id: e.findingId!, tab: 'evidence' })}>{e.findingId}</IdLink> : <span className="text-xs text-muted">Not linked</span>) },
    { key: 'sen', header: 'Sensitivity', render: (e) => <Status kind="generic" value={e.sensitive ? 'warn' : 'neutral'} size="sm" label={e.sensitive ? 'Sensitive' : 'Standard'} /> },
    { key: 'at', header: 'Time', render: (e) => <span className="font-mono text-xs text-muted">{e.at} · {e.by}</span>, hideBelow: 'lg' },
  ]
  return (
    <>
      {!sens && <Banner tone="info" icon={Lock} title="Sensitive content is redacted">The {ROLE_LABEL[useStore().me.role]} role cannot view sensitive evidence; only metadata is shown.</Banner>}
      <Table cols={cols} rows={evs} rowKey={(e) => e.id} empty={<Empty title="No evidence yet">Evidence is attached from operation steps or when creating a finding.</Empty>} />
    </>
  )
}

function AuditTab({ p }: { p: Project }) {
  const { db, me } = useStore()
  const list = db.audit.filter((a) => a.projectId === p.id)
  const pg = usePaged(list, 10)
  type A = (typeof list)[number]
  if (me.role === 'viewer') return <Empty icon={Lock} title="Audit log is internal only">Client / Viewer roles cannot view the project audit log.</Empty>
  const cols: Col<A>[] = [
    { key: 'at', header: 'Time', render: (a) => <span className="font-mono text-xs">{a.at}</span> },
    { key: 'actor', header: 'Performed by', render: (a) => <Person name={a.actor} /> },
    { key: 'role', header: 'Role', render: (a) => <span className="text-muted">{a.role}</span>, hideBelow: 'lg' },
    { key: 'act', header: 'Action', render: (a) => <span className="font-medium">{a.action}</span> },
    { key: 'obj', header: 'Object', render: (a) => <span className="font-mono text-xs">{a.obj}</span> },
    { key: 'res', header: 'Result', render: (a) => <Status kind="generic" value={a.result === 'Success' || a.result === 'Pass' || a.result === 'Resolved' ? 'ok' : a.result === 'Denied' || a.result === 'Failed' ? 'bad' : 'warn'} size="sm" label={a.result} /> },
    { key: 'reason', header: 'Reason', render: (a) => <span className="text-muted">{a.reason || '—'}</span>, hideBelow: 'md' },
  ]
  return (
    <>
      <p className="mb-3 text-sm text-muted">Immutable log for {p.id}: who, when, what and why. Export is controlled and available in Settings.</p>
      <Table cols={cols} rows={pg.rows} rowKey={(a) => a.id + a.at} empty={<Empty title="No audit records" />} />
      <Pager {...pg} />
    </>
  )
}

/* ───────────── AI Plans and C2 Sessions (read-only) ───────────── */
function PlansTab({ p }: { p: Project }) {
  const { db, go } = useStore()
  const guard = useGuard(p.id)
  const plans = db.plans.filter((x) => x.projectId === p.id)
  const pg = usePaged(plans, 8)
  type P = (typeof plans)[number]
  const cols: Col<P>[] = [
    { key: 'id', header: 'Plan', render: (x) => <IdLink onClick={() => go('ai-plan-review', { id: x.id })}>{x.id}</IdLink> },
    { key: 'title', header: 'Title', render: (x) => <span className="font-medium">{x.title}</span> },
    { key: 'ver', header: 'Version', render: (x) => <span className="font-mono text-xs">{planVer(x)}</span>, hideBelow: 'md' },
    { key: 'st', header: 'Status', render: (x) => <span className="inline-flex flex-wrap items-center gap-1.5"><Status kind="plan" value={x.status} />{x.status === 'expired' && x.risks.some((r) => r.startsWith('Re-validation')) && <span className="text-xs text-warn">Re-validation required</span>}</span> },
    { key: 'steps', header: 'Steps', render: (x) => <span className="tabular-nums">{x.steps.length}</span>, hideBelow: 'md' },
    { key: 'rv', header: 'Reviewer', render: (x) => x.reviewer, hideBelow: 'lg' },
    { key: 'up', header: 'Updated', render: (x) => <span className="font-mono text-xs text-muted">{x.updated}</span>, hideBelow: 'lg' },
  ]
  return (
    <>
      <FilterBar right={<Button variant="primary" icon={Plus} disabled={guard.ro} title={guard.ro ? guard.reason : 'Drafts can be saved even before the ROE is approved'} onClick={() => go('ai-operator')}>Create Plan Draft</Button>}>
        <span className="text-sm text-muted">AI-proposed plans for {p.id}. Open a plan to review or compare it.</span>
      </FilterBar>
      <Table cols={cols} rows={pg.rows} rowKey={(x) => x.id} onRow={(x) => go('ai-plan-review', { id: x.id })} empty={<Empty title="No AI plans for this project">Plans appear here after the AI Operator proposes one for {p.id}.</Empty>} />
      <Pager {...pg} />
    </>
  )
}

function SessionsTab({ p }: { p: Project }) {
  const { db, go } = useStore()
  const list = db.sessions.filter((x) => x.projectId === p.id)
  const pg = usePaged(list, 8)
  type S = (typeof list)[number]
  const cols: Col<S>[] = [
    { key: 'id', header: 'Session', render: (x) => <IdLink onClick={() => go('c2-session', { id: x.id })}>{x.id}</IdLink> },
    { key: 'asset', header: 'Asset', render: (x) => <span className="font-mono text-xs">{x.asset}</span> },
    { key: 'kind', header: 'Type', render: (x) => <span className="text-muted">{x.kind === 'reverse' ? 'Reverse shell (simulated)' : 'Web shell (simulated)'}</span>, hideBelow: 'md' },
    { key: 'st', header: 'State', render: (x) => <Status kind="session" value={x.state} /> },
    { key: 'op', header: 'Operation', render: (x) => <IdLink onClick={() => go('operation', { id: x.opId })}>{x.opId}</IdLink>, hideBelow: 'md' },
    { key: 'last', header: 'Last activity', render: (x) => <span className="font-mono text-xs text-muted">{x.last}</span>, hideBelow: 'lg' },
  ]
  return (
    <>
      <p className="mb-3 text-sm text-muted">Sessions for {p.id} only. Read-only list; open a session in C2 & Sessions to request access. Demo data.</p>
      <Table cols={cols} rows={pg.rows} rowKey={(x) => x.id} onRow={(x) => go('c2-session', { id: x.id })} empty={<Empty title="No C2 sessions for this project">Sessions appear after an approved operation connects.</Empty>} />
      <Pager {...pg} />
    </>
  )
}
