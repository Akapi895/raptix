import { isRecord } from './guards.js'

export const PLANNING_DOCUMENTS = ['roe', 'conops', 'deconfliction', 'opplan', 'threat-profile', 'contact', 'data-handling', 'abort', 'cleanup'] as const
export type PlanningDocumentName = typeof PLANNING_DOCUMENTS[number]
export type PlanningState = 'ready' | 'missing' | 'invalid' | 'unavailable'
export interface ScopeEntry { target: string; type: string; notes?: string }
export interface RoEView {
  engagement_name: string; client: string; start_date: string; end_date: string
  engagement_type: string; testing_window: string; authorization_reference?: string
  in_scope?: ScopeEntry[]; out_of_scope?: ScopeEntry[]
  prohibited_actions?: string[]; permitted_actions?: string[]
}
export interface ConopsView {
  engagement_name: string; executive_summary: string; attack_narrative?: string
  methodology?: string; success_criteria?: string[]
  threat_actors?: { name: string; sophistication: string; motivation: string }[]
}
export interface DeconflictionView {
  engagement_name: string; notification_procedure?: string; soc_contact?: string
  identifiers?: { type: string; value: string; description?: string }[]
}
export interface OpplanView {
  engagement_name: string; threat_profile: string
  objectives?: { id: string; title: string; description: string; phase: string; status?: string; blocked_by?: string[] }[]
}
export type PlanningDocument<T> = { state: 'ready'; content: T } | { state: Exclude<PlanningState, 'ready'> }
export interface PlanningView {
  version: 1; engagementId: string
  documents: {
    roe: PlanningDocument<RoEView>; conops: PlanningDocument<ConopsView>
    deconfliction: PlanningDocument<DeconflictionView>; opplan: PlanningDocument<OpplanView>
  }
  bundle: Record<PlanningDocumentName, PlanningState>
  readiness: { state: 'ready' | 'blocked'; reasons: string[]; runtimeSignal: 'not_observed' }
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const fields = (v: unknown, names: string[]): boolean => isRecord(v) && names.every(n => typeof v[n] === 'string')
const optional = (v: Record<string, unknown>, name: string, check: (x: unknown) => boolean): boolean => v[name] === undefined || check(v[name])
const rows = (check: (x: unknown) => boolean) => (v: unknown): boolean => Array.isArray(v) && v.every(check)

export function isPlanningContent(name: string, value: unknown): boolean {
  if (!isRecord(value) || typeof value.engagement_name !== 'string') return false
  if (name === 'roe') return fields(value, ['client', 'start_date', 'end_date', 'engagement_type', 'testing_window']) &&
    ['authorization_reference'].every(n => optional(value, n, x => typeof x === 'string')) &&
    ['in_scope', 'out_of_scope'].every(n => optional(value, n, rows(x => fields(x, ['target', 'type']) && isRecord(x) && optional(x, 'notes', y => typeof y === 'string')))) &&
    ['prohibited_actions', 'permitted_actions'].every(n => optional(value, n, strings))
  if (name === 'conops') return fields(value, ['executive_summary']) &&
    ['attack_narrative', 'methodology'].every(n => optional(value, n, x => typeof x === 'string')) &&
    optional(value, 'success_criteria', strings) && optional(value, 'threat_actors', rows(x => fields(x, ['name', 'sophistication', 'motivation'])))
  if (name === 'deconfliction') return ['notification_procedure', 'soc_contact'].every(n => optional(value, n, x => typeof x === 'string')) &&
    optional(value, 'identifiers', rows(x => fields(x, ['type', 'value']) && isRecord(x) && optional(x, 'description', y => typeof y === 'string')))
  if (name === 'opplan') return fields(value, ['threat_profile']) && optional(value, 'objectives', rows(x =>
    fields(x, ['id', 'title', 'description', 'phase']) && isRecord(x) && optional(x, 'status', y => typeof y === 'string') && optional(x, 'blocked_by', strings)))
  return false
}

export function isPlanningView(value: unknown): value is PlanningView {
  if (!isRecord(value) || value.version !== 1 || typeof value.engagementId !== 'string' || !isRecord(value.documents) || !isRecord(value.bundle) || !isRecord(value.readiness)) return false
  const states: string[] = ['ready', 'missing', 'invalid', 'unavailable']
  if (!PLANNING_DOCUMENTS.every(name => states.includes(String((value.bundle as Record<string, unknown>)[name])))) return false
  if (value.readiness.state === 'ready' && !PLANNING_DOCUMENTS.filter(n => n !== 'opplan').every(n => (value.bundle as Record<string, unknown>)[n] === 'ready')) return false
  for (const name of ['roe', 'conops', 'deconfliction', 'opplan']) {
    const doc = value.documents[name]
    if (!isRecord(doc) || doc.state !== value.bundle[name]) return false
    if (doc.state === 'ready' ? !isPlanningContent(name, doc.content) : !states.includes(String(doc.state)) || doc.content !== undefined) return false
  }
  return ['ready', 'blocked'].includes(String(value.readiness.state)) && strings(value.readiness.reasons) &&
    (value.readiness.state === 'ready' ? value.readiness.reasons.length === 0 : value.readiness.reasons.length > 0) && value.readiness.runtimeSignal === 'not_observed'
}
