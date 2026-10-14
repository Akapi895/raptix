import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Bot, FileText, MessageSquare, Pin, PinOff, Plus, ShieldCheck } from 'lucide-react'
import { useServices } from '../state/services'
import { planVer } from '../data'
import type { Conversation } from '../data'
import { createChatHandlers } from '../features/aichat/handlers'
import { useAiBundle, useAiRail, useConversationFocus } from '../features/aichat/projection'
import { useProjectEligibility } from '../features/operations/views'
import { go } from '../router/navigate'
import { useCan, useMe, useReadOnly } from '../state/console'
import { useUiStore } from '../state/stores'
import { Button, DemoTag, IdLink, Status, cx } from '../ui'
import { EligBadge, ExecBanner, MODES, Pill, ReplanPanel, useReplan, useTraceLink } from './g-common'
import { AllocationView, FanOutCard } from './g-fanout'
import { WorkerTeamView } from './g-workers'

/* ───────────── Resizable panes ───────────── */
export const RAIL = { def: 280, min: 220, max: 380 }
export const INSP = { def: 360, min: 280, max: 520 }
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const readLS = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }
const writeLS = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* storage unavailable */ } }
const moveChoice = (e: ReactKeyboardEvent<HTMLButtonElement>, role: 'tab' | 'radio') => {
  const verticalKeys = role === 'radio' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
  if (!verticalKeys && !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const buttons = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(`[role="${role}"]:not([disabled])`) || [])
  if (!buttons.length) return
  e.preventDefault()
  const current = buttons.indexOf(e.currentTarget)
  const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (forward ? 1 : -1) + buttons.length) % buttons.length
  buttons[next].focus()
  buttons[next].click()
}

export function useViewportW() {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return w
}

/** Persisted pane width: live while dragging, written to localStorage on release, reset to default on double-click. */
export function useResizable(key: string, cfg: { def: number; min: number; max: number }) {
  const [w, setW] = useState(() => { const n = Number(readLS(key)); return n ? clamp(n, cfg.min, cfg.max) : cfg.def })
  const ref = useRef(w)
  ref.current = w
  const live = useCallback((n: number) => setW(clamp(n, cfg.min, cfg.max)), [cfg.min, cfg.max])
  const commit = useCallback(() => writeLS(key, String(ref.current)), [key])
  const reset = useCallback(() => { setW(cfg.def); writeLS(key, String(cfg.def)) }, [key, cfg.def])
  return { w, live, commit, reset }
}

/** side='left': separator sits to the right of the pane it resizes (pane grows when dragged right). side='right': pane is to the right of the separator. */
export function Separator({ label, side, r, cfg }: { label: string; side: 'left' | 'right'; r: ReturnType<typeof useResizable>; cfg: { min: number; max: number } }) {
  const [drag, setDrag] = useState(false)
  const start = useRef({ x: 0, w: 0 })
  const dir = side === 'left' ? 1 : -1
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={r.w} aria-valuetext={`${r.w} pixels`} aria-valuemin={cfg.min} aria-valuemax={cfg.max} tabIndex={0}
      title="Drag to resize. Double-click to reset. Arrow keys also resize."
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, w: r.w }; setDrag(true) }}
      onPointerMove={(e) => { if (drag) r.live(start.current.w + dir * (e.clientX - start.current.x)) }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDrag(false); r.commit() }}
      onPointerCancel={() => { setDrag(false); r.commit() }}
      onDoubleClick={r.reset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); r.live(r.w + dir * (e.key === 'ArrowRight' ? 16 : -16)) }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); r.live(e.key === 'Home' ? cfg.min : cfg.max) }
      }}
      onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') r.commit() }}
      className={cx('group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none', drag ? 'bg-accent-soft' : 'hover:bg-accent-soft focus-visible:bg-accent-soft')}>
      <span aria-hidden className={cx('absolute left-1/2 top-0 h-full w-px -translate-x-1/2', drag ? 'bg-accent' : 'bg-line group-hover:bg-accent group-focus-visible:bg-accent')} />
    </div>
  )
}

/* ───────────── Left rail ───────────── */
type RailTab = 'all' | 'conv' | 'plans' | 'review'
interface RailItem { key: string; kind: 'conv' | 'plan' | 'tool'; title: string; id: string; owner: string; updated: string; status: ReactNode; op?: string; unread: boolean; pinned?: boolean; convId?: string; selected?: boolean; open: () => void; mine?: boolean; approver?: string }
const opened = new Set<string>()
const seenN: Record<string, number> = {}

export function LeftRail({ pid, selId, onNew, onPicked }: { pid: string; selId?: string; onNew: () => void; onPicked?: () => void }) {
  const me = useMe()
  const can = useCan()
  const services = useServices()
  const readOnly = useReadOnly()
  const aiMode = useUiStore((s) => s.aiMode)
  const rail = useAiRail(pid)
  /* Ticket 67 wave 7: the legacy A.togglePinConv entry, mirrored — the same
     per-call typed chat-handler bridge with the override-aware persona. */
  const togglePinConv = (convId: string) => { createChatHandlers(services, { id: me.name, role: me.role }, 'all').setPinned(convId) }
  const [tab, setTab] = useState<RailTab>('all')
  const ro = readOnly(pid)
  if (selId) { opened.add(selId); seenN[selId] = rail.conversations.find((c) => c.id === selId)?.messages.length ?? 0 }
  const convs = rail.conversations
  const plans = rail.plans
  const awaiting = rail.awaitingTools
  const attention = (c: Conversation) => awaiting.some((t) => t.conversationId === c.id) || c.messages.some((m) => m.planId && plans.find((p) => p.id === m.planId)?.status === 'in_review')
  const convItems: RailItem[] = convs.map((c) => ({
    key: c.id, kind: 'conv', title: c.title, id: c.id, owner: c.owner, updated: c.updated, pinned: c.pinned, convId: c.id, selected: c.id === selId,
    status: <Pill tone={c.mode === 'execution' ? 'ok' : c.mode === 'propose' ? 'warn' : 'cyan'}>{MODES.find((m) => m.id === c.mode)?.label}</Pill>,
    op: plans.find((p) => c.messages.some((m) => m.planId === p.id) && p.opId)?.opId,
    unread: c.id !== selId && ((!opened.has(c.id) && attention(c)) || c.messages.length > (seenN[c.id] ?? c.messages.length)),
    open: () => { go('ai-operator', { id: c.id }); onPicked?.() },
  }))
  const planItems: RailItem[] = plans.map((p) => ({
    key: p.id, kind: 'plan', title: p.title, id: p.id, owner: p.author, updated: p.updated, op: p.opId, unread: false,
    status: <span className="inline-flex items-center gap-1"><span className="text-[11px] text-muted">{planVer(p)}</span><Status kind="plan" value={p.status} size="sm" /></span>,
    open: () => { go(p.status === 'in_review' ? 'ai-plan-review' : 'ai-plan', { id: p.id }); onPicked?.() },
  }))
  const reviewPlans: RailItem[] = plans.filter((p) => p.status === 'in_review').map((p) => ({ ...planItems.find((x) => x.id === p.id)!, key: 'rv-' + p.id, mine: p.reviewer === me.name, approver: p.reviewer, unread: p.reviewer === me.name }))
  const reviewTools: RailItem[] = awaiting.map((t) => {
    const pl = t.planId ? plans.find((p) => p.id === t.planId) : undefined
    const approver = pl?.reviewer || 'Reviewer'
    const mine = can('approvePlan') && (!pl || pl.reviewer === me.name || me.role === 'reviewer')
    return { key: 'tl-' + t.id, kind: 'tool', title: `Tool approval · ${t.tool}`, id: t.id, owner: t.target, updated: t.at, op: t.opId, unread: mine, mine, approver, status: <Pill tone="warn">Approval Pending</Pill>, open: () => { go('ai-operator', { id: t.conversationId }); onPicked?.() } }
  })
  const review = [...reviewPlans, ...reviewTools]
  const mineR = review.filter((x) => x.mine), otherR = review.filter((x) => !x.mine)
  const all = [...convItems.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)), ...planItems, ...reviewTools]
  const tabs: { id: RailTab; label: string; n: number }[] = [{ id: 'all', label: 'All', n: all.length }, { id: 'conv', label: 'Conversations', n: convItems.length }, { id: 'plans', label: 'Plans', n: planItems.length }, { id: 'review', label: 'Needs Review', n: review.length }]
  const row = (it: RailItem) => {
    const Icon = it.kind === 'conv' ? MessageSquare : it.kind === 'plan' ? FileText : ShieldCheck
    return (
      <li key={it.key} className="relative">
        <button onClick={it.open} aria-current={it.selected || undefined} className={cx('w-full min-w-0 rounded-lg px-2.5 py-2 pr-9 text-left hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent', it.selected && 'bg-accent-soft')}>
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium"><Icon size={13} className="shrink-0 text-muted" aria-hidden />{it.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" role="img" aria-label="Unread activity" />}<span className="truncate">{it.title}</span></div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted"><span className="whitespace-nowrap font-mono">{it.id}</span>{it.status}{it.op && <span className="whitespace-nowrap font-mono">{it.op}</span>}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted" title={`${it.owner} · ${it.updated}`}>{it.kind === 'tool' ? 'Target ' : ''}{it.owner} · {it.updated}</div>
          {it.approver && <div className="text-[11px] text-warn">{it.mine ? 'Awaiting your approval' : `Pending ${it.approver}`}</div>}
        </button>
        {it.kind === 'conv' && <button aria-label={it.pinned ? `Unpin ${it.title}` : `Pin ${it.title}`} aria-pressed={!!it.pinned} title={ro ? 'Project is read-only.' : it.pinned ? 'Unpin' : 'Pin'} disabled={ro} onClick={() => togglePinConv(it.convId!)} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40">{it.pinned ? <Pin size={13} className="text-accent" aria-hidden /> : <PinOff size={13} aria-hidden />}</button>}
      </li>
    )
  }
  const group = (label: string, items: RailItem[], empty: string) => (
    <li key={label}><div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{label} ({items.length})</div>{items.length === 0 ? <p className="px-2.5 pb-1 text-xs text-muted">{empty}</p> : <ul>{items.map(row)}</ul>}</li>
  )
  const list = tab === 'all' ? all : tab === 'conv' ? convItems : tab === 'plans' ? planItems : []
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-muted">Project <span className="font-mono text-fg">{pid}</span></span><Button size="sm" variant="primary" icon={Plus} disabled={ro} title={ro ? 'This project is read-only.' : `Starts an empty conversation in ${aiMode === 'execution' ? 'Approved Execution' : aiMode === 'propose' ? 'Propose' : 'Observe'} mode (Default AI Mode). Nothing runs.`} onClick={onNew}>New</Button></div>
        <div role="tablist" aria-label="Rail filter" className="flex flex-wrap gap-1">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onKeyDown={(e) => moveChoice(e, 'tab')} onClick={() => setTab(t.id)} className={cx('rounded-full border px-2 py-0.5 text-xs font-medium', tab === t.id ? 'border-accent-line bg-accent-soft text-fg' : 'border-line text-muted hover:bg-hover')}>{t.label} <span className="text-muted">{t.n}</span></button>)}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="AI workspace items">
        {tab === 'review' ? <>{group('Awaiting My Approval', mineR, 'Nothing is waiting for your approval.')}{group('Pending Other Reviewer', otherR, 'No items waiting on another reviewer.')}</>
          : list.length === 0 ? <li className="p-3 text-xs text-muted">Nothing here yet. Start a new conversation to begin.</li> : list.map(row)}
      </ul>
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">New conversations inherit the Default AI Mode. Opening an item never runs anything.</div>
    </div>
  )
}

/* ───────────── Right inspector ───────────── */
type InspTab = 'context' | 'agents' | 'operations' | 'approvals' | 'sources'
const INSP_TABS: { id: InspTab; label: string }[] = [{ id: 'context', label: 'Context' }, { id: 'agents', label: 'Agents' }, { id: 'operations', label: 'Operations' }, { id: 'approvals', label: 'Approvals' }, { id: 'sources', label: 'Sources' }]
const H = ({ children }: { children: ReactNode }) => <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{children}</div>
const Sec = ({ children }: { children: ReactNode }) => <div className="border-b border-line py-3 last:border-0">{children}</div>

export function Inspector({ pid, conv }: { pid: string; conv?: Conversation }) {
  const can = useCan()
  const trace = useTraceLink()
  const [tab, setTab] = useState<InspTab>('context')
  const db = useAiBundle(pid)
  const el = useProjectEligibility(pid)
  if (!db.project) return null
  const p = db.project
  const inScope = db.assets.filter((a) => a.scope === 'in')
  const outN = db.assets.filter((a) => a.scope === 'out').length
  const ops = db.operations
  const plans = db.plans
  const groups = db.branchGroups
  const tools = db.toolEvents
  const awaiting = tools.filter((t) => t.state === 'awaiting')
  const denied = tools.filter((t) => t.state === 'denied')
  const sreq = db.sessionRequests
  const inReview = plans.filter((x) => x.status === 'in_review')
  const evidence = db.evidence
  const agents = db.agents
  const linked = ops.filter((o) => o.id === conv?.messages.map((m) => plans.find((x) => x.id === m.planId)?.opId).find(Boolean))
  const orderedOps = [...linked, ...ops.filter((o) => !linked.includes(o))].slice(0, 6)
  const link = (label: string, fn: () => void) => <button className="text-accent hover:underline" onClick={fn}>{label}</button>
  return (
    <aside aria-label="Context inspector" className="flex h-full min-h-0 min-w-0 flex-col text-sm">
      <div role="tablist" aria-label="Inspector sections" className="no-scrollbar flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-1.5">
        {INSP_TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onKeyDown={(e) => moveChoice(e, 'tab')} onClick={() => setTab(t.id)} className={cx('-mb-px h-10 shrink-0 border-b-2 px-2 text-xs font-medium', tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>{t.label}{t.id === 'approvals' && inReview.length + awaiting.length + sreq.length > 0 ? ` (${inReview.length + awaiting.length + sreq.length})` : ''}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" role="tabpanel">
        {tab === 'context' && <>
          <Sec><H>Project</H><div className="font-medium">{p.name}</div><div className="text-xs text-muted"><span className="font-mono">{p.id}</span> · {p.client}</div>
            <div className="mt-1 text-xs">{p.roeVersion} <span className={p.roeStatus === 'approved' ? 'text-ok' : 'text-warn'}>({p.roeStatus})</span></div><div className="mt-0.5 text-xs text-muted">Window: {p.window}</div></Sec>
          <Sec><H>Execution eligibility</H><EligBadge pid={pid} />
            {el.reasons.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs">{el.reasons.map((r) => <li key={r.text} className="text-bad">{r.to ? <button className="text-left hover:underline" onClick={() => go(r.to!.page, { id: r.to!.id, tab: r.to!.tab })}>{r.text} →</button> : r.text}</li>)}</ul>}
            {conv && <div className="mt-1.5 text-xs text-muted">This conversation: <span className="font-medium text-fg">{MODES.find((m) => m.id === conv.mode)?.label}</span> (mode only; does not unlock execution)</div>}</Sec>
          <Sec><H>Scope</H><div className="text-xs">{inScope.length} approved in scope · {outN} excluded</div>
            {inScope.length === 0 ? <p className="mt-1 text-xs text-warn">No approved assets — scope must be approved before any plan can run.</p> : <ul className="mt-1.5 space-y-0.5 text-xs">{inScope.slice(0, 5).map((a) => <li key={a.id} className="flex min-w-0 justify-between gap-2"><span className="truncate">{a.name}</span><IdLink onClick={() => go('asset', { id: a.id })}>{a.id}</IdLink></li>)}</ul>}
            <div className="mt-1.5 text-xs">{link(`View All Assets (${inScope.length})`, () => go('assets'))}</div></Sec>
        </>}
        {tab === 'agents' && <>
          <Sec><H>Agent allocation</H><AllocationView projectId={pid} /></Sec>
          <Sec><H>AI Team (AI workers — not agents)</H><WorkerTeamView projectId={pid} /></Sec>
        </>}
        {tab === 'operations' && <>
          {orderedOps.length === 0 && <p className="py-3 text-xs text-muted">No operations in this project yet. Approve a plan to create one.</p>}
          {orderedOps.map((o) => {
            const bound = o.planId ? db.plans.find((x) => x.id === o.planId) : undefined
            const n = (s: string) => o.steps.filter((x) => x.status === s).length
            return (
              <Sec key={o.id}>
                <div className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('operation', { id: o.id })}>{o.id}</IdLink><Status kind="op" value={o.status} size="sm" /></div>
                <div className="text-xs text-muted">{o.name}</div>
                <div className="mt-1 text-xs">{bound ? <>Active plan: {<IdLink onClick={() => go('ai-plan', { id: bound.id })}>{bound.id}</IdLink>} {planVer(bound)} · <span className="capitalize">{bound.status.replace('_', ' ')}</span> · bound to {o.id}</> : <span className="text-muted">No plan bound to this operation</span>}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs"><Pill tone="cyan">Running {n('running')}</Pill><Pill tone="warn">Paused / review {n('review')}</Pill><Pill tone="ok">Completed {n('ok')}</Pill><Pill tone="bad">Failed {n('fail')}</Pill></div>
              </Sec>
            )
          })}
          {groups.length > 0 && <Sec><H>Branch groups</H><div className="space-y-2">{groups.map((g) => <FanOutCard key={g.id} groupId={g.id} />)}</div></Sec>}
          <div className="py-2 text-xs">{link('All operations', () => go('operations'))}</div>
        </>}
        {tab === 'approvals' && <>
          <Sec><H>Plan approvals ({inReview.length})</H>{inReview.length === 0 ? <p className="text-xs text-muted">No plans waiting for approval.</p> : inReview.map((x) => <div key={x.id} className="text-xs"><IdLink onClick={() => go('ai-plan-review', { id: x.id })}>{x.id}</IdLink> {planVer(x)} · waiting for {x.reviewer}</div>)}</Sec>
          <Sec><H>Tool approvals ({awaiting.length})</H>{awaiting.length === 0 ? <p className="text-xs text-muted">No tool calls waiting for approval.</p> : awaiting.map((t) => <div key={t.id} className="text-xs"><IdLink onClick={() => trace(t.id)}>{t.id}</IdLink> {t.tool} · {can('approvePlan') ? 'decide in the conversation' : `pending ${t.planId ? plans.find((x) => x.id === t.planId)?.reviewer || 'reviewer' : 'reviewer'}`}</div>)}</Sec>
          <Sec><H>Session approvals ({sreq.length})</H>{sreq.length === 0 ? <p className="text-xs text-muted">No session access requests pending.</p> : sreq.map((r) => <div key={r.id} className="text-xs"><IdLink onClick={() => go('c2-session', { id: r.sessionId })}>{r.id}</IdLink> {r.by} · {r.mode}</div>)}</Sec>
          <Sec><H>Blocked by policy ({denied.length})</H>{denied.length === 0 ? <p className="text-xs text-muted">Nothing has been blocked.</p> : denied.map((t) => <div key={t.id} className="text-xs"><IdLink onClick={() => trace(t.id)}>{t.id}</IdLink> {t.tool} → {t.target}<div className="text-muted">{t.reason}</div></div>)}</Sec>
        </>}
        {tab === 'sources' && <>
          <Sec><H>Sources for {pid}</H>
            <ul className="space-y-1.5 text-xs">
              <li className="flex justify-between gap-2"><span>Project record</span>{link(pid, () => go('project', { id: pid }))}</li>
              <li className="flex justify-between gap-2"><span>ROE version</span>{link(`${p.roeVersion} (${p.roeStatus})`, () => go('project', { id: pid, tab: 'scope' }))}</li>
              <li className="flex justify-between gap-2"><span>Assets</span>{link(`${db.assets.length} records`, () => go('assets'))}</li>
              <li className="flex justify-between gap-2"><span>Agents</span>{link(`${agents.length} assigned`, () => go('agents'))}</li>
              <li className="flex justify-between gap-2"><span>Operation results</span>{link(`${ops.length} operations`, () => go('operations'))}</li>
              <li className="flex justify-between gap-2"><span>Evidence</span>{link(`${evidence.length} items`, () => go('evidence'))}</li>
              <li className="flex justify-between gap-2"><span>Tool events</span>{link(`${tools.length} events`, () => go('ai-trace'))}</li>
            </ul></Sec>
          <Sec><H>Sync state</H><div className="flex items-center gap-2 text-xs"><DemoTag />Demo Data · simulated. Nothing is read from a live backend. Other projects are never included.</div></Sec>
        </>}
      </div>
    </aside>
  )
}

/* ───────────── Conversation header + single banner ───────────── */
export function ConversationHeader({ conv, onMode }: { conv: Conversation; onMode: (m: Conversation['mode']) => void }) {
  const readOnly = useReadOnly()
  const ro = readOnly(conv.projectId)
  const { plan, op } = useConversationFocus(conv)
  const cur = MODES.find((m) => m.id === conv.mode)!
  return (
    <div className="space-y-2 border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold" title={conv.title}>{conv.title}</h2>
          <div className="text-xs text-muted"><span className="whitespace-nowrap font-mono">{conv.id}</span> · Owner {conv.owner} · Updated {conv.updated}</div>
        </div>
        <div role="radiogroup" aria-label="Conversation mode" className="inline-flex rounded-lg border border-line bg-panel p-0.5">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={conv.mode === m.id} tabIndex={conv.mode === m.id ? 0 : -1} disabled={ro} title={ro ? 'Project is read-only.' : `${m.hint} Applies to this conversation only.`} onKeyDown={(e) => moveChoice(e, 'radio')} onClick={() => onMode(m.id)}
              className={cx('rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50', conv.mode === m.id ? 'bg-accent text-white' : 'text-muted hover:bg-hover hover:text-fg')}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Conversation mode: {cur.hint} Applies to this conversation only; it does not grant permission.</span>
        {plan && <button onClick={() => go('ai-plan', { id: plan.id })} className="inline-flex items-center gap-1 rounded-full border border-line bg-subtle px-2 py-0.5 hover:bg-hover"><FileText size={11} aria-hidden /><span className="font-mono">{plan.id}</span> {planVer(plan)}</button>}
        {op && <button onClick={() => go('operation', { id: op.id })} className="inline-flex items-center gap-1 rounded-full border border-line bg-subtle px-2 py-0.5 hover:bg-hover"><Bot size={11} aria-hidden /><span className="font-mono">{op.id}</span> · {op.status}</button>}
      </div>
    </div>
  )
}

/** Exactly one banner per conversation: replan/review state wins; otherwise the mode/eligibility explanation. */
export function ConvBanner({ conv }: { conv: Conversation }) {
  const r = useReplan(conv.projectId)
  if (r?.cur) return <div className="px-4 pt-3"><ReplanPanel pid={conv.projectId} compact /></div>
  return <ExecBanner conv={conv} />
}
