import { FanOutCard } from './g-fanout'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Ban, BarChart3, Bot, Check, FileText, GitBranch, Info, Lock, Send, ShieldCheck, Terminal, User, Cog, X } from 'lucide-react'
import { useDirty } from '../state/session'
import { useServices } from '../state/services'
import { planVer, toolFacets } from '../data'
import type { AiMode, ChatMsg, Conversation, Plan, ToolEvent } from '../data'
import { sendChat, stopChat } from '../features/demo/runtime'
import { editPlanDraftTransaction, revisePlanTransaction } from '../features/plans/service'
import { readPlanProject } from '../features/plans/bridge'
import { readActor } from '../auth/identity'
import { useMsgRefs, useToolProposalRefs, useConversationGroups } from '../features/aichat/projection'
import { useProjectEligibility, useProjectReplan } from '../features/operations/views'
import { useTraceWrites } from '../features/trace/query'
import { go, useRoute } from '../router/navigate'
import { useCan, useReadOnly } from '../state/console'
import { useAuthStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import type { ConsoleServices } from '../domain/service-factory'
import { Banner, Button, DemoTag, Field, Gated, IdLink, Modal, Status, Tabs, Textarea, cx } from '../ui'

export const MODES: { id: AiMode; label: string; hint: string }[] = [
  { id: 'observe', label: 'Observe', hint: 'Read-only. Summaries and explanations; no proposals.' },
  { id: 'propose', label: 'Propose', hint: 'Drafts plans. Nothing runs until a reviewer approves.' },
  { id: 'execution', label: 'Approved Execution', hint: 'Runs only approved plans after preflight and confirmation.' },
]
export const STARTERS = ['Summarize the approved scope', 'Review agent readiness', 'Propose a validation plan', 'Explain recent operation results']

/* Ticket 67 wave 7: the store's request context (actorCtx), mirrored — the
   persona resolves at call time through the identity service (the
   override-aware `me`, read from the authorities so a failing authority read
   never reaches this render) with corr 'legacy'. */
function actorCtxOf(services: ConsoleServices, projectId: string) {
  return { actor: readActor(services, useAuthStore.getState().meName), projectId, corr: 'legacy' }
}

/** Ensure a timestamp always carries the (UTC+7) label. */
export const tz = (t?: string) => (!t ? '—' : /UTC\+7/.test(t) ? t : `${t} (UTC+7)`)

const TONE_CLS = { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', bad: 'border-bad/30 bg-bad-soft text-bad', cyan: 'border-cyan/30 bg-info-soft text-cyan', neutral: 'border-line bg-subtle text-muted' }
export function Pill({ tone = 'neutral', children }: { tone?: keyof typeof TONE_CLS; children: React.ReactNode }) {
  return <span className={cx('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE_CLS[tone])}>{children}</span>
}

/** Execution eligibility — separate from the selected AI mode. */
export function EligBadge({ pid }: { pid: string }) {
  const el = useProjectEligibility(pid)
  const Icon = el.kind === 'locked' ? Lock : el.kind === 'closed' ? Ban : Check
  return <span title={el.reasons.map((r) => r.text).join('; ') || el.label}><Pill tone={el.tone}><Icon size={12} aria-hidden />Eligibility: {el.label}</Pill></span>
}

/** Failure / agent-loss detection for the running operation of a project (AI-V3-07). */
export const useReplan = useProjectReplan

export function ReplanPanel({ pid, compact }: { pid: string; compact?: boolean }) {
  const services = useServices()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const r = useProjectReplan(pid)
  if (!r) return null
  const { op, idx, step, lost, cur, pending, prev: prevOk, healthy } = r
  const revisionDraft = pending && !!cur.prevPlanId
  const planStep = idx >= 0 ? cur.steps[idx] : undefined
  const changed = lost.length ? `Replace lost agent ${lost.join(', ')} with ${healthy[0] || 'an available project agent'}` : planStep ? `Step ${planStep.id} (${planStep.name}): add operator re-check before continuing; fallback = skip and record` : 'Re-validate remaining steps'
  const create = () => {
    const changes = [changed]
    /* Ticket 67 wave 7: the legacy A.revisePlan/A.editPlan entries, mirrored —
       the plan's project binding resolves through the typed plans bridge at
       call time and the typed results bridge back to the legacy shapes (a
       refused revision leaves `id` empty and the edit refuses the same way). */
    const projectId = readPlanProject(services.authority, cur.id)
    const revised = projectId ? revisePlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), cur.id, changes, 'Created after step review / agent loss') : undefined
    const id = revised?.ok ? revised.data.planId : ''
    const base = cur.steps.map((x, i) => (i === idx ? { ...x, needsApproval: true, risk: (x.risk === 'low' ? 'medium' : x.risk) as typeof x.risk, rationale: `${x.rationale} Revised after review: operator re-check required.` } : lost.includes(x.agent) && healthy[0] ? { ...x, agent: healthy[0] } : x))
    if (projectId) editPlanDraftTransaction(services.authority, services.clock, actorCtxOf(services, projectId), id, { steps: base })
    toast(`Revision ${id} created as a draft. ${op.id} is paused until it is re-approved.`, 'warn')
  }
  const why = !can('plan') ? 'Your role cannot create plan revisions.' : ''
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm" role="status" aria-label="Replanning">
      <div className="flex flex-wrap items-center gap-2 font-semibold text-warn"><AlertTriangle size={16} aria-hidden />{step ? `${op.id} is paused — Step ${step.id} requires review.` : lost.length ? `${op.id} is paused — agent ${lost.join(', ')} is disconnected.` : `${op.id} will not resume until the revision is approved.`}<span className="text-xs font-normal text-muted">· new steps are held while review is open</span></div>
      {!compact && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div><dt className="inline font-semibold">Observed result: </dt><dd className="inline">{lost.length ? `Agent ${lost.join(', ')} is disconnected.` : step ? `${step.id} ${step.name} — ${step.output}` : 'Revision awaiting approval.'}</dd></div>
          <div><dt className="inline font-semibold">Confidence: </dt><dd className="inline">Medium — based on one agent report (AI estimate, not verified).</dd></div>
          <div><dt className="inline font-semibold">Possible next approaches: </dt><dd className="inline">retry after operator re-check; skip and record; reassign to another approved agent.</dd></div>
          <div><dt className="inline font-semibold">Changed step(s): </dt><dd className="inline">{revisionDraft ? (cur.changes || []).join('; ') || '—' : changed}</dd></div>
        </dl>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {revisionDraft ? (
          <>
            <span className="text-xs">Revision <b className="font-mono">{cur.id}</b> {planVer(cur)} is <b>{cur.status.replace('_', ' ')}</b>{prevOk ? ` (from ${prevOk.id} ${planVer(prevOk)}; approved plan unchanged)` : ''}. {op.id} will not resume until it is approved.</span>
            <Button size="sm" variant="primary" onClick={() => go('ai-plan-review', { id: cur.id })}>Review revised plan</Button>
          </>
        ) : pending ? (
          <Button size="sm" onClick={() => go('ai-plan-review', { id: cur.id })}>Review plan {cur.id}</Button>
        ) : (
          <>
            <Gated allowed={!why} reason={why}><Button size="sm" variant="primary" onClick={create}>Revise Plan</Button></Gated>
            <span className="text-xs text-muted">Creates {cur.id} {bumpLabel(cur)} as a Draft. The approved {planVer(cur)} is never edited.</span>
          </>
        )}
        <Button size="sm" onClick={() => go('operation', { id: op.id })}>Review Request</Button>
        <Button size="sm" onClick={() => go('operation', { id: op.id })}>Open Operation</Button>
      </div>
    </div>
  )
}
const bumpLabel = (p: Plan) => { const m = planVer(p).match(/^v(\d+)\.(\d+)$/); return m ? `v${m[1]}.${+m[2] + 1}` : 'next version' }

/** Banner that explains the relationship between selected AI mode and execution eligibility. */
export function ExecBanner({ conv }: { conv: Conversation }) {
  const el = useProjectEligibility(conv.projectId)
  const locked = el.kind === 'locked' || el.kind === 'closed'
  if (conv.mode === 'observe') return <div className="border-b border-cyan/30 bg-info-soft px-4 py-1.5 text-xs text-cyan">Observe mode: read-only summaries. No proposals are created.</div>
  if (!locked) {
    return conv.mode === 'execution'
      ? <div className="border-b border-ok/30 bg-ok-soft px-4 py-1.5 text-xs text-ok"><b>Eligible for approved execution</b> — {el.label}. Only approved plans run, after preflight and your confirmation. The AI never starts anything from chat.</div>
      : <div className="border-b border-warn/30 bg-warn-soft px-4 py-1.5 text-xs text-warn">Propose mode: AI output is a proposal — not executed. A reviewer must approve every plan.</div>
  }
  const first = el.reasons[0]
  return (
    <div className="border-b border-bad/30 bg-bad-soft px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 font-semibold text-bad"><Lock size={13} aria-hidden />{el.label}{conv.mode === 'execution' && <span className="font-normal text-fg">· Mode is set to Approved Execution (a preference only) — it does not unlock execution.</span>}</div>
      <ul className="mt-1.5 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <li className="flex items-center gap-1.5"><Check size={12} className="text-ok" aria-hidden />Answer questions about the project</li>
        <li className="flex items-center gap-1.5"><Check size={12} className="text-ok" aria-hidden />Draft scope and plan outlines — can be saved as Draft</li>
        <li className="flex items-center gap-1.5"><X size={12} className="text-bad" aria-hidden />Request plan approval — {first ? first.text : el.label}</li>
        <li className="flex items-center gap-1.5"><X size={12} className="text-bad" aria-hidden />Execute or start an operation — {el.label}</li>
      </ul>
      {el.reasons.length > 0 && <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">{el.reasons.map((r) => (r.to ? <button key={r.text} className="text-accent hover:underline" onClick={() => go(r.to!.page, { id: r.to!.id, tab: r.to!.tab })}>{r.text} →</button> : <span key={r.text}>{r.text}</span>))}</div>}
    </div>
  )
}

export function AiSubNav({ current }: { current: string }) {
  const route = useRoute()
  const tabs = [
    { id: 'ai-operator', label: 'Workspace' },
    { id: 'ai-trace', label: 'Tool trace' },
    { id: 'ai-history', label: 'History & provenance' },
  ]
  const val = tabs.some((t) => t.id === current) ? current : ''
  void route
  return <div className="mb-4"><Tabs tabs={tabs} value={val} onChange={(t) => go(t)} /></div>
}

export function NoProject({ compact }: { compact?: boolean }) {
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  return (
    <div role="status" className={cx('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-subtle text-center', compact ? 'p-5' : 'p-10')}>
      <Lock size={22} className="text-muted" aria-hidden />
      <div className="font-semibold">Select a project to continue</div>
      <p className="max-w-md text-sm text-muted">In All Projects view the AI can only summarize aggregate data. Select a project to build an execution plan or start a conversation.</p>
      <Button variant="primary" onClick={() => setSwitcherOpen(true)}>Select a project</Button>
    </div>
  )
}

export function PlanCard({ plan, compact }: { plan: Plan; compact?: boolean }) {
  const proposal = plan.status === 'proposed' || plan.status === 'draft'
  return (
    <div className={cx('mt-2 rounded-xl border bg-panel', proposal ? 'border-dashed border-warn/60' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <FileText size={15} className="text-accent" aria-hidden />
        <span className="font-mono text-[13px] font-semibold">{plan.id}</span>
        <span className="text-xs text-muted">{planVer(plan)}</span>
        <Status kind="plan" value={plan.status} size="sm" />
        {proposal && <span className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Proposal — not executed</span>}
      </div>
      <div className="px-3 py-2 text-sm">
        <div className="font-medium">{plan.title}</div>
        {!compact && <div className="mt-1 text-xs text-muted">{plan.steps.length} steps · {plan.assets.length} assets · {plan.agents.length} agents · {plan.roeVersion}</div>}
        {plan.status === 'in_review' && <div className="mt-1 text-xs text-warn">Waiting for approval from {plan.reviewer}.</div>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => go('ai-plan', { id: plan.id })}>View plan</Button>
          {plan.status === 'in_review' && <Button size="sm" onClick={() => go('ai-plan-review', { id: plan.id })}>Review</Button>}
        </div>
      </div>
    </div>
  )
}

/** Deep link to the trace page; the route path id highlights the event (ticket 41's router projection — the `?event=` duplicate retired in ticket 42). Written through the router module's guarded `go` — the single-writer navigation seam (ticket 61e); `go` serializes to the same `#/ai-trace/<encoded-id>` URL the raw hash write used to produce. */
export function useTraceLink() {
  return (id: string) => go('ai-trace', { id })
}

const FACET_TONE: Record<string, keyof typeof TONE_CLS> = { Allowed: 'ok', Blocked: 'bad', 'Not evaluated': 'neutral', 'Not required': 'neutral', Pending: 'warn', Approved: 'ok', Denied: 'bad', 'Not executed': 'neutral', Running: 'cyan', Executed: 'ok', Failed: 'bad', Stopped: 'neutral' }

/** Tool proposal: Proposed / Policy / Approval / Execution are four INDEPENDENT facets (Policy Allowed is not Executed). */
export function ToolProposalCard({ tool, compact }: { tool: ToolEvent; compact?: boolean }) {
  const can = useCan()
  const readOnly = useReadOnly()
  const toast = useToastStore((s) => s.toast)
  const writes = useTraceWrites()
  const trace = useTraceLink()
  const { plan, asset } = useToolProposalRefs(tool)
  const [decision, setDecision] = useState<'allowed' | 'denied' | null>(null)
  const [reason, setReason] = useState('')
  const f = toolFacets(tool)
  const canDecide = can('approvePlan') && !readOnly(tool.projectId)
  const approver = plan?.reviewer || 'Pat Kim'
  const facet = (k: string, v: string) => <span className="inline-flex items-center gap-1"><span className="text-muted">{k}</span><Pill tone={FACET_TONE[v] || 'neutral'}>{v}</Pill></span>
  const decide = (kind: 'allowed' | 'denied', note: string) => {
    void writes.decide(tool.id, kind, note).then((res) => {
      if (res.ok) {
        toast(`${tool.id} ${kind === 'allowed' ? 'allowed — Policy Allowed, not executed' : 'denied'} (recorded).`, kind === 'allowed' ? 'ok' : 'warn')
        setDecision(null); setReason('')
      } else toast(res.failure.message, 'bad')
    })
  }
  return (
    <div className={cx('mt-2 rounded-lg border px-3 py-2', tool.state === 'denied' ? 'border-bad/30 bg-panel' : 'border-line bg-subtle')}>
      <div className="flex flex-wrap items-center gap-2 text-xs"><Terminal size={13} aria-hidden /><span className="font-mono font-semibold">{tool.tool}</span><span className="font-mono text-muted">{tool.id}</span><DemoTag /></div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <Pill tone="neutral">Proposed</Pill>
        {facet('Policy', f.policy)}{facet('Approval', f.approval)}{facet('Execution', f.exec)}
      </div>
      <div className="mt-1 text-xs text-muted">Target: {tool.target}{tool.reason ? ` · ${tool.reason}` : ''}</div>
      {!compact && <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">{tool.opId && <span>Operation {tool.opId}</span>}{tool.stepId && <span>Step {tool.stepId}</span>}{tool.agentId && <span>Agent {tool.agentId}</span>}{tool.corr && <span className="font-mono">{tool.corr}</span>}</div>}
      {tool.state === 'awaiting' && (canDecide ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" onClick={() => { setReason(''); setDecision('allowed') }}>Review & allow</Button>
          <Button size="sm" variant="danger" onClick={() => { setReason(''); setDecision('denied') }}>Review & deny</Button>
        </div>
      ) : <div className="mt-2 text-xs text-warn">Pending — awaiting approval from {approver}. Only a reviewer can allow or deny tool calls.</div>)}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <button className="text-accent hover:underline" onClick={() => trace(tool.id)}>View in Trace</button>
        {asset ? <button className="text-accent hover:underline" onClick={() => go('asset', { id: asset.id })}>View Target</button> : <span className="text-muted" title="Target is not in this project's asset inventory.">View Target (unavailable)</span>}
        {tool.opId ? <button className="text-accent hover:underline" onClick={() => go('operation', { id: tool.opId })}>View Operation</button> : <span className="text-muted" title="This call is not linked to an operation.">View Operation (unavailable)</span>}
      </div>
      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === 'allowed' ? `Allow ${tool.id}` : `Deny ${tool.id}`}
        danger={decision === 'denied'}
        footer={<>
          <Button onClick={() => setDecision(null)}>Cancel</Button>
          <Button
            variant={decision === 'allowed' ? 'primary' : 'dangerSolid'}
            disabled={!reason.trim()}
            title={reason.trim() ? undefined : 'A decision reason is required.'}
            onClick={() => {
              if (!decision || !reason.trim()) return
              decide(decision, reason.trim())
            }}
          >
            {decision === 'allowed' ? 'Confirm allow' : 'Deny tool call'}
          </Button>
        </>}
      >
        <Banner tone="info" title={decision === 'allowed' ? 'This records the policy decision' : 'This blocks the proposed tool call'}>
          {decision === 'allowed'
            ? `Allowing ${tool.tool} on ${tool.target} records Policy Allowed with your reason. It does not run anything — Execution stays Not executed.`
            : `${tool.tool} on ${tool.target} stays blocked and never executed.`}
        </Banner>
        <Field label="Decision reason" required hint="Recorded in the audit trail.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this decision is appropriate…" />
        </Field>
      </Modal>
    </div>
  )
}

type CardKind = NonNullable<ChatMsg['card']>
const CARD: Record<CardKind, { label: string; icon: typeof Info; tone: keyof typeof TONE_CLS }> = {
  answer: { label: 'Answer', icon: Bot, tone: 'neutral' }, proposal: { label: 'Proposal', icon: FileText, tone: 'warn' }, revision: { label: 'Plan Revision', icon: GitBranch, tone: 'warn' },
  tool: { label: 'Tool Proposal', icon: Terminal, tone: 'cyan' }, policy: { label: 'Policy Block', icon: Ban, tone: 'bad' }, approval: { label: 'Approval Request', icon: ShieldCheck, tone: 'warn' },
  result: { label: 'Execution Result', icon: Check, tone: 'ok' }, analysis: { label: 'Analysis Summary', icon: BarChart3, tone: 'cyan' }, error: { label: 'Error', icon: AlertTriangle, tone: 'bad' },
}
const REF_ROUTE: [RegExp, string][] = [[/^OP-/, 'operation'], [/^PL-/, 'ai-plan'], [/^AG-/, 'agent'], [/^AS-/, 'asset'], [/^EV-/, 'evidence'], [/^FD-/, 'finding']]

function Msg({ m, compact }: { m: ChatMsg; compact?: boolean }) {
  const trace = useTraceLink()
  const { plan, tool } = useMsgRefs(m)
  if (m.role === 'system') return <div className="flex items-center justify-center gap-2 py-1 text-center text-xs text-muted"><Info size={12} aria-hidden />{m.text}<span>· {m.at}</span></div>
  const user = m.role === 'user'
  const kind: CardKind = m.card ?? (m.kind === 'blocked' ? 'policy' : m.kind === 'tool' ? 'tool' : m.kind === 'plan' ? (plan?.prevPlanId ? 'revision' : 'proposal') : 'answer')
  const meta = CARD[kind]
  const Icon = meta.icon
  const refs = [...new Set([m.planId, plan?.opId, ...(m.refs || [])].filter(Boolean) as string[])]
  const chip = (id: string) => { const r = REF_ROUTE.find(([re]) => re.test(id)); return <IdLink key={id} onClick={() => (r ? go(r[1], { id }) : undefined)}>{id}</IdLink> }
  return (
    <div className={cx('flex min-w-0 gap-2.5', user && 'flex-row-reverse')}>
      <div aria-hidden className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', user ? 'bg-hover text-fg' : 'bg-accent-soft text-accent')}>{user ? <User size={14} /> : <Bot size={14} />}</div>
      <div className="min-w-0 max-w-[88%]">
        <div className={cx('mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted', user && 'justify-end')}>
          <span className="font-medium text-fg">{user ? 'You' : 'Raptix AI'}</span>
          {!user && <Pill tone={meta.tone}><Icon size={11} aria-hidden />{meta.label}</Pill>}
          {!user && <span className="rounded border border-line bg-subtle px-1.5">AI-generated</span>}
          <span className="whitespace-nowrap">{m.at}</span>
        </div>
        <div className={cx('rounded-xl border px-3 py-2 text-sm', user ? 'border-line bg-hover' : kind === 'policy' || kind === 'error' ? 'border-bad/40 bg-bad-soft' : kind === 'approval' ? 'border-warn/40 bg-warn-soft' : 'border-line bg-panel')}>
          {kind === 'policy' && <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-bad"><Ban size={13} aria-hidden />Blocked by policy</div>}
          {kind === 'error' && <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-bad"><AlertTriangle size={13} aria-hidden />Step did not complete</div>}
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          {kind === 'analysis' && <p className="mt-1 text-xs text-warn">AI suggestion — not a verified finding.</p>}
          {!user && kind === 'answer' && !plan && <p className="mt-1 text-xs text-muted">Based on available project data</p>}
          {plan && <PlanCard plan={plan} compact={compact} />}
          {tool && kind === 'tool' && <ToolProposalCard tool={tool} compact={compact} />}
          {tool && kind !== 'tool' && kind !== 'policy' && (() => { const f = toolFacets(tool); return <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs"><span className="font-mono text-muted">{tool.tool}</span><Pill tone={FACET_TONE[f.policy]}>Policy {f.policy}</Pill><Pill tone={FACET_TONE[f.approval]}>Approval {f.approval}</Pill><Pill tone={FACET_TONE[f.exec]}>{f.exec}</Pill></div> })()}
          {tool && kind === 'policy' && <ToolProposalCard tool={tool} compact={compact} />}
          {kind === 'approval' && <p className="mt-1 text-xs text-muted">Approver: {plan?.reviewer || 'Pat Kim'} · Nothing runs until a reviewer decides.</p>}
          {!user && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line pt-1.5 text-[11px] text-muted">
              <span>Demo model (simulated)</span>
              <span>Sources: project record · ROE · {tool || plan ? 'agent health' : 'assets'}</span>
              {(refs.length > 0 || tool) && <span className="flex flex-wrap items-center gap-1.5">Related: {refs.map(chip)}{tool && <IdLink onClick={() => trace(tool.id)}>{tool.id}</IdLink>}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Thread({ conv, compact }: { conv: Conversation | undefined; compact?: boolean }) {
  const aiBusy = useSessionStore((s) => s.aiBusy)
  const { groups } = useConversationGroups(conv)
  const end = useRef<HTMLDivElement>(null)
  const n = conv?.messages.length
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [n, aiBusy])
  return (
    <div className="flex flex-col gap-4" role="log" aria-live="polite" aria-label="Conversation">
      {conv?.messages.map((m) => <Msg key={m.id} m={m} compact={compact} />)}
      {conv && groups.map((g) => <FanOutCard key={g.id} groupId={g.id} />)}
      {conv && aiBusy === conv.id && (
        <div className="flex items-center gap-2 text-sm text-muted" role="status"><Cog size={14} className="motion-safe:animate-spin" aria-hidden />Raptix AI is generating a response…</div>
      )}
      <div ref={end} />
    </div>
  )
}

const drafts: Record<string, string> = {}
export function Composer({ conv, suggestions = STARTERS, compact }: { conv: Conversation | undefined; suggestions?: string[]; compact?: boolean }) {
  /* Ticket 67 wave 7: the legacy A.sendChat/A.stopChat entries are the demo
     runtime's own functions (the store's one-line delegates) — the busy flag
     and the response timer behavior are identical. */
  const aiBusy = useSessionStore((s) => s.aiBusy)
  const readOnly = useReadOnly()
  const toast = useToastStore((s) => s.toast)
  const [text, setText] = useState(() => (conv ? drafts[conv.id] || '' : ''))
  // typed-but-unsent chat input counts as an unsaved draft: project/page switches ask before discarding it
  useDirty(text.trim().length > 0, () => { if (conv) drafts[conv.id] = text })
  useEffect(() => { if (conv && text === '' && drafts[conv.id] !== undefined) delete drafts[conv.id] }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  const ro = conv ? readOnly(conv.projectId) : false
  const busy = !!aiBusy
  const disabledWhy = !conv ? 'No conversation selected.' : ro ? 'This project is read-only (closed). Reopen it to continue.' : ''
  const send = (t: string) => {
    if (!conv || !t.trim() || busy || ro) return
    sendChat(conv.id, t.trim()); setText(''); delete drafts[conv.id]
  }
  return (
    <div className="sticky bottom-0 z-10 border-t border-line bg-panel pt-3">
      {conv && conv.mode === 'observe' && <p className="mb-2 flex items-center gap-1.5 text-xs text-cyan"><Info size={12} aria-hidden />Observe mode is read-only. Switch to Propose to draft a plan.</p>}
      {text.trim() && <p className="mb-1 text-xs text-warn">Unsaved draft message — leaving this page or switching project will ask before discarding it.</p>}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button key={s} disabled={!!disabledWhy || busy} title={disabledWhy || undefined} onClick={() => send(s)} className="rounded-full border border-line bg-panel px-2.5 py-1 text-xs hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50">{s}</button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor={compact ? 'copilot-input' : 'ai-input'}>Message to Raptix AI</label>
        <textarea id={compact ? 'copilot-input' : 'ai-input'} rows={compact ? 2 : 3} value={text} disabled={!!disabledWhy} title={disabledWhy || undefined}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }}
          placeholder="Ask Raptix AI about this project..." className="min-h-[44px] flex-1 resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-60" />
        <div className="flex flex-col gap-1.5">
          {!compact && <Button size="sm" onClick={() => toast('Evidence picker is not available in this demo.', 'info')}>Attach Evidence</Button>}
          {conv && aiBusy === conv.id ? <Button size="sm" variant="danger" onClick={() => { stopChat(conv.id); toast('Response generation stopped.', 'info') }}>Stop</Button>
            : <Button variant="primary" icon={Send} disabled={!text.trim() || !!disabledWhy || busy} title={busy ? 'Wait for the current response or stop it before sending another message.' : undefined} onClick={() => send(text)}>Send</Button>}
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><AlertTriangle size={12} aria-hidden />AI suggestions must be verified by a person against scope and ROE. Prompts alone never start execution.</p>
    </div>
  )
}
