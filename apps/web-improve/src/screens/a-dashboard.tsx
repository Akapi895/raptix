import { useState, type ReactNode } from 'react'
import { Activity, AlertTriangle, ArrowRight, Bug, CheckCircle2, ClipboardCheck, FileBarChart, FolderKanban, Inbox, KeyRound, Plus, Radar, Server, ShieldAlert, ShieldCheck, Sparkles, Terminal, WifiOff, Workflow, type LucideIcon } from 'lucide-react'
import { useServices } from '../store'
import { APR, USERS } from '../data'
import type { Severity } from '../data'
import { actorRef } from '../auth/persona'
import { useAuthStore, useProjectStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import { decideApprovalTransaction } from '../features/approvals/service'
import { decidePlanTransaction } from '../features/plans/service'
import { decideSessionRequestTransaction } from '../features/c2/grants'
import { AiModeBadge, Banner, Button, Card, CardHeader, DemoTag, Donut, Empty, Gated, IdLink, Kpi, Legend, Mono, PageHeader, PageSkeleton, Progress, Segmented, STATUS, Status, Timeline, cx } from '../ui'
import type { CanAction } from '../domain/permissions'
import { useConsoleGo, useDashboard, type ConsoleGo } from './dashboard/use-dashboard'
import { attentionItems, canDo, completion, dashboardKpis, eligibility, formatCountdown, grantMinutesLeft, openFindings, opProgress, readiness } from './dashboard/domain'
import type { AttnSource, DashboardAggregate } from './dashboard/domain'
import { useTasks } from './tasks/use-tasks'
import { minutesLeft, TASK_KINDS } from './tasks/domain'
import type { TaskItem, TaskKind } from './tasks/domain'

const SEV_COLOR: Record<Severity, string> = { critical: 'var(--c-bad)', high: 'var(--c-orange)', medium: 'var(--c-warn)', low: 'var(--c-cyan)', info: 'var(--c-neutral)' }
const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const SELECT_PROJECT = 'Select a project to continue'
const ATTN_ICON: Record<AttnSource, LucideIcon> = { agent: WifiOff, plan: Sparkles, request: KeyRound, roe: ShieldAlert, c2: Server }

/* ───────── Command Center (ticket 14: typed aggregate reads + Query + shared scope) ───────── */
const ErrorNotice = ({ message, retry }: { message?: string; retry: () => void }) => (
  <Banner tone="bad" title="The dashboard could not be loaded" action={<Button size="sm" onClick={retry}>Try again</Button>}>{message || 'The aggregate read failed.'}</Banner>
)

export function Dashboard() {
  const go = useConsoleGo()
  const meName = useAuthStore((s) => s.meName)
  const pid = useProjectStore((s) => s.pid)
  const { data, isError, error, refetch, now } = useDashboard()
  const all = pid === 'all'
  const project = data?.projects.find((p) => p.id === pid)

  if (!data) {
    return (
      <div>
        <PageHeader title="Command Center" />
        {isError ? <ErrorNotice message={error?.message} retry={refetch} /> : <PageSkeleton />}
      </div>
    )
  }
  const d = data
  const actor = actorRef(meName)
  const can = (action: CanAction, projectId?: string) => canDo(d, actor, action, projectId)
  const gate = { allowed: !all && can('run'), reason: all ? SELECT_PROJECT : 'Your role cannot start operations. Ask a Red Team Manager or Operator.' }
  const k = dashboardKpis(d)
  const attention = attentionItems(d, actor)
  const open = openFindings(d)
  const sevData = SEVS.map((s) => ({ label: STATUS.sev[s].label, value: open.filter((f) => f.severity === s).length, color: SEV_COLOR[s] }))

  if (!all && !project) {
    return (
      <div>
        <PageHeader title="Command Center" />
        <Empty icon={ShieldCheck} title="This project is not available for your role">Select a project in the top bar, or switch to the aggregate view.</Empty>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Command Center"
        sub={all ? `All projects · ${k.accessibleProjects} accessible · signed in as ${meName}` : `${project?.name} · ${project?.client}`}
        meta={all ? <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-muted">Aggregate view</span> : <Mono className="text-muted">{project?.id}</Mono>}
        actions={<>
          <Gated allowed={can('createProject')} reason="Only Red Team Managers and Organization Admins can create projects."><Button variant="primary" icon={FolderKanban} onClick={() => go('project-new')}>Create Project</Button></Gated>
          <Gated {...gate}><Button icon={Plus} onClick={() => go('operation-new')}>New Operation</Button></Gated>
          <Gated allowed={!all && can('plan')} reason={all ? SELECT_PROJECT : 'Your role cannot create AI plans.'}><Button icon={Sparkles} onClick={() => go('ai-operator')}>Ask AI Operator</Button></Gated>
        </>}
      />

      {isError && <ErrorNotice message={error?.message} retry={refetch} />}
      {all && <Banner tone="info" title="Showing aggregated data across accessible projects">Read-only view. Select a project in the top bar to start operations or open sessions.</Banner>}

      {/* KPI strip */}
      <section aria-label="Key metrics" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active Projects" icon={FolderKanban} value={k.activeProjects} sub={`${k.accessibleProjects} accessible`} onClick={() => go('projects')} />
        <Kpi label="Running Operations" icon={Activity} tone="cyan" value={k.running} sub={`${k.totalOps} total`} onClick={() => go('operations')} />
        <Kpi label="Plans Awaiting Approval" icon={ClipboardCheck} tone={k.reviewPlans ? 'warn' : undefined} value={k.reviewPlans} sub={`${k.otherApprovals} other approvals`} onClick={() => go('tasks')} />
        <Kpi label="Agents Connected" icon={Radar} tone={k.offlineAgents ? 'warn' : 'ok'} value={<>{k.healthyAgents}<span className="text-muted"> / {k.totalAgents}</span></>} sub={k.offlineAgents ? `${k.offlineAgents} disconnected` : 'All connected'} onClick={() => go('agents')} />
        <Kpi label="Active Sessions" icon={Terminal} value={k.liveSessions} sub={`${k.trackedSessions} tracked`} onClick={() => go('c2')} />
        <Kpi label="Open Findings" icon={Bug} value={k.openFindings} sub={k.aiSuggested ? `${k.aiSuggested} AI suggestion${k.aiSuggested === 1 ? '' : 's'} not counted` : `${k.criticalOrHigh} critical or high`} onClick={() => go('findings')} />
      </section>

      {!all && project && <ProjectPanels ds={d} pid={project.id} go={go} now={now} meName={meName} />}

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
                    <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', a.tone === 'bad' ? 'bg-bad/10 text-bad' : a.tone === 'warn' ? 'bg-warn/10 text-warn' : 'bg-cyan/10 text-cyan')}><AttentionGlyph source={a.source} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{a.title}<span className="rounded-full border border-line px-2 text-[11px] font-normal text-muted">{a.kind}</span></div>
                      <div className="truncate text-xs text-muted">{a.sub}{a.project && all ? ` · ${a.project}` : ''}</div>
                    </div>
                    <Button size="sm" onClick={() => go(a.to.page, { id: a.to.id, tab: a.to.tab })}>{a.cta}<ArrowRight size={14} aria-hidden /></Button>
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
              const act = d.operations.filter((o) => ['running', 'paused', 'pending', 'ready'].includes(o.status))
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
            {open.length === 0 ? <Empty icon={ShieldCheck} title="No open findings">Findings appear here once confirmed.</Empty> : (
              <div className="flex flex-wrap items-center gap-5"><Donut data={sevData} size={120} center={<div className="text-center"><div className="text-xl font-semibold">{open.length}</div><div className="text-[11px] text-muted">open</div></div>} /><Legend data={sevData} /></div>
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

const AttentionGlyph = ({ source }: { source: AttnSource }) => {
  const I = ATTN_ICON[source]
  return <I size={17} aria-hidden />
}

/* ───────── Project Command Center panels (CC-V3-02) ───────── */
const Pill = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'cyan' }) => (
  <span className={cx('inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium', { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', bad: 'border-bad/30 bg-bad-soft text-bad', neutral: 'border-line bg-subtle text-muted', cyan: 'border-cyan/30 bg-info-soft text-cyan' }[tone])}>{children}</span>
)
const Row = ({ onClick, children }: { onClick?: () => void; children: ReactNode }) => (
  <li className="flex items-start gap-2 py-2 text-sm">{children}{onClick && <button onClick={onClick} className="ml-auto shrink-0 whitespace-nowrap text-xs font-medium text-accent hover:underline">Open</button>}</li>
)

function ProjectPanels({ ds, pid, go, now, meName }: { ds: DashboardAggregate; pid: string; go: ConsoleGo; now: number; meName: string }) {
  const aiMode = useUiStore((s) => s.aiMode)
  const can = (action: CanAction, projectId?: string) => canDo(ds, actorRef(meName), action, projectId ?? pid)
  const p = ds.projects.find((x) => x.id === pid)!
  const rd = readiness(ds, pid)
  const cp = completion(ds, pid)
  const el = eligibility(ds, pid)
  const noData = cp.ops === 0 && ds.findings.length === 0 && ds.reports.length === 0

  // AI pending decisions
  const plans = ds.plans.filter((x) => x.status === 'in_review' || x.status === 'proposed')
  const tools = ds.toolEvents.filter((t) => t.state === 'awaiting')
  const reviewSteps = ds.operations.flatMap((o) => o.steps.filter((x) => x.status === 'review').map((x) => ({ o, x })))
  const suggestions = ds.findings.filter((f) => f.status === 'ai_suggested')
  const aiTotal = plans.length + tools.length + reviewSteps.length + suggestions.length

  // sessions
  const sess = ds.sessions.filter((x) => ['connected', 'available', 'awaiting', 'suspended'].includes(x.state))
  const pend = ds.sessionRequests.filter((r) => r.status === 'pending')

  // health
  const c2 = ds.c2Nodes.filter((n) => n.projectIds.includes(pid))
  const agOn = ds.agents.filter((a) => a.status === 'online' || a.status === 'idle')
  const agOff = ds.agents.filter((a) => !(a.status === 'online' || a.status === 'idle'))

  // inbox grouped by type
  const pendingApprovals = ds.approvals.filter((a) => a.status === 'pending')
  const reviewFindings = ds.findings.filter((f) => f.status === 'review')
  const reviewReports = ds.reports.filter((r) => r.status === 'review')
  const groups: { type: string; items: { id: string; text: string; to: () => void }[] }[] = [
    { type: 'Project Approval', items: pendingApprovals.filter((a) => a.type === APR.create || a.type === APR.close).map((a) => ({ id: a.id, text: `${a.type} — ${a.by}`, to: () => go('project', { id: pid }) })) },
    { type: 'ROE Change', items: pendingApprovals.filter((a) => a.type === APR.scope).map((a) => ({ id: a.id, text: `${a.diff || a.type} — ${a.by}`, to: () => go('project', { id: pid, tab: 'scope' }) })) },
    { type: 'AI Plan Review', items: ds.plans.filter((x) => x.status === 'in_review').map((x) => ({ id: x.id, text: `${x.title} ${x.ver ?? 'v' + x.version}`, to: () => go('ai-plan-review', { id: x.id }) })) },
    { type: 'Session Access', items: pend.map((r) => ({ id: r.id, text: `${r.by} requests ${r.mode} access to ${r.sessionId}`, to: () => go('c2-session', { id: r.sessionId }) })) },
    { type: 'Finding Review', items: reviewFindings.map((f) => ({ id: f.id, text: f.title, to: () => go('finding', { id: f.id }) })) },
    { type: 'Report Review', items: reviewReports.map((r) => ({ id: r.id, text: `${r.title} ${r.version}`, to: () => go('report-review', { id: r.id }) })) },
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
                    {x.grants.map((g) => { const n = grantMinutesLeft(g.expires, now); return <span key={g.user} className="mt-1 block text-xs text-muted">Grant: {g.user}, {g.perm} · <span className={n !== undefined && n <= 15 ? 'font-medium text-warn' : ''}>{formatCountdown(n)}</span></span> })}
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
          {c2.length === 0 && ds.agents.length === 0 ? <Empty icon={Server} title="No infrastructure assigned">Assign agents or a C2 node to this project.</Empty> : (
            <ul className="divide-y divide-line">
              {c2.map((n) => <Row key={n.id} onClick={() => go('c2')}><Server size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="font-medium">{n.name}</span><span className="block text-xs text-muted">{n.kind} · {n.latency}</span></span><span className="ml-auto"><Pill tone={n.status === 'healthy' ? 'ok' : n.status === 'degraded' ? 'warn' : 'neutral'}>{n.status}</Pill></span></Row>)}
              {ds.agents.map((a) => <Row key={a.id} onClick={() => go('agent', { id: a.id })}><Radar size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="font-medium">{a.host}</span><span className="block text-xs text-muted"><Mono>{a.id}</Mono> · last seen {a.lastSeen}</span></span><span className="ml-auto"><Pill tone={a.status === 'online' || a.status === 'idle' ? 'ok' : 'bad'}>{a.status === 'online' || a.status === 'idle' ? 'connected' : 'disconnected'}</Pill></span></Row>)}
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

/* ───────── My Tasks (ticket 15: typed aggregate reads + Query + shared scope) ───────── */
const KIND_LABEL: Record<TaskKind, string> = { project: 'Projects', scope: 'Scope', closure: 'Closure', plan: 'Plans', access: 'Access', report: 'Reports', finding: 'Findings' }

export function MyTasks() {
  const go = useConsoleGo()
  const pid = useProjectStore((s) => s.pid)
  const { data, isError, error, refetch, now } = useTasks()
  const services = useServices()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const [kind, setKind] = useState<'all' | TaskKind>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const all = pid === 'all'

  if (!data) {
    return (
      <div>
        <PageHeader title="Tasks & Approval Inbox" sub="Approvals and reviews waiting for a decision." />
        {isError ? <ErrorNotice message={error?.message} retry={refetch} /> : <PageSkeleton />}
      </div>
    )
  }
  const { tasks, counts, mine } = data.summary

  /* Ticket 67 wave 3: the legacy A.decide* entries, mirrored — the plan and
     access-request project lookups resolve from the one authority at call
     time, the request context captures the current persona (the override-aware
     `me`, read at call time so a failing authority read never reaches this
     render) with corr 'legacy', and the typed result bridges back to the
     legacy Res shape. */
  const actorCtx = (projectId: string) => {
    const name = useAuthStore.getState().meName
    const base = USERS.find((u) => u.name === name)!
    const ov = services.authority.snapshot().org.members[name]?.role
    const me = ov ? { ...base, role: ov } : base
    return { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }
  }
  const decidePlan = (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string) => {
    const projectId = services.authority.snapshot().plans.find((x) => x.id === planId)?.projectId
    if (!projectId) return { ok: false as const, error: `Plan ${planId} does not exist.` }
    const res = decidePlanTransaction(services.authority, services.clock, actorCtx(projectId), planId, decision, note)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const decideApproval = (id: string, decision: 'approved' | 'returned', note: string) => {
    const res = decideApprovalTransaction(services.authority, services.clock, actorCtx(''), id, decision, note)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const decideSessionRequest = (id: string, decision: 'approved' | 'rejected' | 'changes', note: string, minutes?: number) => {
    const r = services.authority.snapshot().sessionRequests.find((x) => x.id === id)
    if (!r) return { ok: false as const, error: `Access request ${id} does not exist.` }
    const res = decideSessionRequestTransaction(services.authority, services.clock, actorCtx(r.projectId), { requestId: id, decision, note, minutes })
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }

  const decide = (title: string, confirmLabel: string, danger: boolean, fn: (reason: string) => { ok: boolean; error?: string } | void, okMsg: string, reasonRequired: boolean) =>
    confirm({ title, body: 'Your decision and reason are recorded in the audit log.', confirmLabel, danger, reasonLabel: reasonRequired ? 'Reason (required)' : 'Reason (optional)', reasonRequired, onConfirm: (reason) => { const r = fn(reason); if (r && !r.ok) toast(r.error || 'Could not complete the decision.', 'bad'); else toast(okMsg, 'ok') } })


  const open = (t: TaskItem) => () => go(t.to.page, { id: t.to.id, tab: t.to.tab })

  const actions = (t: TaskItem): ReactNode => {
    if (t.kind === 'plan') return <>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={() => decide(`Approve plan ${t.id}`, 'Approve plan', false, (r) => decidePlan(t.id, 'approved', r), `Plan ${t.id} approved.`, false)}>Approve</Button></Gated>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" onClick={() => decide(`Reject plan ${t.id}`, 'Reject plan', true, (r) => decidePlan(t.id, 'rejected', r), `Plan ${t.id} rejected.`, true)}>Reject</Button></Gated>
    </>
    if (t.kind === 'access') return <>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={() => decide(`Approve session access ${t.id}`, 'Approve access', false, (n) => decideSessionRequest(t.id, 'approved', n), `Access ${t.id} approved.`, false)}>Approve</Button></Gated>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" onClick={() => decide('Request changes', 'Request changes', false, (n) => decideSessionRequest(t.id, 'changes', n), `Changes requested on ${t.id}.`, true)}>Request changes</Button></Gated>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" onClick={() => decide('Reject access request', 'Reject', true, (n) => decideSessionRequest(t.id, 'rejected', n), `Access ${t.id} rejected.`, true)}>Reject</Button></Gated>
    </>
    if (t.kind === 'report') return <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={open(t)}>Review report</Button></Gated>
    if (t.kind === 'finding') return <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={open(t)}>Review finding</Button></Gated>
    return <>
      <Gated allowed={t.allowed} reason={t.why}>
        <Button size="sm" variant="primary" onClick={() => decide(`Approve ${t.label.toLowerCase()}`, 'Approve', false, (r) => decideApproval(t.id, 'approved', r), `${t.id} approved.`, false)}>Approve</Button>
      </Gated>
      <Gated allowed={t.allowed} reason="Return requires the same approver role.">
        <Button size="sm" onClick={() => decide(`Return ${t.label.toLowerCase()} for changes`, 'Return', true, (r) => decideApproval(t.id, 'returned', r), `${t.id} returned for changes.`, true)}>Return</Button>
      </Gated>
    </>
  }

  const rows = tasks.filter((t) => (kind === 'all' || t.kind === kind) && (!mineOnly || t.allowed))

  return (
    <div>
      <PageHeader title="Tasks & Approval Inbox" sub="Approvals and reviews waiting for a decision. Approve or return happens with scope and reason; items your role cannot decide explain why." meta={<span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-muted">{mine} actionable by you</span>} />
      {isError && <ErrorNotice message={error?.message} retry={refetch} />}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={kind} onChange={setKind} options={[
          { id: 'all', label: `All (${tasks.length})` }, ...TASK_KINDS.map((k) => ({ id: k, label: `${KIND_LABEL[k]} (${counts[k]})` })),
        ]} />
        <Segmented value={mineOnly ? 'mine' : 'all'} onChange={(v) => setMineOnly(v === 'mine')} options={[{ id: 'all', label: 'All tasks' }, { id: 'mine', label: `Assigned to me (${mine})` }]} />
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
                      {t.expiresAt !== undefined && (() => {
                        const mins = minutesLeft(t.expiresAt, now)
                        return <span className={cx('text-xs tabular-nums', mins !== undefined && mins <= 0 ? 'font-medium text-warn' : 'text-muted')}>{formatCountdown(mins)}</span>
                      })()}
                    </div>
                    <button onClick={open(t)} className="text-left text-sm font-semibold hover:underline">{t.title}</button>
                    <p className="mt-0.5 text-sm text-muted">{t.sub}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Project <Mono>{t.project}</Mono></span><span>From {t.by}</span><span>{t.at}</span></div>
                    {!t.allowed && <p className="mt-2 text-xs text-muted"><AlertTriangle size={12} className="mr-1 inline text-warn" aria-hidden />{t.why} <button onClick={open(t)} className="text-accent hover:underline">View details</button></p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">{actions(t)}<Button size="sm" variant="ghost" onClick={open(t)}>Details</Button></div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
