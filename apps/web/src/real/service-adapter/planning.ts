import type { DocumentSourceView, PlanningDocument, PlanningState, PlanningView, RoEView, ConopsView, DeconflictionView } from '@raptix/web-contracts'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { PlanningDocumentCard, PlanningDocumentSource, PlanningFact, PlanningOpplan, PlanningRead, PlanningService } from '../../features/planning/service'
import { confirmHandoff } from '../../features/projects/remote';
import { discardDocumentDraft, fetchDocumentSource, fetchPlanning, publishDocumentDraft, saveDocumentDraft } from '../../features/planning/remote';
import { guarded } from './shared'

const TITLES: Readonly<Record<string, string>> = {
  roe: 'Rules of Engagement', conops: 'Concept of Operations', deconfliction: 'Deconfliction', opplan: 'Operation Plan (OPPLAN)',
  'threat-profile': 'Threat Profile', contact: 'Contact', 'data-handling': 'Data Handling', abort: 'Abort', cleanup: 'Cleanup',
}
const READINESS_TEXT: Readonly<Record<string, string>> = {
  authorization_not_confirmed: 'Authorization is not confirmed for this engagement.',
  metadata_needs_review: 'The stored target has not been verified yet.',
  engagement_name_mismatch: 'The planning documents disagree on the engagement name.',
  authorization_reference_missing: 'The ROE has no authorization reference.',
  target_not_in_scope: 'The ROE in_scope list does not contain the engagement target.',
}
const DOCUMENT_STATE_TEXT: Readonly<Record<string, string>> = { missing: 'is not drafted yet', invalid: 'fails schema validation', unavailable: 'cannot be read right now' }
/** PREPARE documents the console reviews through their source only: the server gives their state, never their content. */
const SOURCE_ONLY_DOCUMENTS = ['threat-profile', 'contact', 'data-handling', 'abort', 'cleanup'] as const
const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its planning documents.' }

/** The server's machine reasons (`roe:missing`, `target_not_in_scope`) as a sentence the operator can act on. */
function describeReadinessReason(reason: string): string {
  const [name, state] = reason.split(':').map((part) => part.trim())
  if (state !== undefined && name in TITLES && state in DOCUMENT_STATE_TEXT) return `${TITLES[name]} ${DOCUMENT_STATE_TEXT[state]}.`
  return READINESS_TEXT[reason] ?? reason
}

function typedCard<T>(name: string, state: PlanningState, doc: PlanningDocument<T> | undefined, describe: (content: T) => Pick<PlanningDocumentCard, 'facts' | 'body'>): PlanningDocumentCard {
  const title = TITLES[name] ?? name
  if (doc?.state === 'ready') return { name, title, state: 'ready', ...describe(doc.content) }
  return { name, title, state, facts: [], body: null }
}

function roeFacts(c: RoEView): Pick<PlanningDocumentCard, 'facts' | 'body'> {
  const facts: PlanningFact[] = [
    { label: 'Engagement type', value: c.engagement_type },
    { label: 'Window', value: `${c.start_date} → ${c.end_date}` },
    { label: 'Testing window', value: c.testing_window },
    { label: 'Authorization', value: c.authorization_reference ?? 'Not recorded' },
    { label: 'Scope', value: `${(c.in_scope ?? []).length} in / ${(c.out_of_scope ?? []).length} out` },
    { label: 'Prohibited actions', value: String((c.prohibited_actions ?? []).length) },
  ]
  return { facts, body: null }
}

function conopsFacts(c: ConopsView): Pick<PlanningDocumentCard, 'facts' | 'body'> {
  const facts: PlanningFact[] = c.success_criteria && c.success_criteria.length > 0 ? [{ label: 'Success criteria', value: c.success_criteria.join('; ') }] : []
  return { facts, body: c.executive_summary }
}

function deconflictionFacts(c: DeconflictionView): Pick<PlanningDocumentCard, 'facts' | 'body'> {
  return {
    facts: [
      { label: 'SOC contact', value: c.soc_contact ?? 'Not recorded' },
      { label: 'Notification', value: c.notification_procedure ?? 'Not recorded' },
      { label: 'Identifiers', value: String((c.identifiers ?? []).length) },
    ],
    body: null,
  }
}

function readOf(view: PlanningView): PlanningRead {
  const opplanDoc = view.documents.opplan
  const opplan: PlanningOpplan = {
    ...typedCard('opplan', view.bundle.opplan, opplanDoc, () => ({ facts: [], body: null })),
    threatProfile: opplanDoc.state === 'ready' ? opplanDoc.content.threat_profile : null,
    objectives: opplanDoc.state === 'ready'
      ? (opplanDoc.content.objectives ?? []).map((o) => ({ id: o.id, title: o.title, description: o.description, phase: o.phase, status: o.status ?? 'pending', blockedBy: o.blocked_by ?? [] }))
      : [],
  }
  return {
    ready: view.readiness.state === 'ready',
    reasons: view.readiness.reasons.map(describeReadinessReason),
    runtimeSignal: view.readiness.runtimeSignal,
    documents: [
      typedCard('roe', view.bundle.roe, view.documents.roe, roeFacts),
      typedCard('conops', view.bundle.conops, view.documents.conops, conopsFacts),
      typedCard('deconfliction', view.bundle.deconfliction, view.documents.deconfliction, deconflictionFacts),
      ...SOURCE_ONLY_DOCUMENTS.map((name) => typedCard(name, view.bundle[name], undefined, () => ({ facts: [], body: null }))),
    ],
    opplan,
  }
}

function sourceOf(view: DocumentSourceView): PlanningDocumentSource {
  return {
    name: view.name,
    digest: view.digest,
    source: view.source,
    draft: view.draft?.body ?? null,
    valid: view.validation.valid,
    errors: view.validation.errors,
    publishable: view.name !== 'roe',
  }
}

export function createRealPlanningService(): PlanningService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  return {
    read: (ctx) => guarded(async (): Promise<ServiceResult<PlanningRead>> => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: readOf(await fetchPlanning(engagementId)) }
    }),
    confirmHandoff: (ctx) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      await confirmHandoff(engagementId)
      return { ok: true, data: { confirmed: true as const } }
    }),
    source: (ctx, name) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: sourceOf(await fetchDocumentSource(engagementId, name)) }
    }),
    saveDraft: (ctx, name, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: sourceOf(await saveDocumentDraft(engagementId, name, input)) }
    }),
    publish: (ctx, name, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const published = await publishDocumentDraft(engagementId, name, input)
      return { ok: true, data: { digest: published.digest } }
    }),
    discardDraft: (ctx, name) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: await discardDocumentDraft(engagementId, name) }
    }),
  }
}
