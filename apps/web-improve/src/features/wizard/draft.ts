/**
 * Project wizard draft: schema, step map and compat adapters (ticket 17,
 * ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * One typed draft powers all five steps. The information and objectives
 * steps validate through the Zod schema below (React Hook Form +
 * zodResolver in the shell hook); scope/ROE/assets/team keep their legacy
 * validators as `compat` step definitions until tickets 18/19 migrate them
 * onto the same schema — the seam is each step's optional `fields` (migrated)
 * versus `validator` (compat). Creation still commits through the single
 * legacy store action (`A.createProject`) via {@link toLegacyProjectDraft};
 * no second project creation path or database is introduced.
 */
import { z } from 'zod'
import type { ProjectDraft } from '../../store'
import type { Role } from '../../data'

export const LIMIT_PRESETS = [
  'No service disruption',
  'No access to real customer data',
  'Stop immediately on request from the emergency contact',
  'No destructive data techniques',
  'No denial-of-service attacks',
]

/** Next free demo project code for the assessment type (RT/PT prefix). */
export const nextId = (ids: readonly string[], type: string) => {
  const pre = type === 'Purple Team' ? 'PT' : 'RT'
  const nums = ids.filter((i) => i.startsWith(pre + '-2026-')).map((i) => parseInt(i.slice(-3)) || 0)
  return `${pre}-2026-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** ISO date input value → the demo dataset's "Oct 20, 2026" display form. */
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return iso && y && m && d ? `${MON[+m - 1]} ${+d}, ${y}` : ''
}

/* ── Step field groups ── */
export const INFO_FIELDS = ['name', 'id', 'client', 'type', 'desc', 'start', 'end', 'tz', 'owner', 'tags'] as const
export const OBJECTIVE_FIELDS = ['goal', 'objectives', 'success', 'metrics', 'unit', 'reportReq'] as const

const infoFields = {
  name: z.string().trim().min(1, 'Enter a project name.'),
  id: z.string().trim().min(1, 'Enter a project code.').regex(/^[A-Z]{2}-\d{4}-\d{3}$/, 'Code must look like RT-2026-016.'),
  client: z.string().trim().min(1, 'Select or enter a client / organization.'),
  type: z.string(),
  desc: z.string(),
  start: z.string().min(1, 'Choose a start date.'),
  end: z.string().min(1, 'Choose an end date.'),
  tz: z.string().min(1, 'Choose a time zone.'),
  owner: z.string().min(1, 'Choose a primary owner.'),
  tags: z.array(z.string()),
}
const objectiveFields = {
  goal: z.string().trim().min(1, 'Enter the main objective of the project.'),
  objectives: z.array(z.object({ text: z.string(), criteria: z.string() })),
  success: z.string(),
  metrics: z.string(),
  unit: z.string(),
  reportReq: z.string(),
}
/* Compat (tickets 18/19): permissive until the scope/ROE/assets/team steps
 * migrate onto real constraints in this schema. */
const compatFields = {
  scopeDesc: z.string(),
  window: z.string(),
  sensitivity: z.string(),
  limits: z.array(z.string()),
  emergency: z.string(),
  channel: z.string(),
  roeFile: z.string(),
  approver: z.string(),
  assets: z.array(z.object({ name: z.string(), ident: z.string(), type: z.string(), scope: z.enum(['in', 'out']) })),
  members: z.array(z.object({ user: z.string(), role: z.string() })),
}

export const wizardSchema = z.object({ ...infoFields, ...objectiveFields, ...compatFields })
export type WizardDraft = z.infer<typeof wizardSchema>

const dupIdMessage = (ids: readonly string[], w: WizardDraft) =>
  `Code ${w.id} already exists. Use another code (suggested: ${nextId(ids, w.type)}).`

/**
 * The one resolver schema, built per wizard mount: cross-field rules (date
 * order, objective presence, duplicate code) run identically for RHF and the
 * step validators. `when` keeps the refines independent of the required-field
 * checks, matching the legacy per-field validators. `ids` freezes at mount —
 * the wizard cannot create projects mid-flow.
 */
export const makeWizardSchema = (ids: readonly string[]) =>
  wizardSchema.superRefine((w, ctx) => {
    if (w.start && w.end && w.end < w.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'End date cannot be before the start date.' })
    if (!w.objectives.some((o) => o.text.trim())) ctx.addIssue({ code: 'custom', path: ['objectives'], message: 'Add at least one specific objective.' })
    if (ids.includes(w.id)) ctx.addIssue({ code: 'custom', path: ['id'], message: dupIdMessage(ids, w) })
  }, { when: () => true })

export const defaultWizardDraft = (ids: readonly string[], me: string): WizardDraft => ({
  name: '', id: nextId(ids, 'Red Team'), client: '', type: 'Red Team', desc: '', start: '2026-10-20', end: '2026-11-20',
  tz: 'UTC+07:00', owner: me, tags: [],
  goal: '', success: '', sensitivity: 'Synthetic / lab only', objectives: [{ text: '', criteria: '' }], metrics: '', unit: '', reportReq: '',
  scopeDesc: '', window: 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)', limits: LIMIT_PRESETS.slice(0, 3), emergency: '', channel: '', roeFile: '', approver: 'Pat Kim',
  assets: [], members: [{ user: 'Pat Kim', role: 'reviewer' }],
})

/* ── Step-level sync validation ── */
const issuesFor = (w: WizardDraft, ids: readonly string[], fields: readonly string[]) => {
  const e: Record<string, string> = {}
  const res = makeWizardSchema(ids).safeParse(w)
  if (!res.success) {
    for (const issue of res.error.issues) {
      const key = String(issue.path[0])
      if (fields.includes(key) && !e[key]) e[key] = issue.message
    }
  }
  return e
}

/* Compat validators, verbatim from the legacy screen until 18/19 migrate
 * them into the schema above. */
export const scopeIssues = (w: WizardDraft): Record<string, string> => {
  const e: Record<string, string> = {}
  if (!w.scopeDesc.trim()) e.scopeDesc = 'Describe the testing scope.'
  if (!w.window.trim()) e.window = 'Enter the permitted testing days and hours.'
  return e
}
export const roeIssues = (w: WizardDraft): Record<string, string> => {
  const e: Record<string, string> = {}
  if (!w.approver) e.approver = 'Choose a requested reviewer.'
  else if (w.approver === w.owner) e.approver = 'The reviewer must be different from the owner.'
  else if (!w.members.some((m) => m.user === w.approver)) e.approver = 'The requested reviewer must be on the member list.'
  return e
}

/** One step's errors from the shared schema (migrated) or legacy validator (compat). */
export const validateWizardStep = (i: number, w: WizardDraft, ids: readonly string[]): Record<string, string> => {
  const def = WIZARD_STEPS[i]
  if (!def || i === WIZARD_STEPS.length - 1) return {}
  if (def.fields) return issuesFor(w, ids, def.fields)
  return def.validator ? def.validator(w) : {}
}

/* ── Step map ── */
export type WizardField = Extract<keyof WizardDraft, string>
export interface WizardStepDef {
  id: 'info' | 'objectives' | 'scope' | 'roe' | 'review'
  name: string
  /** Migrated steps validate these fields through the shared Zod schema. */
  fields?: readonly WizardField[]
  /** Compat steps keep their legacy validator until their owner ticket lands. */
  validator?: (w: WizardDraft) => Record<string, string>
}
export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: 'info', name: '1. Basic Details', fields: INFO_FIELDS },
  { id: 'objectives', name: '2. Objectives', fields: OBJECTIVE_FIELDS },
  { id: 'scope', name: '3. Scope', validator: scopeIssues },
  { id: 'roe', name: '4. ROE & Approvals', validator: roeIssues },
  { id: 'review', name: '5. Review & Create' },
]

/* ── Review panel (step 5) and the submit gate ── */
export interface ReviewIssue { key: string; label: string; ok: boolean; level?: 'review'; detail: string; step: number }

/** Pass/review/fail rows for the review step; failures block only submit. */
export const reviewIssues = (w: WizardDraft, errs: Record<string, string>[]): ReviewIssue[] => {
  const inAssets = w.assets.filter((a) => a.scope === 'in')
  const outAssets = w.assets.filter((a) => a.scope === 'out')
  const incomplete = w.objectives.filter((o) => (o.text.trim() && !o.criteria.trim()) || (!o.text.trim() && o.criteria.trim()))
  const objCount = w.objectives.filter((o) => o.text.trim()).length
  return [
    { key: 'info', label: 'Basic details are valid', ok: Object.keys(errs[0]).length === 0, detail: errs[0].id ?? errs[0].name ?? errs[0].client ?? Object.values(errs[0])[0] ?? `${w.id} — ${w.client}`, step: 0 },
    { key: 'obj', label: 'Main and specific objectives', ok: Object.keys(errs[1]).length === 0 && incomplete.length === 0, detail: errs[1].goal ?? errs[1].objectives ?? (incomplete.length ? `${incomplete.length} objectives are missing text or criteria` : `${objCount} objectives`), step: 1 },
    { key: 'asset', label: 'At least one in-scope asset', ok: inAssets.length > 0, detail: inAssets.length ? `${inAssets.length} in scope, ${outAssets.length} out of scope` : 'No assets yet. You can save a draft but cannot submit for approval.', step: 2 },
    { key: 'window', label: 'Permitted assessment window', ok: !errs[2].window, detail: w.window || 'Not entered', step: 2 },
    { key: 'emerg', label: 'Emergency contact provided', ok: !!w.emergency.trim(), detail: w.emergency.trim() || 'Emergency contact missing. Required to submit for approval (PRE-09).', step: 2 },
    { key: 'file', label: 'ROE document attached', ok: !!w.roeFile, level: 'review', detail: w.roeFile || 'Not attached. The reviewer may request it.', step: 2 },
    { key: 'appr', label: 'Valid requested reviewer', ok: Object.keys(errs[3]).length === 0, detail: errs[3].approver ?? `${w.approver} is the requested reviewer`, step: 3 },
  ]
}

/* ── The one creation adapter: wizard draft → legacy store action ── */
export const toLegacyProjectDraft = (w: WizardDraft): ProjectDraft => {
  const { success, sensitivity, ...rest } = w
  return {
    ...rest,
    start: fmtDate(w.start),
    end: fmtDate(w.end),
    objectives: w.objectives.filter((o) => o.text.trim()),
    members: w.members.map((m) => ({ user: m.user, role: m.role as Role })),
    desc: [w.desc, w.goal && `Main objective: ${w.goal}`, success && `Success criteria: ${success}`, `Data sensitivity: ${sensitivity}`].filter(Boolean).join('\n'),
  }
}
