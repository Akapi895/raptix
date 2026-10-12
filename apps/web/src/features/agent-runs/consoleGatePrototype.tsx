// THROWAWAY PROTOTYPE — Operator Console execution-gate + chat-first briefing
// exploration. Injected by RealConsole.tsx (dev build only), removed once a
// winning variant is folded back into the real console.
// Question: "How should chat-first briefing + a hard execution gate look?"
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PlanningView, ProjectViewModel } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { encodePathSegment, requestJson } from '../../shared/api/http'

const PARAM = 'consoleVariant'
const VARIANTS = ['A', 'B', 'C'] as const
export type GateVariant = typeof VARIANTS[number]

export function isConsolePrototypeActive(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has(PARAM)
}

function readParam(): string | null {
  if (!import.meta.env.DEV) return null
  return new URLSearchParams(window.location.search).get(PARAM)
}

export function useGateVariant(): [string | null, (v: GateVariant) => void] {
  const [variant, setVariant] = useState<string | null>(() => readParam())
  useEffect(() => {
    const sync = (): void => setVariant(readParam())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  return [variant, (v) => {
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM, v)
    window.history.replaceState(null, '', url.toString())
    setVariant(v)
  }]
}

const MONO = "'JetBrains Mono', monospace"
const INK = '#0F172A'
const BODY = '#334155'
const MUTED = '#94A3B8'
const BORDER = '#E2E8F0'
const PAGE = '#F8FAFC'
const GOOD = '#15803D'
const AMBER = '#B45309'

const DOC_LABELS: Record<string, string> = {
  roe: 'Rules of Engagement',
  conops: 'Concept of Operations',
  deconfliction: 'Deconfliction',
  'threat-profile': 'Threat Profile',
  contact: 'Contact & Notification',
  'data-handling': 'Data Handling',
  abort: 'Abort Conditions',
  cleanup: 'Cleanup',
  opplan: 'Operational Objectives',
}

function briefingTemplate(project: ProjectViewModel): string {
  return `Briefing for "${project.displayName}" (target ${project.targetValue}):
- In scope:
- Out of scope:
- Constraints (no-go actions):
- Stop conditions:
- Data handling notes:

Soundwave, draft the RoE and planning bundle from this brief.`
}

function StarterBubble({ project }: { project: ProjectViewModel }): ReactNode {
  return <div style={{ maxWidth: '85%', alignSelf: 'flex-start', background: '#FFFFFF', border: `1px solid ${BORDER}`, borderRadius: '10px 10px 10px 4px', padding: '10px 14px', fontSize: 13, color: BODY, lineHeight: 1.6 }}>
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: MUTED, marginBottom: 4 }}>SOUNDWAVE · PLANNING</div>
    Before I draft anything: brief me on this engagement. Fill the template below — target, scope, constraints — and send it. I will draft the RoE and the planning bundle from your brief, nothing more.
    <div style={{ marginTop: 8, padding: '8px 10px', background: PAGE, border: `1px dashed ${BORDER}`, borderRadius: 6, fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap' }}>{briefingTemplate(project)}</div>
  </div>
}

function ChatColumn({ project, note, composer }: { project: ProjectViewModel; note?: string; composer?: ReactNode }): ReactNode {
  return <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    {note}
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StarterBubble project={project} />
    </div>
    <div style={{ borderTop: `1px solid ${BORDER}`, padding: '12px 18px', background: '#FFFFFF' }}>
      {composer ?? <textarea readOnly value={briefingTemplate(project)} rows={6} style={{ width: '100%', boxSizing: 'border-box', fontFamily: MONO, fontSize: 12, color: INK, background: PAGE, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 8, resize: 'vertical' }} />}
    </div>
  </div>
}

function ProgressBar({ ready, total }: { ready: number; total: number }): ReactNode {
  return <div style={{ flex: 1, minWidth: 120, height: 6, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
    <div style={{ width: `${(ready / total) * 100}%`, height: '100%', background: ready === total ? GOOD : '#1D4ED8' }} />
  </div>
}

// --- Variant A: single chat, mode-switch banner -----------------------------
function VariantModeBanner({ view, project, simReady, confirmed, onConfirm }: GateProps): ReactNode {
  const total = view ? Object.keys(view.bundle).length : 9
  const locked = simReady < total || !confirmed
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: locked ? '#FFFBEB' : '#F0FDF4', borderBottom: `1px solid ${BORDER}` }}>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: locked ? AMBER : GOOD }}>{locked ? 'PLANNING MODE' : 'EXECUTION MODE'}</span>
    <ProgressBar ready={locked ? simReady : total} total={total} />
    <span style={{ fontSize: 12, color: BODY }}>{simReady}/{total} docs · {confirmed ? 'confirmed' : 'not confirmed'}</span>
    {!locked && <span style={{ fontSize: 11, fontWeight: 700, color: GOOD }}>RUNS ARMED</span>}
    {simReady === total && !confirmed && <button type="button" onClick={onConfirm} style={{ background: GOOD, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm handoff → unlock execution</button>}
    <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>mode governed by {project.workspaceSlug}</span>
  </div>
}

// --- shared props ------------------------------------------------------------
interface GateProps {
  project: ProjectViewModel
  view: PlanningView | null
  simReady: number
  confirmed: boolean
  onConfirm: () => void
  onSim: (delta: number) => void
  onReset: () => void
}

function LockedCard({ view, simReady, confirmed, onConfirm, compact }: { view: PlanningView | null; simReady: number; confirmed: boolean; onConfirm: () => void; compact?: boolean }): ReactNode {
  const total = view ? Object.keys(view.bundle).length : 9
  const ready = simReady >= total
  return <div style={{ background: '#FFFFFF', border: `1px solid ${BORDER}`, borderRadius: 10, padding: compact ? 16 : 24, maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 18 }}>🔒</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Execution locked</span>
      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: ready ? GOOD : AMBER }}>{simReady}/{total} docs</span>
    </div>
    <p style={{ margin: 0, fontSize: 12, color: BODY, lineHeight: 1.6 }}>
      {ready
        ? confirmed ? 'Handoff confirmed. Execution runs are armed.' : 'Bundle validated. Confirm the handoff to arm execution runs.'
        : 'Finish the briefing with Soundwave. Execution unlocks only after the planning bundle validates and you confirm the handoff.'}
    </p>
    <ProgressBar ready={simReady} total={total} />
    {ready && !confirmed && <button type="button" onClick={onConfirm} style={{ alignSelf: 'flex-start', background: GOOD, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>I confirm the RoE — unlock execution</button>}
    {confirmed && <span style={{ fontSize: 11, fontWeight: 700, color: GOOD }}>✓ HANDOFF CONFIRMED</span>}
  </div>
}

// --- Variant B: two tabs ------------------------------------------------------
function VariantTabs({ view, project, simReady, confirmed, onConfirm }: GateProps): ReactNode {
  const [tab, setTab] = useState<'planning' | 'execution'>('planning')
  const total = view ? Object.keys(view.bundle).length : 9
  const locked = simReady < total || !confirmed
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <div style={{ display: 'flex', gap: 4, background: '#FFFFFF', borderBottom: `1px solid ${BORDER}`, padding: '8px 18px 0' }}>
      <button type="button" onClick={() => setTab('planning')} style={{ border: 'none', borderBottom: tab === 'planning' ? '2px solid #1D4ED8' : '2px solid transparent', background: 'transparent', padding: '8px 14px', fontSize: 13, fontWeight: 700, color: tab === 'planning' ? INK : MUTED, cursor: 'pointer' }}>Planning · Soundwave</button>
      <button type="button" onClick={() => setTab('execution')} style={{ border: 'none', borderBottom: tab === 'execution' ? '2px solid #1D4ED8' : '2px solid transparent', background: 'transparent', padding: '8px 14px', fontSize: 13, fontWeight: 700, color: tab === 'execution' ? INK : MUTED, cursor: 'pointer' }}>Execution · Raptix {locked ? '🔒' : ''}</button>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
        <ProgressBar ready={simReady} total={total} />
        <span style={{ fontSize: 11, color: BODY }}>{simReady}/{total}</span>
      </div>
    </div>
    {tab === 'planning'
      ? <ChatColumn project={project} />
      : locked
        ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: PAGE }}>
            <LockedCard view={view} simReady={simReady} confirmed={confirmed} onConfirm={onConfirm} />
          </div>
        : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: PAGE, flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 26 }}>🔓</span>
            <span style={{ fontSize: 13, color: BODY }}>Execution armed — the real run timeline renders here (prototype stub).</span>
          </div>}
  </div>
}

// --- Variant C: split chat | status ------------------------------------------
function VariantSplit({ view, project, simReady, confirmed, onConfirm }: GateProps): ReactNode {
  const total = view ? Object.keys(view.bundle).length : 9
  const docs = view ? Object.entries(view.bundle) : []
  return <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
    <ChatColumn project={project} />
    <aside style={{ width: 340, borderLeft: `1px solid ${BORDER}`, background: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>Plan status</span>
        <ProgressBar ready={simReady} total={total} />
        <span style={{ fontSize: 11, color: BODY }}>{simReady}/{total}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, overflowY: 'auto' }}>
        {docs.map(([key, state], i) => <li key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: i < simReady ? GOOD : '#CBD5E1' }} />
          <span style={{ color: INK }}>{DOC_LABELS[key] ?? key}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: i < simReady ? GOOD : MUTED }}>{i < simReady ? 'READY' : String(state).toUpperCase()}</span>
        </li>)}
      </ul>
      <div style={{ padding: 16, borderTop: `1px solid ${BORDER}` }}>
        <LockedCard view={view} simReady={simReady} confirmed={confirmed} onConfirm={onConfirm} compact />
      </div>
    </aside>
  </div>
}

function GateSwitcher({ variant, onSet }: { variant: string; onSet: (v: GateVariant) => void }): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const idx = VARIANTS.indexOf(variant as GateVariant)
      if (event.key === 'ArrowLeft') onSet(VARIANTS[(idx + VARIANTS.length - 1) % VARIANTS.length])
      if (event.key === 'ArrowRight') onSet(VARIANTS[(idx + 1) % VARIANTS.length])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onSet])
  return <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: 10, background: '#0F172A', color: '#fff', borderRadius: 999, padding: '8px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.25)', fontSize: 13 }}>
    <button type="button" onClick={() => onSet(VARIANTS[(VARIANTS.indexOf(variant as GateVariant) + VARIANTS.length - 1) % VARIANTS.length])} style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 15, cursor: 'pointer' }}>◀</button>
    <span style={{ fontWeight: 700, userSelect: 'none' }}>Gate {variant}</span>
    <button type="button" onClick={() => onSet(VARIANTS[(VARIANTS.indexOf(variant as GateVariant) + 1) % VARIANTS.length])} style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 15, cursor: 'pointer' }}>▶</button>
  </div>
}

export function ConsoleGatePrototype({ project, rawVariant, setVariant }: { project: ProjectViewModel; rawVariant: string | null; setVariant: (v: GateVariant) => void }): ReactNode {
  const [view, setView] = useState<PlanningView | null>(null)
  const [simReady, setSimReady] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(project.id)}/plan-docs`, { signal: controller.signal, retries: 0 }).then(
      value => { if (!controller.signal.aborted && typeof value === 'object' && value !== null && 'bundle' in value) setView(value as PlanningView) },
      () => { /* prototype: readiness panel falls back to 9 placeholders */ },
    )
    return () => controller.abort()
  }, [project.id])
  const total = view ? Object.keys(view.bundle).length : 9
  const variant = (VARIANTS.includes(rawVariant as GateVariant) ? rawVariant : 'A') as GateVariant
  const props: GateProps = {
    project,
    view,
    simReady,
    confirmed,
    onConfirm: () => setConfirmed(true),
    onSim: delta => setSimReady(current => Math.min(total, current + delta)),
    onReset: () => { setSimReady(0); setConfirmed(false) },
  }
  const body = variant === 'A'
    ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <VariantModeBanner {...props} />
        <ChatColumn project={project} note={undefined} composer={simReady >= total && confirmed
          ? <textarea readOnly value="[Execution armed — prototype stub: the real composer binds here]" rows={2} style={{ width: '100%', fontFamily: MONO, fontSize: 12, color: BODY, background: '#F0FDF4', border: `1px solid ${BORDER}`, borderRadius: 6, padding: 8 }} />
          : undefined} />
      </div>
    : variant === 'B'
      ? <VariantTabs {...props} />
      : <VariantSplit {...props} />
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: PAGE }}>
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>{body}</div>
    <SimStrip simReady={simReady} total={total} onSim={props.onSim} onReset={props.onReset} />
    <GateSwitcher variant={variant} onSet={setVariant} />
  </div>
}

function SimStrip({ simReady, total, onSim, onReset }: { simReady: number; total: number; onSim: (delta: number) => void; onReset: () => void }): ReactNode {
  return <div style={{ position: 'fixed', bottom: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 999, display: 'flex', gap: 8, alignItems: 'center', background: '#1E293B', color: '#E2E8F0', borderRadius: 8, padding: '6px 12px', fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>
    <span style={{ fontWeight: 700, letterSpacing: '0.06em' }}>SIM</span>
    <button type="button" onClick={() => onSim(1)} style={{ background: '#334155', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>+1 doc ready</button>
    <button type="button" onClick={() => onSim(9)} style={{ background: '#334155', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>all ready</button>
    <button type="button" onClick={onReset} style={{ background: 'transparent', color: '#94A3B8', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>reset ({simReady}/{total})</button>
  </div>
}
