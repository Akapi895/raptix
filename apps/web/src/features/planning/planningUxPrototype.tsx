// THROWAWAY PROTOTYPE — planning/charter UX exploration for the real-mode
// planning empty/blocked state. Injected by RealPlanning.tsx (dev build only),
// removed once a winning variant is folded back into RealPlanning.tsx.
// Question: "Which presentation should the 'planning bundle missing' state have?"
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PlanningView, ProjectViewModel } from '@raptix/web-contracts'
import { navigateUrl } from '../../app/router'

const PROTOTYPE_PARAM = 'planningVariant'
const PROTOTYPE_VARIANTS = ['A', 'B', 'C'] as const
export type PrototypeVariant = typeof PROTOTYPE_VARIANTS[number]

/** Reads `?planningVariant=` from the URL, dev-mode only. */
export function isPlanningPrototypeActive(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has(PROTOTYPE_PARAM)
}

/** Raw param getter (also used by the switcher). */
function readVariantParam(): string | null {
  if (!import.meta.env.DEV) return null
  return new URLSearchParams(window.location.search).get(PROTOTYPE_PARAM)
}

function useVariantNavigation(): [string | null, (v: PrototypeVariant) => void] {
  const [variant, setVariant] = useState<string | null>(() => readVariantParam())
  useEffect(() => {
    const sync = (): void => setVariant(readVariantParam())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  return [variant, (v) => {
    const url = new URL(window.location.href)
    url.searchParams.set(PROTOTYPE_PARAM, v)
    window.history.replaceState(null, '', url.toString())
    setVariant(v)
  }]
}

const DOC_META: Record<string, { label: string; hint: string }> = {
  roe: { label: 'Rules of Engagement', hint: 'Defines authorized scope, timeframe and boundaries. Drafted from your briefing.' },
  conops: { label: 'Concept of Operations', hint: 'Executive summary, methodology and success criteria for this engagement.' },
  deconfliction: { label: 'Deconfliction', hint: 'SOC notification procedure and traffic markers so defenders can identify you.' },
  'threat-profile': { label: 'Threat Profile', hint: 'Emulated adversary: name, tier, sophistication and motivation.' },
  contact: { label: 'Contact & Notification', hint: 'Who to contact during the engagement, and through which channels.' },
  'data-handling': { label: 'Data Handling', hint: 'How collected data and findings are processed and stored.' },
  abort: { label: 'Abort Conditions', hint: 'Conditions under which testing is stopped immediately.' },
  cleanup: { label: 'Cleanup', hint: 'Steps to remove artifacts and restore systems after testing.' },
  opplan: { label: 'Operational Objectives', hint: 'The orchestrator (Raptix) creates this after planning completes.' },
}

const STATE_LABELS: Record<string, string> = {
  missing: 'Not drafted yet',
  ready: 'Ready',
  stale: 'Needs re-validation',
  invalid: 'Needs attention',
}

const INK = '#0F172A'
const MUTED = '#64748B'
const BORDER = '#E2E8F0'
const GOOD = '#15803D'
const WARN = '#B45309'

function ButtonPrimary({ children, onClick }: { children: ReactNode; onClick?: () => void }): ReactNode {
  return <button type="button" onClick={onClick} style={{ background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{children}</button>
}
function StatusDot({ state }: { state: string }): ReactNode {
  const color = state === 'ready' ? GOOD : state === 'missing' ? '#CBD5E1' : WARN
  return <span aria-hidden style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999, background: color, flexShrink: 0 }} />
}

// --- Variant A: Guided checklist ------------------------------------------
function VariantChecklist({ view, onRefresh, consoleHref }: VariantProps): ReactNode {
  const docs = Object.entries(view!.bundle)
  const readyCount = docs.filter(([, s]) => s === 'ready').length
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <section style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: INK }}>
          Planning bundle — {readyCount} of {docs.length} documents ready
        </h2>
        <div style={{ width: '100%', maxWidth: 480, height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: `${(readyCount / docs.length) * 100}%`, height: '100%', background: readyCount === docs.length ? GOOD : '#1D4ED8', transition: 'width .2s' }} />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
          {readyCount === docs.length
            ? 'Your planning bundle is complete and validated.'
            : <>Soundwave drafts these documents from your briefing in the Operator Console. Nothing is invented for you — the bundle starts unlocking only when every document validates.</>}
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ButtonPrimary onClick={() => navigateUrl(consoleHref)}>Draft with Soundwave →</ButtonPrimary>
          <button type="button" onClick={onRefresh} style={{ background: '#fff', color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 16px', fontSize: 13, cursor: 'pointer' }}>Reload bundle</button>
        </div>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', borderTop: `1px solid ${BORDER}` }}>
        {docs.map(([key, state]) => <li key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, gridColumnGap: 10 }}>
          <span style={{ marginTop: 4 }}><StatusDot state={state} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{DOC_META[key]?.label ?? key}<span style={{ fontWeight: 400, color: MUTED }}> — {STATE_LABELS[state] ?? state}</span></div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{DOC_META[key]?.hint}</div>
          </div>
        </li>)}
      </ul>
    </section>
  </div>
}

// --- Variant B: Linear stepper --------------------------------------------
function VariantStepper({ view, onRefresh, consoleHref }: VariantProps): ReactNode {
  const docs = Object.entries(view!.bundle)
  const readyCount = docs.filter(([, s]) => s === 'ready').length
  const next = docs.find(([, s]) => s !== 'ready')
  const complete = readyCount === docs.length
  const steps = ['Engagement authorized', `Documents drafted (${readyCount}/${docs.length})`, 'Execution unlocked']
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, justifyContent: 'center' }}>
      {steps.map((label, i) => {
        const state = i === 0 || (i === 1 && complete) ? 'done' : i === 1 ? 'active' : 'todo'
        return <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
            <span style={{ width: 24, height: 24, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: state === 'done' ? GOOD : state === 'active' ? '#1D4ED8' : '#F1F5F9', color: state === 'done' ? '#fff' : state === 'active' ? '#fff' : MUTED }}>{i + 1}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: state === 'todo' ? MUTED : INK }}>{label}</span>
          </div>
          {i < steps.length - 1 && <div style={{ width: 32, height: 2, background: i === 0 ? '#CBD5E1' : BORDER }} />}
        </div>
      })}
    </div>
    <section style={{ background: '#fff', border: `1px solid ${complete ? GOOD : BORDER}`, borderRadius: 10, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
      {complete
? <>
          <span style={{ fontSize: 32 }}>🔓</span>
          <h2 style={{ margin: 0, fontSize: 18, color: INK }}>Execution unlocked</h2>
          <p style={{ margin: 0, fontSize: 13, color: MUTED, maxWidth: 420, lineHeight: 1.6 }}>Your planning bundle is validated. Operation can proceed under the agreed Rules of Engagement.</p>
        </>
: <>
          <span style={{ fontSize: 32 }}>📝</span>
          <h2 style={{ margin: 0, fontSize: 18, color: INK }}>Next: draft <em style={{ fontStyle: 'normal', textDecoration: 'underline', textDecorationColor: '#93C5FD' }}>{next ? DOC_META[next[0]]?.label ?? next[0] : 'documents'}</em> with Soundwave</h2>
          <p style={{ margin: 0, fontSize: 13, color: MUTED, maxWidth: 420, lineHeight: 1.6 }}>Soundwave is the planning agent. Brief it in the Operator Console and it will draft and validate the planning bundle for you — {docs.length - readyCount} document{docs.length - readyCount > 1 ? 's' : ''} to go.</p>
          <ButtonPrimary onClick={() => navigateUrl(consoleHref)}>Open Operator Console</ButtonPrimary>
        </>}
      <button type="button" onClick={onRefresh} style={{ background: 'transparent', color: MUTED, border: 'none', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>I&apos;ve made changes — revalidate</button>
    </section>
  </div>
}

// --- Variant C: Master–detail inspector ------------------------------------
function VariantInspector({ view, onRefresh, consoleHref }: VariantProps): ReactNode {
  const docs = Object.entries(view!.bundle)
  const [selected, setSelected] = useState(docs[0]?.[0] ?? '')
  const doc = docs.find(([key]) => key === selected) ?? docs[0]
  const readyCount = docs.filter(([, s]) => s === 'ready').length
  return <div style={{ display: 'flex', gap: 0, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
    <nav style={{ minWidth: 280, borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', listStyle: 'none', margin: 0, padding: 0 }}>
      {docs.map(([key, state]) => <button key={key} type="button" onClick={() => setSelected(key)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px', textAlign: 'left', background: key === selected ? '#EFF6FF' : 'transparent', border: 'none', borderBottom: `1px solid ${BORDER}`, fontSize: 13, color: INK, cursor: 'pointer' }}>
        <StatusDot state={state} />
        <span style={{ flex: 1 }}>{DOC_META[key]?.label ?? key}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: state === 'ready' ? GOOD : MUTED }}>{state === 'ready' ? 'READY' : 'TODO'}</span>
      </button>)}
      <div style={{ padding: '12px 16px', marginTop: 'auto', borderTop: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 700, color: readyCount === docs.length ? GOOD : MUTED }}>
        {readyCount}/{docs.length} READY
      </div>
    </nav>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 24px', minWidth: 0 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{DOC_META[doc[0]]?.label ?? doc[0]}</div>
      <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.7 }}>{DOC_META[doc[0]]?.hint}</p>
      <div style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: doc[1] === 'ready' ? '#F0FDF4' : '#FFFBEB', color: doc[1] === 'ready' ? GOOD : WARN }}>
        {STATE_LABELS[doc[1]] ?? doc[1]}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        {doc[1] === 'ready'
? <span style={{ fontSize: 13, color: GOOD, fontWeight: 700 }}>Validated — no action needed.</span>
: <>
          <span style={{ fontSize: 13, color: MUTED }}>Ask Soundwave to draft this in the Operator Console:</span>
          <ButtonPrimary onClick={() => navigateUrl(consoleHref)}>Go there →</ButtonPrimary>
          <button type="button" onClick={onRefresh} style={{ background: 'transparent', color: MUTED, border: 'none', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>revalidate</button>
        </>}
      </div>
    </div>
  </div>
}

interface VariantProps { view?: PlanningView | null; onRefresh: () => void; consoleHref: string; project?: ProjectViewModel }

function Switcher({ variant, onChange }: { variant: string; onChange: (v: PrototypeVariant) => void }): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (event.target as HTMLElement | null)?.isContentEditable) return
      const idx = PROTOTYPE_VARIANTS.indexOf(variant as PrototypeVariant)
      if (event.key === 'ArrowLeft') onChange(PROTOTYPE_VARIANTS[(idx + PROTOTYPE_VARIANTS.length - 1) % PROTOTYPE_VARIANTS.length])
      if (event.key === 'ArrowRight') onChange(PROTOTYPE_VARIANTS[(idx + 1) % PROTOTYPE_VARIANTS.length])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onChange])
  return <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: 10, background: '#0F172A', color: '#fff', borderRadius: 999, padding: '8px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.25)', fontSize: 13 }}>
    <button type="button" onClick={() => onChange(PROTOTYPE_VARIANTS[(PROTOTYPE_VARIANTS.indexOf(variant as PrototypeVariant) + PROTOTYPE_VARIANTS.length - 1) % PROTOTYPE_VARIANTS.length])} style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 15, cursor: 'pointer' }}>◀</button>
    <span style={{ fontWeight: 700, userSelect: 'none' }}>Variant {variant}</span>
    <button type="button" onClick={() => onChange(PROTOTYPE_VARIANTS[(PROTOTYPE_VARIANTS.indexOf(variant as PrototypeVariant) + 1) % PROTOTYPE_VARIANTS.length])} style={{ background: 'transparent', color: '#fff', border: 'none', fontSize: 15, cursor: 'pointer' }}>▶</button>
  </div>
}

export function PlanningUxPrototype(props: VariantProps & { rawVariant: string | null; setVariant: (v: PrototypeVariant) => void }): ReactNode {
  const { rawVariant, setVariant, ...rest } = props
  const variant = PROTOTYPE_VARIANTS.includes(rawVariant as PrototypeVariant) ? rawVariant as PrototypeVariant : 'A'
  const body = variant === 'A' ? <VariantChecklist {...rest} /> : variant === 'B' ? <VariantStepper {...rest} /> : <VariantInspector {...rest} />
  return <>
    {rest.view
? body
: <section style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 24 }}>
      <p style={{ margin: 0 }} role="status">Loading planning documents…</p>
    </section>}
    <Switcher variant={variant} onChange={setVariant} />
  </>
}

export { useVariantNavigation }
