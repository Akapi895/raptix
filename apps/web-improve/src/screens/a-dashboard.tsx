import { useMemo, useState, type ReactNode } from 'react'
import { Activity, AlertTriangle, ArrowRight, Bug, CheckCircle2, ClipboardCheck, FileBarChart, FolderKanban, Inbox, KeyRound, Plus, Radar, Server, ShieldAlert, ShieldCheck, Sparkles, Terminal, WifiOff, Workflow } from 'lucide-react'
import { useStore, sevLabel, readiness, completion, eligibility, hhmm } from '../store'
import { APR } from '../data'
import type { Plan, Report, SessionRequest, Approval, Severity } from '../data'
import { AiModeBadge, Banner, Button, Card, CardHeader, DemoTag, Donut, Empty, Gated, IdLink, Kpi, Legend, Mono, PageHeader, Progress, Segmented, Status, Timeline, cx } from '../ui'

const SEV_COLOR: Record<Severity, string> = { critical: 'var(--c-bad)', high: '#F2894F', medium: 'var(--c-warn)', low: 'var(--c-cyan)', info: 'var(--c-neutral)' }
const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const SELECT_PROJECT = 'Select a project to continue'

/* ───────── Shared derived data ───────── */
function useCC() {
  const s = useStore()
  const { db, scoped } = s
  return useMemo(() => {
    const projects = s.accessible.filter((p) => s.pid === 'all' || p.id === s.pid)
    const ops = scoped(db.operations)
    const agents = scoped(db.agents)
    const sessions = scoped(db.sessions)
    const findings = scoped(db.findings)
    const reports = scoped(db.reports)
    const plans = scoped(db.plans)
    const requests = scoped(db.sessionRequests)
    const approvals = scoped(db.approvals)
    return {
      projects, ops, agents, sessions, findings, reports, plans, requests, approvals, audit: scoped(db.audit), c2: db.c2Nodes.filter((n) => s.pid === 'all' || n.projectIds.includes(s.pid)),
      pendingApprovals: approvals.filter((a) => a.status === 'pending'),
      pendingPlans: plans.filter((p) => p.status === 'in_review' || p.status === 'proposed'),
      pendingRequests: requests.filter((r) => r.status === 'pending'),
      reviewReports: reports.filter((r) => r.status === 'review'),
      reviewFindings: findings.filter((f) => f.status === 'review'),
    }
  }, [db, s.pid, s.accessible, scoped]) // eslint-disable-line react-hooks/exhaustive-deps
}

const opProgress = (steps: { status: string }[]) => (steps.length ? Math.round((steps.filter((x) => x.status === 'ok' || x.status === 'fail').length / steps.length) * 100) : 0)

/* ───────── Command Center ───────── */
interface Attn { id: string; icon: typeof Server; tone: 'bad' | 'warn' | 'cyan'; title: string; sub: string; project: string; at?: string; cta: string; to: () => void; kind: string }

export function Dashboard() {
  const s = useStore()
  const { db, go, project, can, me } = s
  const d = useCC()
  const all = s.pid === 'all'
  const gate = { allowed: !all && can('run'), reason: all ? SELECT_PROJECT : 'Your role cannot start operations. Ask a Red Team Manager or Operator.' }

  const running = d.ops.filter((o) => o.status === 'running')
  const offline = d.agents.filter((a) => a.status === 'lost' || a.status === 'unhealthy')
  const healthy = d.agents.filter((a) => a.status === 'online' || a.status === 'idle')
  const live = d.sessions.filter((x) => x.state === 'connected')
  const openFindings = d.findings.filter((f) => ['review', 'confirmed', 'remediation', 'retest', 'returned'].includes(f.status))
  const aiSuggested = d.findings.filter((f) => f.status === 'ai_suggested').length
  const activeProjects = d.projects.filter((p) => ['active', 'approved', 'review', 'paused'].includes(p.status)).length
  const reviewPlans = d.plans.filter((p) => p.status === 'in_review')
  const roeIssues = d.projects.filter((p) => ['active', 'approved', 'pending'].includes(p.status) && p.roeStatus !== 'approved')

  const attention: Attn[] = [
    ...offline.map((a): Attn => ({ id: 'ag' + a.id, kind: 'Agent offline', icon: WifiOff, tone: 'bad', title: `Agent ${a.host} is ${a.status === 'lost' ? 'offline' : 'unhealthy'}`, sub: a.op ? `Assigned to ${a.op}. Last seen ${a.lastSeen}.` : `Last seen ${a.lastSeen}.`, project: a.projectId, at: a.lastSeen, cta: 'Open agent', to: () => go('agent', { id: a.id }) })),
    ...reviewPlans.map((p): Attn => ({ id: 'pl' + p.id, kind: 'Plan awaiting approval', icon: Sparkles, tone: 'warn', title: `Plan ${p.id} awaiting approval`, sub: `${p.title} · requested by ${p.requestedBy}`, project: p.projectId, at: p.updated, cta: can('approvePlan', p.projectId) ? 'Review plan' : 'View plan', to: () => go('ai-plan-review', { id: p.id }) })),
    ...d.pendingRequests.map((r): Attn => ({ id: 'sr' + r.id, kind: 'Session access request', icon: KeyRound, tone: 'warn', title: `${r.by} requests ${r.mode} access to ${r.sessionId}`, sub: `${r.duration} · ${r.reason}`, project: r.projectId, at: r.at, cta: can('approveAccess', r.projectId) ? 'Review request' : 'View request', to: () => go('c2-session', { id: r.sessionId }) })),
    ...roeIssues.map((p): Attn => ({ id: 'roe' + p.id, kind: 'ROE issue', icon: ShieldAlert, tone: 'bad', title: `${p.id} has no approved ROE (${p.roeStatus === 'none' ? 'not created' : p.roeStatus})`, sub: 'Operations cannot pass preflight until the ROE is approved.', project: p.id, at: p.updated, cta: 'Open project', to: () => go('project', { id: p.id }) })),
    ...d.c2.filter((n) => n.status === 'offline' || n.status === 'degraded').map((n): Attn => ({ id: 'c2' + n.id, kind: 'C2 node', icon: Server, tone: n.status === 'offline' ? 'bad' : 'warn', title: `C2 node ${n.name} is ${n.status}`, sub: `${n.kind} · ${n.region} · last seen ${n.last}`, project: '', at: n.last, cta: 'Open C2', to: () => go('c2') })),
  ]
  const rank = { bad: 0, warn: 1, cyan: 2 }
  attention.sort((a, b) => rank[a.tone] - rank[b.tone])

  const sevData = SEVS.map((k) => ({ label: sevLabel[k], value: openFindings.filter((f) => f.severity === k).length, color: SEV_COLOR[k] }))

  return (
    <div>
      <PageHeader
        title="Command Center"
        sub={all ? `All projects · ${d.projects.length} accessible · signed in as ${me.name}` : `${project?.name} · ${project?.client}`}
        meta={all ? <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-muted">Aggregate view</span> : <Mono className="text-muted">{project?.id}</Mono>}
        actions={<>
          <Gated allowed={can('createProject')} reason="Only Red Team Managers and Organization Admins can create projects."><Button variant="primary" icon={FolderKanban} onClick={() => go('project-new')}>Create Project</Button></Gated>
          <Gated {...gate}><Button icon={Plus} onClick={() => go('operation-new')}>New Operation</Button></Gated>
          <Gated allowed={!all && can('plan')} reason={all ? SELECT_PROJECT : 'Your role cannot create AI plans.'}><Button icon={Sparkles} onClick={() => go('ai-operator')}>Ask AI Operator</Button></Gated>
        </>}
      />

      {all && <Banner tone="info" title="Showing aggregated data across accessible projects">Read-only view. Select a project in the top bar to start operations or open sessions.</Banner>}

      {/* KPI strip */}
      <section aria-label="Key metrics" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active Projects" icon={FolderKanban} value={activeProjects} sub={`${d.projects.length} accessible`} onClick={() => go('projects')} />
        <Kpi label="Running Operations" icon={Activity} tone="cyan" value={running.length} sub={`${d.ops.length} total`} onClick={() => go('operations')} />
        <Kpi label="Plans Awaiting Approval" icon={ClipboardCheck} tone={reviewPlans.length ? 'warn' : undefined} value={reviewPlans.length} sub={`${d.pendingApprovals.length + d.pendingRequests.length} other approvals`} onClick={() => go('tasks')} />
        <Kpi label="Agents Connected" icon={Radar} tone={offline.length ? 'warn' : 'ok'} value={<>{healthy.length}<span className="text-muted"> / {d.agents.length}</span></>} sub={offline.length ? `${offline.length} disconnected` : 'All connected'} onClick={() => go('agents')} />
        <Kpi label="Active Sessions" icon={Terminal} value={live.length} sub={`${d.sessions.length} tracked`} onClick={() => go('c2')} />
        <Kpi label="Open Findings" icon={Bug} value={openFindings.length} sub={aiSuggested ? `${aiSuggested} AI suggestion${aiSuggested === 1 ? '' : 's'} not counted` : `${openFindings.filter((f) => f.severity === 'critical' || f.severity === 'high').length} critical or high`} onClick={() => go('findings')} />
      </section>

      {!all && project && <ProjectPanels pid={project.id} />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Attention queue */}
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHeader title={<span className="flex items-center gap-2">Needs attention<span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{attention.length}</span></span>} sub="Agent outages, approvals, session access and ROE issues, most urgent first." /></div>
            {attention.length === 0 ? (
              <div className="px-5 pb-5"><Empty icon={CheckCircle2} title="Nothing needs attention">No offline agents, pending approvals or ROE issues{all ? '' : ' in this project'}.</Empty></div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {attention.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', a.tone === 'bad' ? 'bg-bad/10 text-bad' : a.tone === 'warn' ? 'bg-warn/10 text-warn' : 'bg-cyan/10 text-cyan')}><a.icon size={17} aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{a.title}<span className="rounded-full border border-line px-2 text-[11px] font-normal text-muted">{a.kind}</span></div>
                      <div className="truncate text-xs text-muted">{a.sub}{a.project && all ? ` · ${a.project}` : ''}</div>
                    </div>
                    <Button size="sm" onClick={a.to}>{a.cta}<ArrowRight size={14} aria-hidden /></Button>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 8 && <div className="border-t border-line px-5 py-3 text-xs text-muted">Showing 8 of {attention.length}. <button className="text-accent hover:underline" onClick={() => go('tasks')}>Open My Tasks</button></div>}
          </Card>

          {/* Active operations */}
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHeader title="Active operations" sub="Operations that are running, paused or waiting on a decision." actions={<Button size="sm" variant="ghost" onClick={() => go('operations')}>All operations</Button>} /></div>
            {(() => {
              const act = d.ops.filter((o) => ['running', 'paused', 'pending', 'ready'].includes(o.status))
              if (!act.length) return <div className="px-5 pb-5"><Empty icon={Workflow} title="No active operations" action={<Gated {...gate}><Button size="sm" variant="primary" onClick={() => go('operation-new')}>New operation</Button></Gated>}>Create an operation once the ROE is approved and preflight passes.</Empty></div>
              return (
                <ul className="divide-y divide-line border-t border-line">
                  {act.map((o) => (
                    <li key={o.id} className="grid grid-cols-1 items-center gap-3 px-5 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('operation', { id: o.id, tab: 'live' })}>{o.id}</IdLink><Status kind="op" value={o.status} size="sm" /></div>
                        <div className="truncate text-sm">{o.name}</div>
                        <div className="text-xs text-muted">{all ? `${o.projectId} · ` : ''}{o.owner} · started {o.startedAt}</div>
                      </div>
                      <div><div className="mb-1 flex justify-between text-xs text-muted"><span>{o.steps.filter((x) => x.status === 'ok').length}/{o.steps.length} steps</span><span className="tabular-nums">{opProgress(o.steps)}%</span></div><Progress value={opProgress(o.steps)} tone={o.status === 'running' ? 'cyan' : 'neutral'} label={`${o.id} progress`} /></div>
                      <Button size="sm" onClick={() => go('operation', { id: o.id, tab: 'live' })}>Open live view</Button>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </Card>
        </div>

        <div className="space-y-6">
          {/* Quick actions */}
          <Card>
            <CardHeader title="Quick actions" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <Gated {...gate}><Button className="w-full justify-start" icon={Workflow} onClick={() => go('operation-new')}>New Operation</Button></Gated>
              <Gated allowed={!all && can('interactive')} reason={all ? SELECT_PROJECT : 'Your role cannot open interactive sessions.'}><Button className="w-full justify-start" icon={Terminal} onClick={() => go('c2')}>Open Session</Button></Gated>
              <Gated allowed={!all && can('createFinding')} reason={all ? SELECT_PROJECT : 'Your role cannot create findings.'}><Button className="w-full justify-start" icon={Bug} onClick={() => go('finding-new')}>New finding</Button></Gated>
              <Gated allowed={!all && can('editReport')} reason={all ? SELECT_PROJECT : 'Your role cannot create reports.'}><Button className="w-full justify-start" icon={FileBarChart} onClick={() => go('report-new')}>New report</Button></Gated>
              <Gated allowed={can('createProject')} reason="Only Red Team Managers and Organization Admins can create projects."><Button className="w-full justify-start" icon={FolderKanban} onClick={() => go('project-new')}>Create Project</Button></Gated>
              <Button className="w-full justify-start" icon={ClipboardCheck} onClick={() => go('tasks')}>Open My Tasks</Button>
            </div>
          </Card>

          {/* Findings by severity */}
          <Card>
            <CardHeader title="Open findings by severity" actions={<DemoTag />} />
            {openFindings.length === 0 ? <Empty icon={ShieldCheck} title="No open findings">Findings appear here once confirmed.</Empty> : (
              <div className="flex flex-wrap items-center gap-5"><Donut data={sevData} size={120} center={<div className="text-center"><div className="text-xl font-semibold">{openFindings.length}</div><div className="text-[11px] text-muted">open</div></div>} /><Legend data={sevData} /></div>
            )}
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader title="Recent activity" sub="From the audit log" actions={<Button size="sm" variant="ghost" onClick={() => go('settings', { tab: 'audit' })}>Audit log</Button>} />
            {d.audit.length === 0 ? <Empty icon={Inbox} title="No recent activity" /> : (
              <Timeline items={d.audit.slice(0, 6).map((a) => ({ at: a.at, title: <span className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-line px-1.5 text-[11px] font-normal text-muted">{/^AI/.test(a.actor) ? 'AI' : a.actor === 'System' ? 'System' : 'Human'}</span>{a.actor} · {a.action}</span>, sub: <><Mono>{a.obj}</Mono>{a.reason ? ` — ${a.reason}` : ''}{a.corr ? <> · <Mono className="whitespace-nowrap text-muted">{a.corr}</Mono></> : null}</>, tone: a.result === 'Success' ? 'ok' : a.result === 'Pending' ? 'warn' : 'neutral' }))} />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}


/* ───────── Project Command Center panels (CC-V3-02) ───────── */
const minsLeft = (expires: string) => {
  const m = expires.match(/(\d{1,2}):(\d{2}) (AM|PM)/)
  if (!m) return null
  const h = (parseInt(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)
  const [nh, nm] = hhmm().split(':').map(Number)
  return h * 60 + parseInt(m[2]) - (nh * 60 + nm)
}
const fmtLeft = (n: number | null) => (n === null ? 'time unknown' : n <= 0 ? 'expired' : n >= 60 ? `expires in ${Math.floor(n / 60)} h ${n % 60} min` : `expires in ${n} min`)
const Pill = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'cyan' }) => (
  <span className={cx('inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium', { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', bad: 'border-bad/30 bg-bad-soft text-bad', neutral: 'border-line bg-subtle text-muted', cyan: 'border-cyan/30 bg-info-soft text-cyan' }[tone])}>{children}</span>
)
const Row = ({ onClick, children }: { onClick?: () => void; children: ReactNode }) => (
  <li className="flex items-start gap-2 py-2 text-sm">{children}{onClick && <button onClick={onClick} className="ml-auto shrink-0 whitespace-nowrap text-xs font-medium text-accent hover:underline">Open</button>}</li>
)

function ProjectPanels({ pid }: { pid: string }) {
  const s = useStore()
  const { db, go, aiMode, can } = s
  const d = useCC()
  const p = db.projects.find((x) => x.id === pid)!
  const rd = readiness(db, pid)
  const cp = completion(db, pid)
  const el = eligibility(db, pid)
  const noData = cp.ops === 0 && d.findings.length === 0 && d.reports.length === 0

  // AI pending decisions
  const plans = d.plans.filter((x) => x.status === 'in_review' || x.status === 'proposed')
  const tools = ((db as any).toolEvents as { id: string; projectId: string; tool: string; target: string; state: string; conversationId: string }[]).filter((t) => t.projectId === pid && t.state === 'awaiting')
  const reviewSteps = d.ops.flatMap((o) => o.steps.filter((x) => x.status === 'review').map((x) => ({ o, x })))
  const suggestions = d.findings.filter((f) => f.status === 'ai_suggested')
  const aiTotal = plans.length + tools.length + reviewSteps.length + suggestions.length

  // sessions
  const sess = d.sessions.filter((x) => ['connected', 'available', 'awaiting', 'suspended'].includes(x.state))
  const pend = d.pendingRequests

  // health
  const c2 = d.c2.filter((n) => n.projectIds.includes(pid))
  const agOn = d.agents.filter((a) => a.status === 'online' || a.status === 'idle')
  const agOff = d.agents.filter((a) => !(a.status === 'online' || a.status === 'idle'))

  // inbox grouped by type
  const groups: { type: string; items: { id: string; text: string; to: () => void }[] }[] = [
    { type: 'Project Approval', items: d.pendingApprovals.filter((a) => a.type === APR.create || a.type === APR.close).map((a) => ({ id: a.id, text: `${a.type} — ${a.by}`, to: () => go('project', { id: pid }) })) },
    { type: 'ROE Change', items: d.pendingApprovals.filter((a) => a.type === APR.scope).map((a) => ({ id: a.id, text: `${a.diff || a.type} — ${a.by}`, to: () => go('project', { id: pid, tab: 'scope' }) })) },
    { type: 'AI Plan Review', items: d.plans.filter((x) => x.status === 'in_review').map((x) => ({ id: x.id, text: `${x.title} ${x.ver ?? 'v' + x.version}`, to: () => go('ai-plan-review', { id: x.id }) })) },
    { type: 'Session Access', items: pend.map((r) => ({ id: r.id, text: `${r.by} requests ${r.mode} access to ${r.sessionId}`, to: () => go('c2-session', { id: r.sessionId }) })) },
    { type: 'Finding Review', items: d.reviewFindings.map((f) => ({ id: f.id, text: f.title, to: () => go('finding', { id: f.id }) })) },
    { type: 'Report Review', items: d.reviewReports.map((r) => ({ id: r.id, text: `${r.title} ${r.version}`, to: () => go('report-review', { id: r.id }) })) },
  ]
  const inboxTotal = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="mb-6 space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Execution Readiness" sub="Can an operation start? Gates before Preflight and Run." actions={<Pill tone={el.tone}>{el.label}</Pill>} />
          <div className="mb-1 flex justify-between text-xs text-muted"><span>{rd.done}/{rd.total} gates passed</span><span className="tnum">{rd.pct}%</span></div>
          <Progress value={rd.pct} tone={rd.pct === 100 ? 'ok' : 'warn'} label="Execution readiness" />
          <ul className="mt-3 divide-y divide-line">
            {rd.items.map((i) => (
              <Row key={i.id} onClick={i.to && !i.ok ? () => go(i.to!.page, { id: i.to!.id, tab: i.to!.tab }) : undefined}>
                {i.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" aria-label="Passed" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-label="Blocked" />}
                <span className="min-w-0"><span className="font-medium">{i.label}</span><span className="block text-xs text-muted">{i.detail}</span></span>
              </Row>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral">Drafts can always be saved. Readiness does not measure how much of the project is finished.</p>
        </Card>

        <Card>
          <CardHeader title="Project Completion" sub="How much of the engagement is delivered." />
          {noData ? (
            <Empty icon={ClipboardCheck} title="No completion data yet" action={<Button size="sm" onClick={() => go('operations')}>Open Operations</Button>}>Completion appears after operations run and findings are reviewed. It is separate from Execution Readiness.</Empty>
          ) : (
            <>
              <div className="mb-1 flex justify-between text-xs text-muted"><span>Overall completion</span><span className="tnum">{cp.pct}%</span></div>
              <Progress value={cp.pct} tone="cyan" label="Project completion" />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted">Objectives</dt><dd className="font-medium tnum">{cp.objPct}%</dd></div>
                <div><dt className="text-xs text-muted">Operations completed</dt><dd className="font-medium tnum">{cp.opsDone}/{cp.ops}</dd></div>
                <div><dt className="text-xs text-muted">Confirmed findings</dt><dd className="font-medium tnum">{cp.confirmed}</dd></div>
                <div><dt className="text-xs text-muted">In review</dt><dd className="font-medium tnum">{cp.inReview}</dd></div>
                <div><dt className="text-xs text-muted">AI suggestions (not verified)</dt><dd className="font-medium tnum">{cp.suggested}</dd></div>
                <div><dt className="text-xs text-muted">Report</dt><dd className="font-medium">{cp.repLabel}</dd></div>
                <div><dt className="text-xs text-muted">Closure checklist</dt><dd className="font-medium tnum">{cp.closeDone}/{cp.closeTotal}</dd></div>
                <div><dt className="text-xs text-muted">Delivered</dt><dd className="font-medium">{cp.delivered ? 'Yes' : 'Not yet'}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-neutral">AI suggestions are not verified findings and do not count toward completion or formal reports.</p>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="AI Pending Decisions" sub={<span className="inline-flex items-center gap-2">AI mode <AiModeBadge mode={(aiMode || 'propose') as 'observe' | 'propose' | 'execution'} /></span>} />
          {aiTotal === 0 ? <Empty icon={Sparkles} title="No pending AI decisions">Ask the AI Operator to propose a plan.</Empty> : (
            <ul className="divide-y divide-line">
              {plans.map((x) => <Row key={x.id} onClick={() => go('ai-plan-review', { id: x.id })}><Sparkles size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span className="min-w-0"><Mono>{x.id}</Mono> {x.ver ?? 'v' + x.version}<span className="block text-xs text-muted">{x.status === 'in_review' ? 'Plan awaiting approval' : 'Proposal not yet submitted for approval'}</span></span></Row>)}
              {tools.map((t) => <Row key={t.id} onClick={() => go('ai-operator', { id: t.conversationId })}><ShieldCheck size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span className="min-w-0"><Mono>{t.tool}</Mono><span className="block text-xs text-muted">Tool call on {t.target} needs approval</span></span></Row>)}
              {reviewSteps.map(({ o, x }) => <Row key={o.id + x.id} onClick={() => go('operation', { id: o.id, tab: 'live' })}><Workflow size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span className="min-w-0"><Mono>{o.id}/{x.id}</Mono><span className="block text-xs text-muted">Step paused for review: {x.name}</span></span></Row>)}
              {suggestions.map((f) => <Row key={f.id} onClick={() => go('finding', { id: f.id })}><Bug size={15} className="mt-0.5 shrink-0 text-cyan" aria-hidden /><span className="min-w-0"><Mono>{f.id}</Mono><span className="block text-xs text-muted">AI suggestion, not verified: {f.title}</span></span></Row>)}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Active Session Access" sub="Session connection and access grants are separate." />
          {sess.length === 0 && pend.length === 0 ? <Empty icon={KeyRound} title="No active sessions">Sessions appear when an agent connects during an operation.</Empty> : (
            <ul className="divide-y divide-line">
              {sess.map((x) => (
                <Row key={x.id} onClick={() => go('c2-session', { id: x.id })}>
                  <Terminal size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0"><Mono>{x.id}</Mono> <span className="text-xs text-muted">{x.asset}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1"><Pill tone={x.state === 'connected' ? 'ok' : 'neutral'}>Session: {x.state}</Pill></span>
                    {x.grants.map((g) => { const n = minsLeft(g.expires); return <span key={g.user} className="mt-1 block text-xs text-muted">Grant: {g.user}, {g.perm} · <span className={n !== null && n <= 15 ? 'font-medium text-warn' : ''}>{fmtLeft(n)}</span></span> })}
                    {x.grants.length === 0 && <span className="mt-1 block text-xs text-muted">No access grants</span>}
                  </span>
                </Row>
              ))}
              {pend.map((r) => (
                <Row key={r.id} onClick={() => go('c2-session', { id: r.sessionId })}>
                  <KeyRound size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <span className="min-w-0"><Mono>{r.id}</Mono> <Pill tone="warn">Pending</Pill><span className="block text-xs text-muted">{r.by} requests {r.mode} access to {r.sessionId}, {r.duration}</span></span>
                </Row>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="System Health" sub="C2 infrastructure and project agents." actions={<Button size="sm" variant="ghost" onClick={() => go('c2')}>C2 overview</Button>} />
          <div className="mb-3 flex flex-wrap gap-2">
            <Pill tone="ok">{c2.filter((n) => n.status === 'healthy').length} C2 healthy</Pill>
            {c2.some((n) => n.status !== 'healthy') && <Pill tone="warn">{c2.filter((n) => n.status !== 'healthy').length} degraded or offline</Pill>}
            <Pill tone="ok">{agOn.length} agents connected</Pill>
            {agOff.length > 0 && <Pill tone="bad">{agOff.length} disconnected</Pill>}
          </div>
          {c2.length === 0 && d.agents.length === 0 ? <Empty icon={Server} title="No infrastructure assigned">Assign agents or a C2 node to this project.</Empty> : (
            <ul className="divide-y divide-line">
              {c2.map((n) => <Row key={n.id} onClick={() => go('c2')}><Server size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="font-medium">{n.name}</span><span className="block text-xs text-muted">{n.kind} · {n.latency}</span></span><span className="ml-auto"><Pill tone={n.status === 'healthy' ? 'ok' : n.status === 'degraded' ? 'warn' : 'neutral'}>{n.status}</Pill></span></Row>)}
              {d.agents.map((a) => <Row key={a.id} onClick={() => go('agent', { id: a.id })}><Radar size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="font-medium">{a.host}</span><span className="block text-xs text-muted"><Mono>{a.id}</Mono> · last seen {a.lastSeen}</span></span><span className="ml-auto"><Pill tone={a.status === 'online' || a.status === 'idle' ? 'ok' : 'bad'}>{a.status === 'online' || a.status === 'idle' ? 'connected' : 'disconnected'}</Pill></span></Row>)}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Tasks & Approval Inbox" sub={`${inboxTotal} waiting in ${p.id}, grouped by type`} actions={<Button size="sm" variant="ghost" onClick={() => go('tasks')}>Open inbox</Button>} />
        {inboxTotal === 0 ? <Empty icon={CheckCircle2} title="You're all caught up">No approvals or reviews are waiting in this project.</Empty> : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.filter((g) => g.items.length > 0).map((g) => (
              <section key={g.type} aria-label={g.type}>
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral">{g.type}<span className="rounded-full bg-accent-soft px-1.5 text-accent">{g.items.length}</span></div>
                <ul className="divide-y divide-line">{g.items.slice(0, 3).map((i) => <Row key={i.id} onClick={i.to}><Mono className="whitespace-nowrap">{i.id}</Mono><span className="min-w-0 truncate text-muted">{i.text}</span></Row>)}</ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      {!can('run') && <p className="text-xs text-muted">Your role is view-only for execution actions; the Open links go to read-only pages.</p>}
    </div>
  )
}

/* ───────── My Tasks (approvals inbox) ───────── */
type TaskKind = 'project' | 'scope' | 'closure' | 'plan' | 'access' | 'report' | 'finding'
interface Task { id: string; kind: TaskKind; label: string; title: string; sub: string; project: string; by: string; at: string; allowed: boolean; why: string; open: () => void; actions: ReactNode }

export function MyTasks() {
  const s = useStore()
  const { go, can, confirm, toast, A, me } = s
  const d = useCC()
  const [kind, setKind] = useState<'all' | TaskKind>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const all = s.pid === 'all'

  const decide = (title: string, confirmLabel: string, danger: boolean, fn: (reason: string) => { ok: boolean; error?: string } | void, okMsg: string, reasonRequired: boolean) =>
    confirm({ title, body: 'Your decision and reason are recorded in the audit log.', confirmLabel, danger, reasonLabel: reasonRequired ? 'Reason (required)' : 'Reason (optional)', reasonRequired, onConfirm: (reason) => { const r = fn(reason); if (r && !r.ok) toast(r.error || 'Could not complete the decision.', 'bad'); else toast(okMsg, 'ok') } })

  const apprTask = (a: Approval): Task => {
    const closure = a.type === APR.close
    const allowed = closure ? can('confirmClose', a.projectId) : can('approve', a.projectId)
    const kind: TaskKind = closure ? 'closure' : a.type === APR.scope ? 'scope' : 'project'
    return {
      id: a.id, kind, label: a.type, title: `${a.type} — ${a.projectId}`, sub: a.diff || a.note || 'No details provided.', project: a.projectId, by: a.by, at: a.at, allowed,
      why: closure ? 'Closure is confirmed by a Reviewer or Organization Admin.' : 'Project and scope approvals require the Reviewer or Organization Admin role.',
      open: () => go('project', { id: a.projectId }),
      actions: <>
        <Gated allowed={allowed} reason={closure ? 'Closure is confirmed by a Reviewer or Organization Admin.' : 'Project and scope approvals require the Reviewer or Organization Admin role.'}>
          <Button size="sm" variant="primary" onClick={() => decide(`Approve ${a.type.toLowerCase()}`, 'Approve', false, (r) => A.decideApproval(a.id, 'approved', r), `${a.id} approved.`, false)}>Approve</Button>
        </Gated>
        <Gated allowed={allowed} reason="Return requires the same approver role.">
          <Button size="sm" onClick={() => decide(`Return ${a.type.toLowerCase()} for changes`, 'Return', true, (r) => A.decideApproval(a.id, 'returned', r), `${a.id} returned for changes.`, true)}>Return</Button>
        </Gated>
      </>,
    }
  }
  const planTask = (p: Plan): Task => {
    const allowed = can('approvePlan', p.projectId) && p.requestedBy !== me.name
    const why = p.requestedBy === me.name ? 'You requested this plan. Another reviewer must decide.' : 'Plan approval requires the Reviewer or Organization Admin role.'
    return {
      id: p.id, kind: 'plan', label: 'Plan approval', title: `${p.id} — ${p.title}`, sub: `${p.steps.length} steps · ${p.steps.filter((x) => x.needsApproval).length} need explicit approval · ROE ${p.roeVersion}`, project: p.projectId, by: p.requestedBy, at: p.updated, allowed, why,
      open: () => go('ai-plan-review', { id: p.id }),
      actions: <>
        <Gated allowed={allowed} reason={why}><Button size="sm" variant="primary" onClick={() => decide(`Approve plan ${p.id}`, 'Approve plan', false, (r) => A.decidePlan(p.id, 'approved', r), `Plan ${p.id} approved.`, false)}>Approve</Button></Gated>
        <Gated allowed={allowed} reason={why}><Button size="sm" onClick={() => decide(`Reject plan ${p.id}`, 'Reject plan', true, (r) => A.decidePlan(p.id, 'rejected', r), `Plan ${p.id} rejected.`, true)}>Reject</Button></Gated>
      </>,
    }
  }
  const reqTask = (r: SessionRequest): Task => {
    const allowed = can('approveAccess', r.projectId)
    const why = 'Session access is decided by a Red Team Manager or Organization Admin.'
    return {
      id: r.id, kind: 'access', label: 'Session access', title: `${r.id} — ${r.mode} access to ${r.sessionId}`, sub: `${r.duration} · ${r.reason}`, project: r.projectId, by: r.by, at: r.at, allowed, why,
      open: () => go('c2-session', { id: r.sessionId }),
      actions: <>
        <Gated allowed={allowed} reason={why}><Button size="sm" variant="primary" onClick={() => decide(`Approve ${r.mode} access`, 'Approve access', false, (n) => { A.decideSessionRequest(r.id, 'approved', n) }, `Access ${r.id} approved.`, false)}>Approve</Button></Gated>
        <Gated allowed={allowed} reason={why}><Button size="sm" onClick={() => decide('Request changes', 'Request changes', false, (n) => { A.decideSessionRequest(r.id, 'changes', n) }, `Changes requested on ${r.id}.`, true)}>Request changes</Button></Gated>
        <Gated allowed={allowed} reason={why}><Button size="sm" onClick={() => decide('Reject access request', 'Reject', true, (n) => { A.decideSessionRequest(r.id, 'rejected', n) }, `Access ${r.id} rejected.`, true)}>Reject</Button></Gated>
      </>,
    }
  }
  const repTask = (r: Report): Task => {
    const allowed = can('approveReport', r.projectId)
    return {
      id: r.id, kind: 'report', label: 'Report review', title: `${r.id} — ${r.title}`, sub: `Version ${r.version} · reviewer ${r.reviewer}`, project: r.projectId, by: r.author, at: r.updated, allowed, why: 'Report approval requires the Reviewer role.',
      open: () => go('report-review', { id: r.id }),
      actions: <Gated allowed={allowed} reason="Report approval requires the Reviewer role."><Button size="sm" variant="primary" onClick={() => go('report-review', { id: r.id })}>Review report</Button></Gated>,
    }
  }
  const findTasks: Task[] = d.reviewFindings.map((f) => ({
    id: f.id, kind: 'finding', label: 'Finding review', title: `${f.id} — ${f.title}`, sub: `${sevLabel[f.severity]} · ${f.asset}`, project: f.projectId, by: f.owner, at: f.updated, allowed: can('reviewFinding', f.projectId), why: 'Finding review requires a Manager or Reviewer.', open: () => go('finding', { id: f.id }),
    actions: <Gated allowed={can('reviewFinding', f.projectId)} reason="Finding review requires a Manager or Reviewer."><Button size="sm" variant="primary" onClick={() => go('finding', { id: f.id })}>Review finding</Button></Gated>,
  }))

  const tasks: Task[] = [...d.pendingApprovals.map(apprTask), ...d.pendingPlans.map(planTask), ...d.pendingRequests.map(reqTask), ...d.reviewReports.map(repTask), ...findTasks]
  const mine = tasks.filter((t) => t.allowed)
  const rows = tasks.filter((t) => (kind === 'all' || t.kind === kind) && (!mineOnly || t.allowed))
  const count = (k: TaskKind) => tasks.filter((t) => t.kind === k).length

  return (
    <div>
      <PageHeader title="Tasks & Approval Inbox" sub="Approvals and reviews waiting for a decision. Approve or return happens with scope and reason; items your role cannot decide explain why." meta={<span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-muted">{mine.length} actionable by you</span>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={kind} onChange={setKind} options={[
          { id: 'all', label: `All (${tasks.length})` }, { id: 'project', label: `Projects (${count('project')})` }, { id: 'scope', label: `Scope (${count('scope')})` }, { id: 'closure', label: `Closure (${count('closure')})` },
          { id: 'plan', label: `Plans (${count('plan')})` }, { id: 'access', label: `Access (${count('access')})` }, { id: 'report', label: `Reports (${count('report')})` }, { id: 'finding', label: `Findings (${count('finding')})` },
        ]} />
        <Segmented value={mineOnly ? 'mine' : 'all'} onChange={(v) => setMineOnly(v === 'mine')} options={[{ id: 'all', label: 'All tasks' }, { id: 'mine', label: `Assigned to me (${mine.length})` }]} />
        {all && <span className="text-xs text-muted">Showing tasks across all accessible projects.</span>}
      </div>
      {rows.length === 0 ? (
        <Card><Empty icon={CheckCircle2} title="You're all caught up" action={<Button size="sm" onClick={() => go('command-center')}>Back to Command Center</Button>}>{kind === 'all' ? mineOnly ? 'Nothing is assigned to your role. Switch to All tasks to see read-only items.' : 'No approvals or reviews are waiting.' : 'No tasks of this type. Choose “All” to see other types.'}</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((t) => (
            <li key={t.kind + t.id}>
              <Card>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs font-medium text-muted">{t.label}</span>
                      <Status kind="approval" value="pending" size="sm" />
                      {!t.allowed && <span className="text-xs text-muted">Read-only for your role</span>}
                    </div>
                    <button onClick={t.open} className="text-left text-sm font-semibold hover:underline">{t.title}</button>
                    <p className="mt-0.5 text-sm text-muted">{t.sub}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Project <Mono>{t.project}</Mono></span><span>From {t.by}</span><span>{t.at}</span></div>
                    {!t.allowed && <p className="mt-2 text-xs text-muted"><AlertTriangle size={12} className="mr-1 inline text-warn" aria-hidden />{t.why} <button onClick={t.open} className="text-accent hover:underline">View details</button></p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">{t.actions}<Button size="sm" variant="ghost" onClick={t.open}>Details</Button></div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
