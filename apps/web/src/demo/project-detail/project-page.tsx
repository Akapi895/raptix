/**
 * Project detail (ticket 20, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The migrated detail shell: one typed canonical read per detail URL through
 * Query (src/demo/project-detail). The factory's ProjectService owns the
 * membership rule, so an unknown project and a project outside the actor's
 * scope collapse into the same `not-found` failure — the blocked state never
 * renders record content. Overview readiness/completion/eligibility come
 * from the Command Center's pure domain functions over the same aggregate
 * projection the dashboard reads (src/domain/dashboard — semantics
 * pinned there, not duplicated). Header pin runs through the typed project
 * write with its policy reason; approval submission and reopen stay on the
 * bridged legacy actions until tickets 21–22 own their handlers.
 *
 * Old `?tab=` aliases keep resolving, tab state survives back/forward and
 * scope switches, and the shared dirty guard holds tab navigation. All
 * secondary panels (objectives, activity, operations, plans, sessions,
 * findings, reports, evidence, audit, close) render the same typed
 * `ProjectDetail` read (ticket 23): cross-entity slices come from the
 * service's project-narrowed aggregate, evidence and the closure checklist
 * are service-derived, and the Query change bridge refetches the view after
 * every committed mutation — legacy actions included — so a panel can never
 * show stale state. Closeout delegates ticket 22's policy derivation; no
 * panel duplicates operation/report/grant enforcement.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Lock, Pin, PinOff, Plus, SearchX, Send, ArrowRight, CheckCircle2, CircleDashed } from 'lucide-react'
import { APR } from '../../domain/catalog';
import { type Project } from '../../domain/entities'
import { ExecutionWorkspace } from '../../features/execution/workspace'
import { VaultTab } from '../../features/vault/tab'
import { useServices } from '../../state/services'
import { ROLE_LABEL } from '../../domain/policy'
import { useProjectStore, useToastStore } from '../../state/stores'
import { useCan, useMe } from '../../state/console'
import { go, selectProject, useRoute } from '../../router/navigate'
import { MOCK_PROJECT_NAV, MOCK_PROJECT_TABS } from '../../shell/nav'
import { resolveProjectTab } from '../../router/aliases'
import { Banner, Button, Card, CardHeader, Empty, FilterBar, IconButton, IdLink, Kpi, PageHeader, Pager, Person, Progress, Select, Status, Sev, Skeleton, Table, Timeline, usePaged, useGuard, type Col } from '../../ui/index'
import type { DashboardAggregate, Eligibility } from '../../domain/dashboard'
import { TeamTab, CloseTab } from './project-tabs'
import { ScopeTab } from '../../features/scope/tab'
import { ProjectAssets } from '../../features/assets'
import { isAssetMapEnabled } from '../../features/asset-map'
import { DocumentWorkspace } from '../../features/documents/workspace'
import { useSubmitApproval, useReopen } from '../../features/approvals/hooks'
import { useProjectDetail } from './use-project-detail'
import { createPortfolioHandlers, ServiceReadError } from './portfolio-handlers'
import type { ProjectDetail } from './service'
import type { ServiceFailure } from '../../domain/service'

const parseDate = (s: string) => { const d = new Date(s.replace(/,?\s*\d{1,2}:\d{2}.*$/, '')); return isNaN(d.getTime()) ? new Date(2026, 9, 13) : d }
const NOW = new Date(2026, 9, 13)
const ExecutionTrace = lazy(() => import('../../features/trace/views/ai-trace-pages').then((module) => ({ default: module.AiTrace })))

/** Valid project tab IDs own the URLs; old aliases keep resolving. */
const TAB_IDS = MOCK_PROJECT_TABS.map((t) => t.id)
/** The page title is the section being opened (plan 2026-10-16 §3.1). */
const sectionTitle = (tab: string) => MOCK_PROJECT_NAV.flatMap((g) => g.items).find((i) => i.match.includes(tab))?.label ?? 'Overview'

/** Access-blocked / not-found state. The typed read collapses foreign and unknown projects into one not-found failure — no record content is ever rendered. */
function Blocked({ id }: { id?: string }) {
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Empty
        icon={SearchX}
        title="Project not found"
        action={<div className="flex gap-2"><Button variant="primary" onClick={() => go('projects')}>Back to Projects</Button><Button onClick={() => go('overview')}>Go to Overview</Button></div>}
      >
        {`Project ${id ? `"${id}" ` : ''}does not exist or is not in the list you can view.`}
      </Empty>
    </div>
  )
}

function DetailPending() {
  return (
    <div aria-busy="true" aria-label="Loading project">
      <PageHeader title="Project" sub="Loading the canonical project read…" />
      <Skeleton className="h-72" />
    </div>
  )
}

function ReadFailure({ failure, retry }: { failure: ServiceFailure; retry: () => void }) {
  return (
    <div className="pt-6">
      <Banner tone="bad" title="The project detail could not be loaded" action={<Button size="sm" onClick={retry}>Try again</Button>}>{failure.message}</Banner>
    </div>
  )
}

export function ProjectPage() {
  const route = useRoute()
  const id = route.id
  const detail = useProjectDetail(id)
  /* One-time switcher sync on entry: the detail URL's project becomes the
     selected context. This is the raw project-store write on purpose — the
     guarded `setPid` flashes the shell's loading state, which unmounts this
     page mid-read, drops the fetched detail (gcTime 0) and refetches. The
     redirect branch of `setPid` is a no-op here (the URL already points at
     this project), so only the selection itself is needed. */
  useEffect(() => {
    if (!id) return
    const ps = useProjectStore.getState()
    if (ps.pid !== id) ps.setPid(id)
  }, [id])
  if (!id) return <Blocked />
  if (detail.isPending) return <DetailPending />
  if (!detail.data) {
    const failure = detail.error instanceof ServiceReadError ? detail.error.failure : undefined
    if (failure && failure.kind !== 'not-found') return <ReadFailure failure={failure} retry={detail.refetch} />
    return <Blocked id={id} />
  }
  return <Detail key={id} d={detail.data} />
}

function Detail({ d }: { d: ProjectDetail }) {
  const me = useMe()
  const route = useRoute()
  const toast = useToastStore((s) => s.toast)
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const svc = useServices()
  const p = d.project
  const ds = d.aggregate
  const rt = route.tab ? resolveProjectTab(route.tab) : ''
  const tab = TAB_IDS.includes(rt) ? rt : 'overview'
  const elig = d.eligibility
  const guard = useGuard(p.id)
  const sub = useSubmitApproval(p)
  const reopen = useReopen(p)

  const pending = ds.approvals.filter((a) => a.status === 'pending')
  const scopePending = pending.find((a) => a.type === APR.scope)

  const via = (page: string, opts?: { id?: string; tab?: string }) => { if (pid !== p.id) { selectProject(p.id); setTimeout(() => go(page, opts), 80) } else go(page, opts) }
  const setTab = (t: string) => go('project', { id: p.id, tab: t })
  const canOp = !guard.ro && can('run', p.id)
  const closed = p.status === 'closed' || p.status === 'cancelled'
  const canSubmit = (p.status === 'draft' || p.status === 'rejected') && can('editScope', p.id)

  /* Header pin runs through the typed project write (ticket 04's representative
   * write); the handler enforces the same role rule the button states. */
  const handlers = useMemo(() => createPortfolioHandlers(svc, { id: me.name, role: me.role }, p.id), [svc, me.name, me.role, p.id])
  const pin = useMutation({
    mutationFn: (pinned: boolean) => handlers.setPinned(p.id, pinned),
    onSuccess: (res) => {
      if (res.ok) toast(res.data.pinned ? `Pinned ${p.id}` : `Unpinned ${p.id}`)
      else toast(res.failure.message, 'bad')
    },
  })
  const canPin = me.role === 'manager' || me.role === 'admin'

  /* Page-scoped actions (plan §3.1): the Overview header keeps the
     engagement-level CTAs; other sections carry their own in-page CTA and
     never repeat Close Project / Ask AI (Ask AI is the header copilot entry,
     Close Project lives in Closeout). */
  const actions = tab === 'overview' ? (
    <>
      <IconButton
        icon={p.pinned ? PinOff : Pin} label={p.pinned ? 'Unpin project' : 'Pin project'} disabled={!canPin || pin.isPending}
        title={canPin ? undefined : 'Only a Red Team Manager or Organization Admin can pin projects'}
        onClick={() => pin.mutate(!p.pinned)}
      />
      {canSubmit && (
        <Button icon={Send} variant="primary" disabled={!sub.ready} title={sub.ready ? undefined : `Cannot submit yet: ${sub.issues.join('; ')}`} onClick={sub.submit}>
          {p.status === 'rejected' ? 'Resubmit for Approval' : 'Request Approval'}
        </Button>
      )}
      {closed ? (
        can('reopen', p.id) ? <Button variant="danger" onClick={reopen}>Reopen Project</Button> : <span title="Only an Organization Admin can reopen a closed project"><Button disabled>Reopen Project</Button></span>
      ) : (
        <Button variant="primary" icon={Plus} disabled={!canOp} title={canOp ? (elig.kind === 'locked' ? 'Saves a draft operation. Run stays blocked until execution is unlocked.' : undefined) : guard.ro ? guard.reason : 'Your role cannot create operations'} onClick={() => via('operation-new')}>Create Operation</Button>
      )}
    </>
  ) : undefined

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: p.name }]}
        title={sectionTitle(tab)}
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

      {tab === 'overview' && <Overview d={d} via={via} setTab={setTab} />}
      {tab === 'scope' && <ScopeTab engagementId={p.id} documents={<DocumentWorkspace key={p.id} p={p} />} />}
      {tab === 'assets' && <ProjectAssets engagementId={p.id} mapEnabled={isAssetMapEnabled()} />}
      {tab === 'objectives' && <Objectives p={p} ds={ds} />}
      {tab === 'activity' && <Activity p={p} ds={ds} />}
      {tab === 'team' && <TeamTab p={p} ds={ds} />}
      {tab === 'ai-workspace' && <ExecutionWorkspace project={p} aggregate={ds} history={<OpsTab p={p} ds={ds} elig={elig} via={via} setTab={setTab} />} />}
      {tab === 'operations' && <div className="space-y-6"><OpsTab p={p} ds={ds} elig={elig} via={via} setTab={setTab} /><section aria-label="Execution tool calls"><h2 className="mb-3 text-base font-semibold">Tool calls & execution logs</h2><Suspense fallback={<p role="status">Loading tool trace…</p>}><ExecutionTrace embedded /></Suspense></section></div>}
      {tab === 'plans' && <PlansTab p={p} ds={ds} />}
      {tab === 'sessions' && <SessionsTab p={p} ds={ds} />}
      {tab === 'findings' && <FindingsTab p={p} ds={ds} via={via} />}
      {tab === 'reports' && <ReportsTab p={p} ds={ds} via={via} />}
      {tab === 'evidence' && <EvidenceTab p={p} d={d} />}
      {tab === 'audit' && <AuditTab p={p} ds={ds} />}
      {tab === 'vault' && <VaultTab engagementId={p.id} />}
      {tab === 'close' && <CloseTab p={p} d={d} setTab={setTab} />}
    </>
  )
}

type Via = (page: string, opts?: { id?: string; tab?: string }) => void

/* ───────────── PR-03 Overview (ticket 20: dashboard domain functions over the typed aggregate) ───────────── */
function Overview({ d, via, setTab }: { d: ProjectDetail; via: Via; setTab: (t: string) => void }) {
  const can = useCan()
  const p = d.project
  const ds = d.aggregate
  const guard = useGuard(p.id)
  const ops = ds.operations
  const fs = ds.findings
  const reps = ds.reports
  const agents = ds.agents
  const assets = ds.assets
  const running = ops.filter((o) => o.status === 'running')
  const openF = fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status))
  const audit = ds.audit.slice(0, 5)
  const elig = d.eligibility
  const rd = d.readiness
  const cp = d.completion
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
  if (p.status === 'closed') next.push({ label: 'Back to Overview', sub: 'Return to the workspace overview', onClick: () => go('overview') })

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
            <CardHeader title="Execution Readiness" sub={`${rd.done}/${rd.total} ready. ${rd.done === rd.total ? 'Every check passes before an operation runs.' : 'Finish the remaining checks before an operation runs.'}`} />
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

/* ───────────── PR-03/Objectives (ticket 23: typed aggregate slice) ───────────── */
function Objectives({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const ops = ds.operations.filter((o) => o.projectId === p.id)
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

/* ───────────── PR-08 Activity (ticket 23: typed aggregate slice) ───────────── */
const CATS: Record<string, { label: string; re: RegExp }> = {
  scope: { label: 'Scope / assets', re: /scope|asset/i },
  approval: { label: 'Approvals', re: /approv|return|submitted|decid/i },
  op: { label: 'Operations / agents', re: /operation|preflight|agent|stop|session/i },
  finding: { label: 'Findings', re: /finding/i },
  report: { label: 'Reports', re: /report/i },
  close: { label: 'Closure / reopen', re: /clos|reopen/i },
}
function Activity({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const [cat, setCat] = useState('')
  const list = ds.audit.filter((a) => a.projectId === p.id && (!cat || CATS[cat].re.test(a.action)))
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

/* ───────────── Execution workspace (plan 2026-10-16 §4: the direct entry for
   operations/runs — no intermediate second list; states and next steps first) ───────────── */
function OpsTab({ p, ds, elig, via, setTab }: { p: Project; ds: DashboardAggregate; elig: Eligibility; via: Via; setTab: (t: string) => void }) {
  const can = useCan()
  const guard = useGuard(p.id)
  const ops = ds.operations.filter((o) => o.projectId === p.id)
  const pg = usePaged(ops, 8)
  const canOp = !guard.ro && can('run', p.id)
  const live = !['closed', 'cancelled'].includes(p.status)
  const running = ops.filter((o) => o.status === 'running')
  const waiting = ops.filter((o) => ['draft', 'ready', 'pending', 'paused'].includes(o.status))
  const errored = ops.filter((o) => ['error', 'estop'].includes(o.status))
  const done = ops.filter((o) => o.status === 'done')
  const blocked = live && elig.reasons.length > 0
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
      {/* Header: states + the evidence-based next step; no second table to cross. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Running" value={running.length} sub={running[0]?.name ?? 'Nothing is executing'} tone={running.length ? 'ok' : undefined} onClick={() => running[0] && go('operation', { id: running[0].id })} />
        <Kpi label="Waiting" value={waiting.length} sub={waiting.length ? 'Drafts and paused runs' : 'Nothing queued'} onClick={() => waiting[0] && go('operation', { id: waiting[0].id })} />
        <Kpi label="Errors / stopped" value={errored.length} sub={errored.length ? errored.map((o) => o.id).join(', ') : 'None observed'} tone={errored.length ? 'warn' : undefined} onClick={() => errored[0] && go('operation', { id: errored[0].id })} />
        <Kpi label="Completed" value={done.length} sub={done.length ? `${done.length} finished run${done.length === 1 ? '' : 's'}` : 'No completed runs yet'} />
      </div>
      {ops.length === 0 && live && (
        <Banner tone="info" title="No operations yet">
          {blocked
            ? <>Execution is blocked by preflight conditions. Resolve them in <button className="text-accent underline" onClick={() => setTab('scope')}>Scope & ROE</button> and prepare the approach in <button className="text-accent underline" onClick={() => setTab('plans')}>Planning</button>; drafts can be saved meanwhile.</>
            : <>Create a draft operation below, or review <button className="text-accent underline" onClick={() => setTab('scope')}>Scope & ROE</button> and <button className="text-accent underline" onClick={() => setTab('plans')}>Planning</button> first.</>}
        </Banner>
      )}
      <FilterBar right={<Button variant="primary" icon={Plus} disabled={!canOp} title={canOp ? 'Saves a draft; Run is gated separately' : guard.ro ? guard.reason : 'Your role cannot create operations'} onClick={() => via('operation-new')}>Create Operation</Button>}>
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

function FindingsTab({ p, ds, via }: { p: Project; ds: DashboardAggregate; via: Via }) {
  const can = useCan()
  const guard = useGuard(p.id)
  const fs = ds.findings.filter((f) => f.projectId === p.id)
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
      <FilterBar right={<Button variant="primary" icon={Plus} disabled={!ok} title={ok ? undefined : guard.ro ? guard.reason : 'Your role cannot create findings'} onClick={() => via('finding-new')}>Create Finding</Button>}>
        <span className="text-sm text-muted">{fs.length} findings in {p.id}</span>
      </FilterBar>
      <Table cols={cols} rows={pg.rows} rowKey={(f) => f.id} onRow={(f) => go('finding', { id: f.id })} empty={<Empty title="No findings yet">Findings are created from operation results or entered manually.</Empty>} />
      <Pager {...pg} />
    </>
  )
}

function ReportsTab({ p, ds, via }: { p: Project; ds: DashboardAggregate; via: Via }) {
  const can = useCan()
  const guard = useGuard(p.id)
  const reps = ds.reports.filter((r) => r.projectId === p.id)
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
      <FilterBar right={<Button variant="primary" icon={Plus} disabled={!ok} title={ok ? 'Drafts can be saved at any time' : guard.ro ? guard.reason : 'Your role cannot create reports'} onClick={() => via('report-new')}>Create Report Draft</Button>}>
        <span className="text-sm text-muted">{reps.length} reports in {p.id}</span>
      </FilterBar>
      <Table cols={cols} rows={reps} rowKey={(r) => r.id} onRow={(r) => go('report', { id: r.id })} empty={<Empty title="No reports yet">Create a report from a template once findings are confirmed.</Empty>} />
    </>
  )
}

function EvidenceTab({ p, d }: { p: Project; d: ProjectDetail }) {
  const me = useMe()
  const can = useCan()
  const evs = d.evidence.filter((e) => e.projectId === p.id)
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
      {!sens && <Banner tone="info" icon={Lock} title="Sensitive content is redacted">The {ROLE_LABEL[me.role]} role cannot view sensitive evidence; only metadata is shown.</Banner>}
      <Table cols={cols} rows={evs} rowKey={(e) => e.id} empty={<Empty title="No evidence yet">Evidence is attached from operation steps or when creating a finding.</Empty>} />
    </>
  )
}

function AuditTab({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const me = useMe()
  const list = ds.audit.filter((a) => a.projectId === p.id)
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

/* ───────────── AI Plans and C2 Sessions (ticket 23: typed aggregate slices) ───────────── */
function PlansTab({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const guard = useGuard(p.id)
  const plans = ds.plans.filter((x) => x.projectId === p.id)
  return (
    <div className="space-y-5">
      <FilterBar right={<Button variant="primary" icon={Plus} disabled={guard.ro} title={guard.ro ? guard.reason : 'Drafts can be saved even before the ROE is approved'} onClick={() => go('ai-operator')}>Create Plan Draft</Button>}>
        <div><p className="text-sm font-medium">Plan the engagement, one OPPLAN document at a time.</p><p className="mt-1 text-xs text-muted">{plans.filter((plan) => plan.status !== 'superseded').length} current · {plans.filter((plan) => plan.status === 'in_review' || plan.status === 'proposed').length} awaiting review · {plans.filter((plan) => plan.status === 'superseded').length} earlier versions</p></div>
      </FilterBar>
      <DocumentWorkspace key={p.id} p={p} kindFilter="planning" />
    </div>
  )
}

function SessionsTab({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const list = ds.sessions.filter((x) => x.projectId === p.id)
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
