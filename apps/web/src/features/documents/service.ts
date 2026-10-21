/**
 * Project document workspace read/write (plan 2026-10-16 §4 — Scope & ROE /
 * Planning shared reader). Mock-only by design: the document list derives
 * from the project aggregate (ROE, AI planning plans, the technical contract
 * pack) so there is no second document store and no copies between surfaces.
 * Draft saves are simulated writes into the mock authority (`docDrafts`) —
 * clearly audit-logged as simulated and never presented as real file
 * persistence. Real mode keeps its API-backed panels (ADR-0068) and never
 * renders this surface.
 */
import { APR, planVer, type Db, type Plan, type Project } from '../../data'
import { projectAccessible } from '../../domain/policy'
import { stamp } from '../../domain/demo-clock'
import { projectView } from '../../domain/projection'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'
import { useServiceProjection } from '../../state/projection'

export type DocOrigin = 'Applied scope' | 'Human-authored' | 'AI-generated'

export interface DocDraft { text: string; by: string; at: string }

export interface DocView {
  /** Stable identity, also the draft key: `${projectId}/${id}`. */
  id: string
  projectId: string
  name: string
  kind: 'ROE' | 'Planning' | 'Contract'
  format: 'md' | 'json' | 'pdf'
  status: string
  statusTone: 'ok' | 'warn' | 'bad' | 'neutral'
  version: string
  source: string
  updated: string
  origin: DocOrigin
  /** A simulated working draft, if one was saved for this document. */
  draft: DocDraft | null
  /** Whether the editor offers a working draft for this document. */
  editable: boolean
  /** Natural-language rendering (no draft: composed from the applied data). */
  readable: string
  /** Machine view of the same document model (pretty JSON or the raw text). */
  raw: string
  plan?: Plan
}

export interface DocListRead { projectId: string; docs: DocView[] }

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  approved: 'ok', delivered: 'ok', executed: 'ok',
  draft: 'warn', pending: 'warn', proposed: 'warn', in_review: 'warn', review: 'warn', returned: 'warn', expired: 'warn',
  rejected: 'bad', superseded: 'neutral', reference: 'neutral',
}

/** The ROE document in natural language, composed only from fields that exist on the project. */
export function roeReadable(p: Project, inScope: string[]): string {
  const roe = p.roeStatus === 'approved' ? 'Approved' : p.roeStatus === 'none' ? 'Missing' : p.roeStatus.charAt(0).toUpperCase() + p.roeStatus.slice(1)
  return [
    `# Rules of Engagement — ${p.roeVersion} (${roe})`,
    '',
    '## Engagement overview',
    p.desc,
    '',
    '## Objectives',
    ...(p.objectives.length ? p.objectives.map((o) => `- ${o.text} (owner: ${o.owner})`) : ['- No objectives recorded yet.']),
    '',
    '## Scope',
    ...(inScope.length ? inScope.map((n) => `- ${n}`) : ['- No approved in-scope assets yet.']),
    '',
    '## Permitted activities',
    ...(p.methods.length ? p.methods.map((m) => `- ${m}`) : ['- None recorded.']),
    '',
    '## Restrictions and stop conditions',
    ...(p.restrictions.length ? p.restrictions.map((m) => `- ${m}`) : ['- None recorded.']),
    '',
    '## Testing window',
    `${p.window || 'Not set'} (${p.tz})`,
    '',
    '## Emergency contact and coordination',
    p.emergency ? `${p.emergency} — stop immediately on request from this contact.` : 'No emergency contact is set. Execution stays locked until one is added.',
  ].join('\n')
}

/** The planning plan document rendered from the plan record (AI-authored). */
export function planReadable(plan: Plan): string {
  return [
    `# ${plan.title} (${plan.id})`,
    '',
    `Status: ${plan.status} · Version: ${planVer(plan)} · ROE: ${plan.roeVersion}`,
    '',
    '## Rationale',
    plan.rationale,
    '',
    '## Risks',
    ...(plan.risks.length ? plan.risks.map((r) => `- ${r}`) : ['- None recorded.']),
    '',
    '## Steps',
    ...(plan.steps.length ? plan.steps.map((s) => `- ${s.name} — ${s.technique} on ${s.asset} via ${s.agent} (${s.risk} risk${s.needsApproval ? ', needs approval' : ''})`) : ['- No steps yet.']),
  ].join('\n')
}

const roeSource = (p: Project) => JSON.stringify({ id: p.id, roeVersion: p.roeVersion, roeStatus: p.roeStatus, window: p.window, tz: p.tz, emergencyContact: p.emergency, methods: p.methods, restrictions: p.restrictions, objectives: p.objectives.map((o) => o.text) }, null, 2)

const planSource = (plan: Plan) => JSON.stringify(plan, null, 2)

/** Builds the project's document list from the aggregate; drafts overlay the composed text. */
export function projectDocs(db: Db, ctx: RequestContext, projectId: string): DocListRead {
  const p = db.projects.find((x) => x.id === projectId)
  if (!p || !projectAccessible(p, ctx.actor)) return { projectId, docs: [] }
  const inScope = db.assets.filter((a) => a.projectId === p.id && a.scope === 'in').map((a) => `${a.name} (${a.ident})`)
  const lastScope = db.approvals.filter((a) => a.projectId === p.id && ([APR.create, APR.scope] as string[]).includes(a.type)).sort((a, b) => b.at.localeCompare(a.at))[0]
  const docs: DocView[] = [
    {
      id: 'roe', projectId: p.id, name: `${p.id}_${p.roeVersion}.pdf`, kind: 'ROE', format: 'json',
      status: p.roeStatus === 'none' ? 'missing' : p.roeStatus, statusTone: STATUS_TONE[p.roeStatus] ?? 'neutral',
      version: p.roeVersion, source: lastScope ? `Scope & ROE approval ${lastScope.id}` : 'Not submitted yet',
      updated: lastScope?.at ?? '—', origin: 'Applied scope', editable: true,
      draft: db.docDrafts[`${p.id}/roe`] ?? null,
      readable: roeReadable(p, inScope), raw: roeSource(p),
    },
    ...db.plans.filter((x) => x.projectId === p.id).map((plan): DocView => ({
      id: plan.id, projectId: p.id, name: `${plan.id} — ${plan.title}`, kind: 'Planning', format: 'json',
      status: plan.status, statusTone: STATUS_TONE[plan.status] ?? 'neutral',
      version: planVer(plan), source: `AI workspace · ${plan.conversationId}`, updated: plan.updated,
      origin: 'AI-generated', editable: true, draft: db.docDrafts[`${p.id}/${plan.id}`] ?? null,
      readable: planReadable(plan), raw: planSource(plan), plan,
    })),
    {
      id: 'contract', projectId: p.id, name: `${p.id}_technical-contract.pdf`, kind: 'Contract', format: 'pdf',
      status: 'reference', statusTone: 'neutral', version: '—', source: 'Client pack', updated: '—',
      origin: 'Human-authored', editable: false, draft: null,
      readable: 'Only the file name exists in this demo dataset — no document content is available, so no preview is claimed.',
      raw: '',
    },
  ]
  return { projectId, docs }
}

/** Subscription read for the workspace UI. */
export function readProjectDocuments(services: ConsoleServices, ctx: RequestContext, projectId: string): DocListRead {
  return projectView(services, ctx, `docs:${projectId}`, (db) => projectDocs(db, ctx, projectId))
}

export function useProjectDocuments(projectId: string): DocListRead {
  return useServiceProjection((services, ctx) => readProjectDocuments(services, ctx, projectId), projectId)
}

const docFailure = (message: string): { ok: false; failure: ServiceFailure } => ({ ok: false, failure: { kind: 'not-found', message, entity: { kind: 'project', id: '' } } })

/** Saves a simulated working draft; the audit row says "simulated" on purpose. */
export function saveDocumentDraft(authority: DbAuthority, _clock: Clock, ctx: RequestContext, projectId: string, docId: string, text: string): ServiceResult<DocDraft> {
  const db = authority.snapshot()
  const p = db.projects.find((x) => x.id === projectId)
  if (!p || !projectAccessible(p, ctx.actor)) return docFailure('The project does not exist or is out of scope.')
  const key = `${projectId}/${docId}`
  const draft: DocDraft = { text, by: ctx.actor.id, at: stamp() }
  authority.commit(ctx.corr, (d) => {
    d.docDrafts[key] = draft
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: ctx.actor.id, role: ctx.actor.role, action: 'Saved document draft (simulated)', obj: `${docId} in ${projectId}`, projectId, result: 'Success', reason: 'Mock draft save — not a real file write' })
  })
  return { ok: true, data: draft }
}

export function discardDocumentDraft(authority: DbAuthority, ctx: RequestContext, projectId: string, docId: string): ServiceResult<{ id: string }> {
  const db = authority.snapshot()
  const p = db.projects.find((x) => x.id === projectId)
  if (!p || !projectAccessible(p, ctx.actor)) return docFailure('The project does not exist or is out of scope.')
  const key = `${projectId}/${docId}`
  if (!db.docDrafts[key]) return { ok: true, data: { id: docId } }
  authority.commit(ctx.corr, (d) => {
    delete d.docDrafts[key]
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: ctx.actor.id, role: ctx.actor.role, action: 'Discarded document draft (simulated)', obj: `${docId} in ${projectId}`, projectId, result: 'Success', reason: '' })
  })
  return { ok: true, data: { id: docId } }
}
