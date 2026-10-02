import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { isPlanningView, type PlanningView, type ProjectViewModel, type ScopeEntry } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { encodePathSegment, requestJson } from '../../shared/api/http'

async function getRealPlanning(id: string, signal?: AbortSignal): Promise<PlanningView> {
  const value = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(id)}/plan-docs`, { signal, retries: 1 })
  if (!isPlanningView(value) || value.engagementId !== id) throw new ApiInvalidResponseError('Planning response did not match this engagement')
  return value
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}><h2 style={{ margin: 0, padding: '14px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 14, fontWeight: 700 }}>{title}</h2><div style={{ padding: 16, fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{children}</div></section>
}
function List({ values }: { values: readonly string[] | undefined }) {
  return values?.length ? <ul style={{ paddingLeft: 20, margin: 0 }}>{values.map((value, i) => <li key={i}>{value}</li>)}</ul> : <p style={{ margin: 0, color: '#64748B' }}>No entries recorded.</p>
}
function ScopeTable({ title, entries }: { title: string; entries: readonly ScopeEntry[] | undefined }) {
  return <Card title={title}>{entries?.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr>{['Target', 'Type', 'Notes'].map(label => <th key={label} style={{ padding: 8, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>{label}</th>)}</tr></thead><tbody>{entries.map((entry, i) => <tr key={i}><td style={{ padding: 8, fontFamily: 'monospace' }}>{entry.target}</td><td style={{ padding: 8 }}>{entry.type}</td><td style={{ padding: 8 }}>{entry.notes || '—'}</td></tr>)}</tbody></table></div> : <p style={{ margin: 0, color: '#64748B' }}>No targets recorded.</p>}</Card>
}

export default function RealPlanning({ project, scope = false }: { project: ProjectViewModel; scope?: boolean }) {
  const [revision, setRevision] = useState(0)
  const [read, setRead] = useState<{ id: string; view?: PlanningView; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setRead(null)
    void getRealPlanning(project.id, controller.signal).then(
      view => { if (!controller.signal.aborted) setRead({ id: project.id, view }) },
      cause => { if (!controller.signal.aborted) setRead({ id: project.id, error: cause instanceof Error ? cause.message : 'Planning API unavailable' }) },
    )
    return () => controller.abort()
  }, [project.id, project.updatedAt, revision])
  const current = read?.id === project.id ? read : null
  const view = current?.view
  const roe = view?.documents.roe.state === 'ready' ? view.documents.roe.content : undefined
  const conops = view?.documents.conops.state === 'ready' ? view.documents.conops.content : undefined
  const deconfliction = view?.documents.deconfliction.state === 'ready' ? view.documents.deconfliction.content : undefined
  const opplan = view?.documents.opplan.state === 'ready' ? view.documents.opplan.content : undefined
  return <div style={{ color: '#0F172A' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '20px 0 16px' }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{scope ? 'Scope & Boundary' : 'Planning Documents'}</h2>
      <button onClick={() => { setRead(null); setRevision(n => n + 1) }} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '8px 14px', fontSize: 13 }}>Refresh planning</button>
    </div>
    {!current && <p role="status">Loading planning documents…</p>}
    {current?.error && <Card title="Planning API unavailable"><p role="alert">{current.error}</p><p>Retry with Refresh planning. No demo documents are substituted.</p></Card>}
    {view && <>
      <Card title={view.readiness.state === 'ready' ? 'Planning bundle validated' : 'Planning handoff blocked'}>
        <p style={{ marginTop: 0 }}>Document validation is read-only. Runtime handoff has not been observed.</p>
        {view.readiness.reasons.length > 0 && <List values={view.readiness.reasons} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{Object.entries(view.bundle).map(([name, state]) => <span key={name} style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '3px 8px', background: state === 'ready' ? '#F0FDF4' : '#FFFBEB' }}>{name}: {state}</span>)}</div>
      </Card>
      {roe ? <>
        {!scope && <Card title="Rules of Engagement"><strong>{roe.engagement_name}</strong><p>Client: {roe.client} • {roe.engagement_type}</p><p>{roe.start_date} → {roe.end_date}</p><p>Testing window: {roe.testing_window}</p><p>Authorization reference: {roe.authorization_reference || 'Not recorded'}</p></Card>}
        <ScopeTable title="In-scope targets" entries={roe.in_scope} /><ScopeTable title="Out-of-scope exclusions" entries={roe.out_of_scope} />
        <Card title="Operational Boundaries"><h3 style={{ fontSize: 13 }}>Prohibited actions</h3><List values={roe.prohibited_actions} /><h3 style={{ fontSize: 13 }}>Permitted actions</h3><List values={roe.permitted_actions} /><p>Testing window: {roe.testing_window}</p><p style={{ color: '#64748B' }}>Read-only projection of runtime RoE. Scope editing is not connected.</p></Card>
      </> : <Card title="Rules of Engagement"><p>RoE document is {view.documents.roe.state}. Scope cannot be projected until it validates.</p></Card>}
      {!scope && <>
        <Card title="Concept of Operations">{conops ? <><p>{conops.executive_summary}</p><p>{conops.attack_narrative}</p><p>Methodology: {conops.methodology || 'Not recorded'}</p><List values={conops.threat_actors?.map(actor => `${actor.name} • ${actor.sophistication} • ${actor.motivation}`)} /><h3 style={{ fontSize: 13 }}>Success criteria</h3><List values={conops.success_criteria} /></> : <p>CONOPS document is {view.documents.conops.state}.</p>}</Card>
        <Card title="Deconfliction">{deconfliction ? <><p>{deconfliction.notification_procedure}</p><p>SOC contact: {deconfliction.soc_contact || 'Not recorded'}</p><List values={deconfliction.identifiers?.map(marker => `${marker.type}: ${marker.value}${marker.description ? ` — ${marker.description}` : ''}`)} /></> : <p>Deconfliction document is {view.documents.deconfliction.state}.</p>}</Card>
        <Card title="Operational Objectives">{opplan ? <><p>{opplan.threat_profile}</p>{opplan.objectives?.length ? opplan.objectives.map((objective, i) => <div key={i} style={{ borderTop: '1px solid #E2E8F0', padding: '12px 0' }}><strong>{objective.id} — {objective.title}</strong><p>{objective.description}</p><span>{objective.phase} • {objective.status || 'pending'}</span><p>Dependencies: {objective.blocked_by?.join(', ') || 'None recorded'}</p></div>) : <p>No objectives recorded.</p>}</> : <p>OPPLAN document is {view.documents.opplan.state}. The orchestrator may create it after planning.</p>}</Card>
      </>}
    </>}
  </div>
}
