/**
 * Real Operator Console planning-gate panel (briefing-first flow).
 * Shows the live planning-bundle readiness (server-validated plan-docs) and
 * the explicit handoff confirmation that arms execution chats. Never
 * fabricates readiness: every state comes from the plan-docs API or the
 * persisted `handoffConfirmedAt` on the engagement.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PlanningView, ProjectViewModel } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { encodePathSegment, requestJson } from '../../shared/api/http'

const MONO = "'JetBrains Mono', monospace"
const C = { ink: '#0F172A', body: '#334155', muted: '#94A3B8', border: '#E2E8F0', page: '#F8FAFC', red: '#DC2626', good: '#15803D', amber: '#B45309' }

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

export interface PlanningGate {
  /** Server-validated bundle readiness (null while loading/unavailable). */
  readonly view: PlanningView | null
  readonly readinessError: string | null
  /** Total bundle documents and count currently ready. */
  readonly total: number
  readonly ready: number
  /** Hard gate: every document validated AND the handoff explicitly confirmed. */
  readonly executionArmed: boolean
  readonly confirmed: boolean
  readonly confirming: boolean
  refreshReadiness: () => void
  confirmHandoff: () => Promise<void>
}

export function usePlanningGate(project: ProjectViewModel): PlanningGate {
  const [view, setView] = useState<PlanningView | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [confirmed, setConfirmed] = useState(project.handoffConfirmedAt !== null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => { setConfirmed(project.handoffConfirmedAt !== null) }, [project.id, project.handoffConfirmedAt])

  useEffect(() => {
    const controller = new AbortController()
    requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(project.id)}/plan-docs`, { signal: controller.signal, retries: 0 }).then(
      value => {
        if (controller.signal.aborted) return
        if (typeof value === 'object' && value !== null && 'bundle' in value && 'readiness' in value) {
          setView(value as PlanningView)
          setReadinessError(null)
        } else {
          setView(null)
          setReadinessError('Plan-docs response did not match the planning contract')
        }
      },
      cause => {
        if (controller.signal.aborted) return
        setView(null)
        setReadinessError(cause instanceof ApiInvalidResponseError ? cause.message : 'Planning API unavailable')
      },
    )
    return () => controller.abort()
  }, [project.id, project.updatedAt, revision])

  const refreshReadiness = useCallback(() => setRevision(current => current + 1), [])
  const confirmHandoff = useCallback(async () => {
    setConfirming(true)
    try {
      const updated = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(project.id)}`, {
        method: 'PATCH', body: { handoffConfirmed: true }, timeoutMs: 15_000,
      })
      if (typeof updated === 'object' && updated !== null && 'handoffConfirmedAt' in updated) {
        setConfirmed(updated.handoffConfirmedAt !== null)
      }
      setRevision(current => current + 1)
    } finally {
      setConfirming(false)
    }
  }, [project.id])

  const total = view ? Object.keys(view.bundle).length : 9
  const ready = view ? Object.entries(view.bundle).filter(([, state]) => state === 'ready').length : 0
  return { view, readinessError, total, ready, executionArmed: confirmed && view?.readiness.state === 'ready', confirmed, confirming, refreshReadiness, confirmHandoff }
}

function DocRow({ name, state }: { name: string; state: string }): ReactNode {
  const ready = state === 'ready'
  return <li style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderBottom: `1px solid ${C.page}`, fontSize: 12 }}>
    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: ready ? C.good : '#CBD5E1', flexShrink: 0 }} />
    <span style={{ color: C.ink, overflowWrap: 'anywhere' }}>{DOC_LABELS[name] ?? name}</span>
    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, fontFamily: MONO, color: ready ? C.good : C.muted }}>{ready ? 'READY' : state.toUpperCase()}</span>
  </li>
}

export function PlanStatusPanel({ gate, projectName }: { gate: PlanningGate; projectName: string }): ReactNode {
  const { view, readinessError, total, ready, confirmed, confirming, refreshReadiness, confirmHandoff } = gate
  const bundleReady = view?.readiness.state === 'ready'
  const armed = confirmed && bundleReady
  return <section aria-label="Planning status" style={{ background: '#FFFFFF', borderBottom: `1px solid ${C.border}` }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Plan status</span>
      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, color: armed ? C.good : C.amber, background: armed ? '#F0FDF4' : '#FFFBEB', padding: '2px 8px', borderRadius: 10 }}>
        {armed ? 'EXECUTION ARMED' : 'EXECUTION LOCKED'}
      </span>
      <span style={{ flex: 1, minWidth: 60, height: 5, background: C.page, borderRadius: 999, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${(ready / total) * 100}%`, height: '100%', background: bundleReady ? C.good : '#1D4ED8' }} />
      </span>
      <span style={{ fontSize: 11, color: C.body, fontFamily: MONO }}>{ready}/{total}</span>
      <button onClick={refreshReadiness} aria-label="Revalidate planning bundle" style={{ fontSize: 11, color: '#475569', background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>↻</button>
    </div>
    {readinessError !== null && <p style={{ margin: 0, padding: '0 14px 9px', fontSize: 11, color: C.amber }}>{readinessError} — revalidate; states are never assumed.</p>}
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {(view ? Object.entries(view.bundle) : Array.from({ length: total }, (_, i) => [`doc-${i}`, 'unknown'] as const)).map(([name, state]) => <DocRow key={name} name={name} state={state} />)}
    </ul>
    {!armed && <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 11, color: C.body, lineHeight: 1.55 }}>
        {view === null
          ? 'Planning readiness is not loaded yet — execution stays locked; nothing is assumed.'
          : bundleReady
            ? `Bundle validated for ${projectName}. Confirm the handoff to arm execution chats.`
            : `Brief Soundwave in the planning chat below. Execution unlocks only after the bundle validates and you confirm the handoff.`}
      </p>
      {bundleReady && !confirmed && <button
        onClick={() => { void confirmHandoff() }}
        disabled={confirming}
        style={{ alignSelf: 'flex-start', background: C.good, color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: confirming ? 'default' : 'pointer' }}
      >
        {confirming ? 'Confirming…' : 'I confirm the RoE — unlock execution'}
      </button>}
    </div>}
  </section>
}
