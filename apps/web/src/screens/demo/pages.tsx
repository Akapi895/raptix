/**
 * Scenario launcher and workspace selection (ticket 61d).
 *
 * The semantic owners of the two OUTSIDE_SHELL public routes (`scenarios`,
 * `workspaces`; route-inventory rows 52–53). Persona selection and workspace
 * sign-in flow through the ticket-06 auth actions and the single `signIn`
 * entry; the Reset Demo State action runs the ONE authority reset chain
 * (the demo runtime's `resetDemo` → `services.reset(variant)`: Scheduler
 * clear + clock anchor restore + `authority.reset(variant)`, with the Query
 * bridge treating corr `reset` as wholesale invalidation) and cancels the
 * owned demo timers; guide launches go through the walkthrough module over
 * the canonical navigation seam (ticket 67 wave 8). These pages render their
 * own confirm/toast host (`DemoChrome`) — the shell chrome they render
 * outside of is not mounted on public routes.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { ArrowRight, Building2, ExternalLink, FlaskConical, LogIn, Play, RotateCcw, Search, Target, UserRound } from 'lucide-react'
import { USERS } from '../../domain/catalog';
import { signIn, signOut, switchPersona } from '../../demo/persona'
import { useAuthStore, useToastStore, type Toast } from '../../state/stores'
import { useSessionStore } from '../../state/session'
import { go } from '../../router/navigate'
import { resetDemo } from '../../demo/runtime'
import { Avatar, Button, Card, Input, Modal, Tabs } from '../../ui/index'
import { GUIDES, type Dest } from './guides'
import { jump, jumpSeam, launchGuide } from './launch'

const DEMOS = [
  { key: 'A', title: 'Demo A — Authorized Execution', project: 'RT-2026-014', blurb: 'Plan PL-021 to approval, preflight, live OP-014, evidence, finding FD-011, report REP-014 and closeout.', ids: ['E2E-01'] },
  { key: 'B', title: 'Demo B — Draft Guardrails', project: 'RT-2026-017', blurb: 'A draft project can save everything but cannot run: blocked preflight, blocked approval, strict isolation.', ids: ['E2E-02', 'E2E-03', 'E2E-10'] },
  { key: 'C', title: 'Demo C — Session Access', project: 'RT-2026-014', blurb: 'SS-042 and request AR-012: pending, approved for 30m, expired. Connected is separate from the grant.', ids: ['E2E-06'] },
  { key: 'D', title: 'Demo D — Incident / Stop', project: 'RT-2026-014', blurb: 'AG-009 disconnects mid-operation; Emergency Stop moves Requested, Acknowledged, Stopped (or Failed/Unknown).', ids: ['E2E-05', 'E2E-07'] },
]

/* Interaction matrix (spec section 9): source, CTA, eligible result, ineligible result, real screen. */
type MRow = [string, string, string, string, Dest, string?]
const MATRIX: MRow[] = [
  ['All Projects Command Center', 'New Operation', 'Choose a project first', 'Tooltip: Select a project', { page: 'command-center' }, 'all'],
  ['Projects', 'Create Project', 'Opens the 5-step wizard', 'Permission denied for roles without access', { page: 'project-new' }],
  ['Project Wizard', 'Save Draft', 'Saves the draft form', 'Minimal inline validation or retry', { page: 'project-new' }],
  ['Project Wizard', 'Submit for Approval', 'Creates a review request and notification', 'Focuses the unmet checklist item', { page: 'project', id: 'RT-2026-017', tab: 'scope' }, 'RT-2026-017'],
  ['Project Detail', 'Create Operation', 'Opens the draft operation wizard', 'Never locked just because the ROE is Draft', { page: 'operation-new' }, 'RT-2026-017'],
  ['Playbook', 'Use in Operation', 'Assigns an approved version', 'Not approved / incompatibility reason', { page: 'playbook', id: 'PB-001' }],
  ['AI Chat', 'Send', 'Creates a message or plan proposal', 'Never starts any command by itself', { page: 'ai-operator', id: 'CV-014-03' }, 'RT-2026-014'],
  ['AI Plan', 'Request Review', 'Goes to the approval queue', 'Validates missing scope or step details', { page: 'ai-plan', id: 'PL-021' }, 'RT-2026-014'],
  ['Reviewer', 'Approve Plan', 'Records actor, version, scope, time', 'Needs a reason and a valid role', { page: 'ai-plan-review', id: 'PL-021' }, 'RT-2026-014'],
  ['Operation', 'Run Preflight', 'Checklist and decision snapshot', 'Fails with a list of blockers', { page: 'preflight', id: 'OP-014' }, 'RT-2026-014'],
  ['Preflight', 'Start Operation', 'Opens the running operation', 'Disabled if preflight failed or expired', { page: 'preflight', id: 'OP-DRAFT-017' }, 'RT-2026-017'],
  ['Live Operation', 'Review Proposed Step', 'AI review and approval', 'Role gate: Request Review', { page: 'operation', id: 'OP-014' }, 'RT-2026-014'],
  ['Live Operation', 'Open Session', 'Session detail', 'Read-only detail without a grant', { page: 'c2-session', id: 'SS-041' }, 'RT-2026-014'],
  ['Session Detail', 'Open Console', 'Simulated console', 'Disabled with Request Access', { page: 'c2-session', id: 'SS-042' }, 'RT-2026-014'],
  ['Session Console', 'Revoke My Access', 'Grant revoked, composer disabled', 'Not applicable', { page: 'c2-console', id: 'SS-041' }, 'RT-2026-014'],
  ['Session Detail', 'Terminate Session', 'Reason, confirm and audit', 'Disabled for roles without permission', { page: 'c2-session', id: 'SS-041' }, 'RT-2026-014'],
  ['Agent Fleet', 'Request Assignment', 'Creates a review request', 'Conflict, scope or role errors inline', { page: 'agents' }, 'RT-2026-017'],
  ['Assets', 'Run Discovery (Demo)', 'Sample preview only', 'States Simulated only', { page: 'asset-new', tab: 'disc' }],
  ['Assets', 'Submit Scope Change', 'ROE revision and reviewer task', 'Never auto-approved In Scope', { page: 'asset-scope' }, 'RT-2026-014'],
  ['Operation Output', 'Create Finding Draft', 'Finding draft with evidence links', 'Missing evidence asks for more', { page: 'operation', id: 'OP-014', tab: 'results' }, 'RT-2026-014'],
  ['Finding Suggestion', 'Verify Finding', 'Reviewer workflow', 'AI text alone never confirms', { page: 'finding', id: 'FD-012' }, 'RT-2026-014'],
  ['Report Create', 'Create Draft', 'Opens the editor', 'Role or access validation', { page: 'report-new' }, 'RT-2026-014'],
  ['Report Editor', 'Submit for Review', 'Reviewer queue', 'Missing evidence or closure data', { page: 'report', id: 'REP-014' }, 'RT-2026-014'],
  ['Report Reviewer', 'Approve', 'Approved report version', 'Prevents self-approval', { page: 'report-review', id: 'REP-014' }, 'RT-2026-014'],
  ['Report Detail', 'Export', 'Simulated export record', 'No formal export before approval', { page: 'report-preview', id: 'REP-014' }, 'RT-2026-014'],
  ['Report Detail', 'Deliver', 'Handover log', 'Needs export first and permission', { page: 'report-preview', id: 'REP-014' }, 'RT-2026-014'],
  ['Project Detail', 'Close Project', 'Checklist and confirmation', 'Blocking issues with affected entities', { page: 'project', id: 'RT-2026-014', tab: 'close' }, 'RT-2026-014'],
  ['Any live page', 'Emergency Stop', 'Impact, confirm, request, ACK states', 'Never shows fake success', { page: 'operation', id: 'OP-014' }, 'RT-2026-014'],
  ['Search', 'Click entity', 'Context-preserving navigation', 'Access denied without data leak', { page: 'command-center' }],
  ['Project Switcher', 'Change project', 'New dataset and breadcrumb', 'Warns on unsaved work; never mixes data', { page: 'projects' }],
]

/* Role matrix (spec section 10). Y do, R view, Req needs approval, - none, * only if project policy allows. */
const ROLES = ['Org Admin', 'Red Team Manager', 'Reviewer', 'Operator', 'Analyst', 'Client Viewer']
const ROLE_PERSONA = ['Dana Whitfield', 'Alex Morgan', 'Pat Kim', 'Taylor Chen', 'Riley Brooks', 'Casey Nguyen (Client)']
const RMAT: [string, string[], Dest][] = [
  ['View allowed project', ['Y', 'Y', 'Y', 'Y', 'Y', 'R'], { page: 'projects' }],
  ['Create project draft', ['Y', 'Y', '—', 'Req', '—', '—'], { page: 'project-new' }],
  ['Approve project / ROE', ['Y', 'Req', 'Y', '—', '—', '—'], { page: 'tasks' }],
  ['Create AI plan draft', ['Y', 'Y', 'R', 'Y', 'Req', '—'], { page: 'ai-operator' }],
  ['Approve AI plan', ['Y', 'Req', 'Y', '—', '—', '—'], { page: 'ai-plan-review', id: 'PL-021' }],
  ['Run approved operation', ['Y', 'Y*', '—', 'Y*', '—', '—'], { page: 'preflight', id: 'OP-014' }],
  ['View live operation', ['Y', 'Y', 'R', 'Y', 'R', 'Restricted'], { page: 'operation', id: 'OP-014' }],
  ['Request session access', ['Y', 'Y', 'R', 'Req', 'Req', '—'], { page: 'c2-session', id: 'SS-042' }],
  ['Approve session access', ['Y', 'Y*', 'Y*', '—', '—', '—'], { page: 'c2', tab: 'requests' }],
  ['Interact with approved demo console', ['Y*', 'Y*', '—', 'Y*', 'Req', '—'], { page: 'c2-console', id: 'SS-041' }],
  ['Review / confirm finding', ['Y', 'Req', 'Y', 'Req', 'Req', 'R'], { page: 'finding', id: 'FD-011' }],
  ['Approve report', ['Y', 'Req', 'Y', '—', '—', '—'], { page: 'report-review', id: 'REP-014' }],
  ['Export / deliver report', ['Y*', 'Y*', 'R', '—', '—', 'R (delivered only)'], { page: 'report-preview', id: 'REP-014' }],
  ['Change org policy', ['Y', '—', '—', '—', '—', '—'], { page: 'settings', tab: 'policies' }],
  ['Emergency Stop', ['Y', 'Y', 'Y*', 'Y*', '—', '—'], { page: 'operation', id: 'OP-014' }],
]

/* State coverage (spec section 11): module headers link to the real screens. */
const MODS: [string, Dest][] = [['AI', { page: 'ai-operator' }], ['Operations', { page: 'operations' }], ['C2 / Console', { page: 'c2' }], ['Assets / Agents', { page: 'assets' }], ['Findings / Reports', { page: 'reports' }]]
const COVER: [string, string[]][] = [
  ['Populated', ['Chat + plan + trace', 'Timeline, steps, results', 'Active grants + transcript', 'Assigned and pending', 'Findings + report editor']],
  ['Empty', ['No conversation', 'No operation', 'No session', 'No asset or agent', 'No finding or report']],
  ['Loading', ['Streaming / skeleton', 'Receiving events', 'Connecting / loading', 'Fetching fleet', 'Fetching evidence']],
  ['Pending', ['Plan approval', 'Preflight / review', 'Access requested', 'Assignment pending', 'Review requested']],
  ['Blocked', ['Policy rejects', 'ROE / time / scope fail', 'Unauthorized access', 'Out of scope', 'No verified source']],
  ['Error', ['Model / tool unavailable', 'Agent gateway failure', 'Channel disconnect', 'Import row error', 'Upload / export failure']],
  ['Paused / Revoked', ['AI step paused', 'Operation paused', 'Grant revoked', 'Reservation released', 'Report returned']],
  ['Completed', ['Plan outcome recorded', 'Operation finished', 'Session ended', 'Asset approval final', 'Finding confirmed / report delivered']],
]

/* Acceptance criteria (V3.1). Status is deliberately conservative: nothing here was verified by automated or manual click-testing. */
type AStat = 'Prototype-simulated' | 'Not click-tested'
const ACCEPT: [string, string, AStat, string, Dest][] = [
  ['Header fits at 1280/1440/1728/1920 with no whole-header scroll; Emergency Stop and contact never clipped', 'Layout', 'Not click-tested', 'Viewport widths were not checked in a browser.', { page: 'command-center' }],
  ['Project header groups Main, Activity and Safety, and each item is clickable', 'Shell', 'Not click-tested', 'Navigation targets exist; behavior not click-verified.', { page: 'project', id: 'RT-2026-014', tab: 'overview' }],
  ['Default AI Mode affects new conversations only; Conversation Mode, Execution Eligibility and Operation Runtime State are separate', 'AI', 'Prototype-simulated', 'Four concepts are modeled in the UI; no backend.', { page: 'ai-operator', id: 'CV-014-03' }],
  ['A prompt never triggers execution in any mode', 'AI', 'Prototype-simulated', 'Chat only creates demo messages and plan proposals.', { page: 'ai-operator', id: 'CV-014-03' }],
  ['AI workspace panes resize, persist and collapse responsively', 'AI', 'Not click-tested', 'Drag, keyboard and breakpoint behavior not verified.', { page: 'ai-operator', id: 'CV-014-03' }],
  ['Message cards keep Policy, Approval and Execution as independent states', 'AI', 'Prototype-simulated', 'Derived from toolFacets on demo data.', { page: 'ai-trace', id: 'TL-03' }],
  ['Left rail Needs Review splits awaiting me vs other reviewer by persona', 'AI', 'Not click-tested', 'Persona switching not exercised end to end.', { page: 'ai-operator' }],
  ['Allocation counts: Total 5, Connected 4, Busy 2, Available 2, Disconnected 1; Connected is not Available', 'Agents', 'Prototype-simulated', 'Computed from one store source on demo data.', { page: 'agents' }],
  ['Disconnected agents show stale data and are never Available or auto-assigned', 'Agents', 'Prototype-simulated', 'Use workflow F to see the effect.', { page: 'agent', id: 'AG-009' }],
  ['Fan-out graph and table show branches, fan-in and Partially Completed; failed branch never means success', 'Fan-out', 'Prototype-simulated', 'Depends on the fan-out screen being fully built; not click-tested.', { page: 'ai-fanout', id: 'BG-014-01' }],
  ['Branch Inspector supports retry, reassign and cancel with reasons; none bypass approval or preflight', 'Fan-out', 'Prototype-simulated', 'Actions set approval to pending in demo data only.', { page: 'ai-branch', id: 'BR-014-03' }],
  ['No fake progress or ETA: progress shows only when measured, otherwise Unknown', 'Fan-out', 'Not click-tested', 'Not verified on every branch state.', { page: 'ai-fanout', id: 'BG-014-01' }],
  ['AI workers are shown separately from execution agents', 'Fan-out', 'Prototype-simulated', 'Separate demo records and views.', { page: 'ai-operator', id: 'CV-014-03' }],
  ['Tool Trace offers Table, Timeline, By Agent, By Branch and By Plan Step views with consistent counts', 'Trace', 'Not click-tested', 'Count consistency not verified across all filters.', { page: 'ai-trace' }],
  ['?event deep link highlights and opens the Tool Event Inspector', 'Trace', 'Not click-tested', 'Workflows link with the event as the route id.', { page: 'ai-trace', id: 'TL-04' }],
  ['Policy-blocked event (TL-04) reads Blocked and Not Executed with a reason', 'Trace', 'Prototype-simulated', 'Seed data; no real policy engine.', { page: 'ai-trace', id: 'TL-04' }],
  ['Plan lifecycle: draft, request approval, reviewer decision with reason, immutable approved versions', 'Plans', 'Prototype-simulated', 'Reviewer rules are simulated in the UI.', { page: 'ai-plan-review', id: 'PL-021' }],
  ['Plan revision (v1.3) never replaces the plan an operation uses and needs re-approval', 'Plans', 'Not click-tested', 'Revision flow not verified end to end.', { page: 'ai-plan', id: 'PL-021' }],
  ['AI History shows plans, conversations and AI audit with a correlation ID', 'History', 'Not click-tested', 'Drawers and export not verified.', { page: 'ai-history' }],
  ['Operation Workspace shows linked plan, conversation, branch group and one banner; runtime state Paused when a step is in review', 'Operations', 'Not click-tested', 'Owned by another screen; not verified here.', { page: 'operation', id: 'OP-014' }],
  ['Failed or unknown steps and branches never show operation success', 'Operations', 'Prototype-simulated', 'Demo state machine only.', { page: 'operation', id: 'OP-014' }],
  ['Assets: Pending Review never becomes In Scope automatically; scope status explains the ROE version', 'Assets', 'Prototype-simulated', 'Review workflow is simulated.', { page: 'assets' }],
  ['AI suggestion FD-012 is not a verified finding and is excluded from reports', 'Findings', 'Prototype-simulated', 'Counts derived from demo finding status.', { page: 'finding', id: 'FD-012' }],
  ['Strict project isolation; All Projects is read-only', 'Isolation', 'Not click-tested', 'Cross-project leaks not exhaustively checked.', { page: 'projects' }],
  ['Every control has a behavior or a disabled state with a reason; no dead controls; all strings English; times shown as UTC+7', 'Global', 'Not click-tested', 'No full sweep of all controls was performed. Treat as open.', { page: 'states' }],
]
const WFS = ['WF-A', 'WF-B', 'WF-C', 'WF-D', 'WF-E', 'WF-F', 'WF-G']

const ORGS = [
  { name: 'Acme Security — Raptix Workspace', role: 'Red Team Manager', last: 'Last used today', projects: 4, tz: 'UTC+07:00', badge: 'Primary' },
  { name: 'Acme Security — Purple Team Lab', role: 'Reviewer', last: 'Last used 3 days ago', projects: 1, tz: 'UTC+07:00', badge: 'Lab' },
  { name: 'Northwind Bank — Client Portal (Demo)', role: 'Viewer', last: 'Last used 2 weeks ago', projects: 1, tz: 'UTC+00:00', badge: 'Client' },
]

// eslint-disable-next-line react-refresh/only-export-components -- demo route bundle: sub-screens co-exported for the registry
function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-bold text-white">R</div>
      <div className="leading-tight"><div className="font-semibold tracking-wide">RAPTIX</div><div className="text-xs text-muted">Authorized security automation</div></div>
    </div>
  )
}

const th = 'whitespace-nowrap border-b border-line bg-side px-3 py-2 text-left text-xs font-semibold text-muted'
const td = 'border-b border-line px-3 py-2 align-top text-[13px]'

/** Confirm + toast host for the public pages (the shell chrome is not mounted on OUTSIDE_SHELL routes). */
// eslint-disable-next-line react-refresh/only-export-components -- demo route bundle: sub-screens co-exported for the registry
function DemoChrome() {
  const confirmState = useSessionStore((s) => s.confirmState)
  const closeConfirm = useSessionStore((s) => s.closeConfirm)
  const toasts = useToastStore((s) => s.toasts)
  return (
    <>
      <Modal
        open={!!confirmState} onClose={closeConfirm} title={confirmState?.title} danger={confirmState?.danger}
        footer={confirmState && (
          <>
            <Button variant="ghost" onClick={closeConfirm}>{confirmState.cancelLabel || 'Cancel'}</Button>
            <Button variant={confirmState.danger ? 'destructive' : 'primary'} onClick={() => { const f = confirmState.onConfirm; closeConfirm(); f('') }}>{confirmState.confirmLabel}</Button>
          </>
        )}
      >
        {confirmState && <div className="space-y-4"><div className="text-muted">{confirmState.body}</div><p className="text-xs text-neutral">This action is recorded in the audit log.</p></div>}
      </Modal>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t: Toast) => (
          <div key={t.id} className={'pointer-events-auto flex items-start gap-2 rounded-xl border bg-panel px-4 py-3 text-sm shadow-xl ' + ({ ok: 'border-ok/50', warn: 'border-warn/50', bad: 'border-bad/50', info: 'border-cyan/50' } as const)[t.kind]}>
            <span className={'mt-0.5 font-semibold ' + ({ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-cyan' } as const)[t.kind]} aria-hidden>{t.kind === 'ok' ? '✓' : t.kind === 'info' ? 'ℹ' : '!'}</span>{t.text}
          </div>
        ))}
      </div>
    </>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- demo route bundle: sub-screens co-exported for the registry
function ScenariosPage() {
  const meName = useAuthStore((s) => s.meName)
  const authed = useAuthStore((s) => s.authed)
  const toastFn = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  /* Ticket 67 wave 8: the walkthrough seam over the canonical authorities; the
     delayed jump navigate is scoped to this page's mount. */
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const getS = jumpSeam(() => alive.current)
  const [tab, setTab] = useState('scenarios')
  const persona = USERS.find((u) => u.name === meName)

  const reset = () => confirm({
    title: 'Reset Demo State', confirmLabel: 'Reset Demo State', danger: true,
    body: 'All changes made in this prototype session are discarded and the default dataset is restored. This only affects demo data.',
    onConfirm: () => { resetDemo('default') },
  })
  const open = (to: Dest, pid?: string, who?: string) => { jump(getS, to, who, pid) }
  const Link = ({ to, pid, label = 'Open screen' }: { to: Dest; pid?: string; label?: string }) => (
    <button className="inline-flex items-center gap-1 whitespace-nowrap text-accent hover:underline" onClick={() => open(to, pid)}>{label}<ExternalLink size={12} aria-hidden /></button>
  )
  const start = (id: string) => launchGuide(getS, id)

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-3">
          <Brand />
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-side px-2.5 py-1 text-xs text-muted"><FlaskConical size={13} aria-hidden />Prototype only · Demo data</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              <UserRound size={15} aria-hidden />Persona
              <select aria-label="Persona" value={meName} onChange={(e) => { switchPersona(e.target.value); toastFn(`Persona set to ${e.target.value}.`, 'info') }} className="h-9 rounded-md border border-line bg-panel px-2 text-sm text-fg">
                {USERS.map((u) => <option key={u.name} value={u.name}>{u.name} ({u.role})</option>)}
              </select>
            </label>
            <Button icon={RotateCcw} onClick={reset}>Reset Demo State</Button>
            <Button variant="primary" icon={LogIn} onClick={() => { signIn(meName); go('command-center'); toastFn(`Entered the app as ${meName}.`, 'info') }}>Enter app</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">Prototype Home</h1>
          <p className="mt-1 text-lg text-muted">Choose a demo or scenario</p>
          <p className="mt-3 text-sm text-muted">Each launcher sets the persona and project, opens the first screen and shows a Demo walkthrough panel (bottom-left). Everything is a simulation on synthetic data; times are Asia/Ho_Chi_Minh (UTC+7). {authed ? 'Signed in' : 'Not signed in'} as <b className="text-fg">{meName}</b>{persona ? ` (${persona.role})` : ''}.</p>
        </div>

        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'scenarios', label: 'Scenarios' }, { id: 'matrix', label: 'Interaction matrix' }, { id: 'roles', label: 'Role matrix' }, { id: 'states', label: 'State coverage' }, { id: 'accept', label: 'Acceptance checklist' }]} />

        {tab === 'scenarios' && (
          <div className="mt-6 space-y-8">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {DEMOS.map((d) => (
                <Card key={d.key} className="flex flex-col" pad={false}>
                  <div className="flex flex-1 flex-col gap-2 p-5">
                    <h2 className="text-base font-semibold leading-snug">{d.title}</h2>
                    <div className="flex items-center gap-2 text-sm text-muted"><Target size={15} aria-hidden /><span className="font-mono text-fg">{d.project}</span></div>
                    <p className="text-[13px] text-muted">{d.blurb}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-line p-4">
                    {d.ids.map((id, i) => <Button key={id} variant={i === 0 ? 'primary' : 'secondary'} className={d.ids.length === 1 ? 'w-full' : ''} icon={Play} onClick={() => start(id)}>{d.ids.length === 1 ? `Start ${id}` : id}</Button>)}
                  </div>
                </Card>
              ))}
            </div>

            <section>
              <h2 className="mb-1 text-lg font-semibold">AI Operator workflows A–G</h2>
              <p className="mb-3 text-sm text-muted">Guided, clickable flows for the multi-agent AI workspace. Each step opens a real screen; steps marked Simulated action only change demo data (reset with Reset Demo State).</p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {GUIDES.filter((g) => WFS.includes(g.id)).map((g) => (
                  <Card key={g.id} pad={false} className="flex flex-col">
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <h3 className="text-base font-semibold leading-snug">{g.title}</h3>
                      <p className="text-[13px] text-muted">{g.goal}</p>
                      <ol className="mt-1 space-y-1 text-[13px]">
                        {g.steps.map((st, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="w-4 shrink-0 text-right text-xs text-muted">{i + 1}.</span>
                            <button className="text-left text-accent hover:underline" onClick={() => launchGuide(getS, g.id, i)}>{st.t}</button>
                            {st.run && <span className="whitespace-nowrap rounded-full border border-line bg-side px-1.5 text-[10px] text-muted">Simulated action</span>}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-1 text-xs text-muted"><b className="text-fg">Expected:</b> {g.expected}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-line p-4">
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted"><Avatar name={g.persona} size={20} />{g.persona}</span>
                      <Button variant="primary" icon={Play} onClick={() => start(g.id)}>Start {g.id.slice(3)}</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold">All end-to-end scenarios (E2E-01 to E2E-11)</h2>
              <div className="overflow-x-auto rounded-lg border border-line bg-panel">
                <table className="w-full min-w-[920px] border-collapse">
                  <thead><tr><th className={th}>ID</th><th className={th}>Goal</th><th className={th}>Persona</th><th className={th}>Start</th><th className={th}>Expected result</th></tr></thead>
                  <tbody>
                    {GUIDES.filter((g) => g.id.startsWith('E2E')).map((g) => (
                      <tr key={g.id}>
                        <td className={td}><span className="whitespace-nowrap rounded-md bg-accent-soft px-2 py-0.5 font-mono text-xs font-semibold text-accent">{g.id}</span></td>
                        <td className={td}><div className="font-medium">{g.title}</div><div className="text-muted">{g.goal}</div><div className="mt-1 text-xs text-muted">{g.steps.length} guided steps · {g.pid === 'all' ? 'All Projects' : g.pid}</div></td>
                        <td className={td}><span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={g.persona} size={22} />{g.persona}</span></td>
                        <td className={td}><Button size="sm" variant="primary" icon={Play} onClick={() => start(g.id)}>Start {g.id}</Button></td>
                        <td className={td + ' text-muted'}>{g.expected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {tab === 'matrix' && (
          <div className="mt-6">
            <p className="mb-3 text-sm text-muted">Every primary CTA and what happens when conditions are or are not met. Open screen jumps to the real screen in the right project.</p>
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full min-w-[900px] border-collapse">
                <thead><tr><th className={th}>Source</th><th className={th}>CTA / interaction</th><th className={th}>If eligible</th><th className={th}>If not eligible</th><th className={th}>Screen</th></tr></thead>
                <tbody>{MATRIX.map((r, i) => (
                  <tr key={i}><td className={td}>{r[0]}</td><td className={td + ' font-medium'}>{r[1]}</td><td className={td}>{r[2]}</td><td className={td + ' text-muted'}>{r[3]}</td><td className={td}><Link to={r[4]} pid={r[5]} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'roles' && (
          <div className="mt-6">
            <p className="mb-3 text-sm text-muted">UX proposal for the demo; real permissions come from the backend. Y = can do, R = view, Req = needs approval, — = no access, * = only when project policy or approval allows. Requesting and performing are separate rights. Click a role to switch persona.</p>
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full min-w-[900px] border-collapse">
                <thead><tr>
                  <th className={th}>Action</th>
                  {ROLES.map((r, i) => <th key={r} className={th + ' text-center'}><button className="hover:text-accent hover:underline" title={`Switch persona to ${ROLE_PERSONA[i]}`} onClick={() => { switchPersona(ROLE_PERSONA[i]); toastFn(`Persona set to ${ROLE_PERSONA[i]}.`, 'info') }}>{r}</button></th>)}
                  <th className={th}>Screen</th>
                </tr></thead>
                <tbody>{RMAT.map(([a, v, to]) => (
                  <tr key={a}><td className={td + ' font-medium'}>{a}</td>{v.map((c, i) => <td key={i} className={td + ' text-center ' + (c === '—' ? 'text-muted' : c.startsWith('Y') ? 'font-semibold text-ok' : '')}>{c}</td>)}<td className={td}><Link to={to} pid={to.id ? (to.id.includes('017') ? 'RT-2026-017' : 'RT-2026-014') : undefined} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'states' && (
          <div className="mt-6">
            <p className="mb-3 text-sm text-muted">Each hero module must show these states. Module headings open the live screen; the State gallery shows the shared empty, loading, error and denied variants.</p>
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full min-w-[900px] border-collapse">
                <thead><tr><th className={th}>State</th>{MODS.map(([m, to]) => <th key={m} className={th}><Link to={to} pid="RT-2026-014" label={m} /></th>)}</tr></thead>
                <tbody>{COVER.map(([st, cells]) => <tr key={st}><td className={td + ' font-medium'}>{st}</td>{cells.map((c, i) => <td key={i} className={td + ' text-muted'}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-4 text-sm"><Link to={{ page: 'states' }} label="Open State gallery" /><Link to={{ page: 'forbidden' }} label="Access denied" /><Link to={{ page: 'offline' }} label="Offline" /><Link to={{ page: 'error' }} label="Server error" /></div>
          </div>
        )}
        {tab === 'accept' && (
          <div className="mt-6">
            <p className="mb-3 max-w-3xl text-sm text-muted">25 acceptance criteria for the V3.1 upgrade. Status is deliberately conservative: <b className="text-fg">Prototype-simulated</b> means the behavior exists as a front-end simulation on demo data with no backend enforcement; <b className="text-fg">Not click-tested</b> means it has not been verified by hand or by automated tests. Nothing here is signed off.</p>
            <div className="mb-3 flex flex-wrap gap-3 text-sm text-muted">
              <span>{ACCEPT.filter((a) => a[2] === 'Prototype-simulated').length} Prototype-simulated</span>
              <span>{ACCEPT.filter((a) => a[2] === 'Not click-tested').length} Not click-tested</span>
              <span>{ACCEPT.length} total</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full min-w-[960px] border-collapse">
                <thead><tr><th className={th}>#</th><th className={th}>Criterion</th><th className={th}>Area</th><th className={th}>Status</th><th className={th}>Note</th><th className={th}>Screen</th></tr></thead>
                <tbody>{ACCEPT.map((a, i) => (
                  <tr key={i}>
                    <td className={td + ' whitespace-nowrap font-mono text-xs'}>AC-{String(i + 1).padStart(2, '0')}</td>
                    <td className={td}>{a[0]}</td>
                    <td className={td + ' whitespace-nowrap text-muted'}>{a[1]}</td>
                    <td className={td}><span className={'whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ' + (a[2] === 'Not click-tested' ? 'border-line bg-side text-muted' : 'border-accent-line bg-accent-soft text-accent')}>{a[2]}</span></td>
                    <td className={td + ' text-muted'}>{a[3]}</td>
                    <td className={td}><Link to={a[4]} pid="RT-2026-014" /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      <DemoChrome />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- demo route bundle: sub-screens co-exported for the registry
function WorkspacesPage() {
  const meName = useAuthStore((s) => s.meName)
  const toast = useToastStore((s) => s.toast)
  const [q, setQ] = useState('')
  const rows = ORGS.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
  const open = (name: string) => { signIn(meName, name); toast(`Opened workspace ${name}.`, 'ok'); go('command-center') }
  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-6 py-12 text-fg">
      <div className="w-full max-w-2xl">
        <Brand />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Select a workspace</h1>
        <p className="mt-1 text-sm text-muted">Signed in as <b className="text-fg">{meName}</b>. Choose where to continue.</p>
        <div className="relative mt-5">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Search workspaces" placeholder="Search workspaces" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="mt-4 space-y-3">
          {rows.map((o) => (
            <li key={o.name}>
              <Card className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Building2 size={20} aria-hidden /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{o.name}</span><span className="rounded-full border border-line bg-side px-2 py-0.5 text-[11px] text-muted">{o.badge}</span></div>
                  <div className="mt-0.5 text-xs text-muted">{o.role} · {o.projects} project{o.projects === 1 ? '' : 's'} · {o.tz} · {o.last}</div>
                </div>
                <Button variant="primary" icon={ArrowRight} onClick={() => open(o.name)}>Open Workspace</Button>
              </Card>
            </li>
          ))}
          {rows.length === 0 && <li className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">No workspaces match your search.</li>}
        </ul>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button className="text-muted hover:text-fg" onClick={() => { signOut(); go('login') }}>Sign out</button>
          <button className="text-accent hover:underline" onClick={() => go('scenarios')}>Prototype Home</button>
        </div>
      </div>
      <DemoChrome />
    </div>
  )
}

export const routes: Record<string, ComponentType> = { scenarios: ScenariosPage, workspaces: WorkspacesPage }
