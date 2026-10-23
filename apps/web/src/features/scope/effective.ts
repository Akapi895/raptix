/**
 * The scope decisions the Effective scope and ROE tabs show, as pure functions of the scope read and the asset records. Kept
 * apart from the screen so each decision and its source can be checked without rendering.
 */
import type { AssetListItem } from '../assets'
import type { ScopeRead } from './service'

export type Decision = 'in' | 'excluded' | 'pending' | 'undetermined'

export interface EffectiveRow {
  key: string
  target: string
  type: string
  decision: Decision
  source: string
  reason: string
  assetId: string | null
}

/**
 * The decision for each target, from the source that decides it: the engagement root and the effective version for what
 * is approved, the asset records for what is excluded, pending or not yet classified. An asset recorded as in scope but
 * absent from the effective version is kept and named as a mismatch, never quietly allowed.
 */
export function effectiveRows(view: ScopeRead, items: AssetListItem[]): EffectiveRow[] {
  const byIdent = new Map(items.map((item) => [item.asset.ident, item.asset] as const))
  const pending = view.revisions.find((r) => r.status === 'pending') ?? null
  const approvedFor = (target: string): string => {
    const grant = view.revisions.filter((r) => r.status === 'approved' && r.diff.added.includes(target)).sort((a, b) => a.version - b.version)[0]
    if (grant) return `Approved revision v${grant.version}`
    return view.effective.versionLabel ? `Effective version ${view.effective.versionLabel}` : 'Approved scope'
  }
  const rows: EffectiveRow[] = []
  const seen = new Set<string>()
  const root = view.effective.rootTarget
  if (root !== null) {
    rows.push({ key: `root:${root}`, target: root, type: byIdent.get(root)?.type ?? '—', decision: 'in', source: 'Engagement root target', reason: 'Always in scope under the engagement contract', assetId: byIdent.get(root)?.id ?? null })
    seen.add(root)
  }
  for (const target of view.effective.inScope) {
    if (seen.has(target)) continue
    seen.add(target)
    rows.push({ key: `in:${target}`, target, type: byIdent.get(target)?.type ?? '—', decision: 'in', source: approvedFor(target), reason: 'Approved in the effective version', assetId: byIdent.get(target)?.id ?? null })
  }
  for (const { asset } of items) {
    if (seen.has(asset.ident)) continue
    seen.add(asset.ident)
    const base = { key: `asset:${asset.id}`, target: asset.ident, type: asset.type, assetId: asset.id }
    if (asset.scope === 'in') {
      rows.push({ ...base, decision: 'in', source: 'Asset record only', reason: 'Recorded as in scope, but absent from the effective version. Not allowed until a revision approves it.' })
    } else if (asset.scope === 'out') {
      rows.push({ ...base, decision: 'excluded', source: 'Asset record', reason: 'Marked out of scope on the asset; never a target' })
    } else if (asset.scope === 'pending') {
      rows.push({ ...base, decision: 'pending', source: pending ? `Pending revision v${pending.version}` : 'Asset record', reason: 'Not approved until a reviewer approves a revision that includes it' })
    } else {
      rows.push({ ...base, decision: 'undetermined', source: 'Asset record', reason: 'Not yet classified, so it is not a target' })
    }
  }
  return rows
}

/** The label of a stored ROE field the backend does not model yet. */
export const NOT_MODELLED = 'Not modelled on this backend'

/** Operator-visible ROE policies, each with the state the console can honestly report for it. */
export interface PolicyRow {
  policy: string
  value: string
  enforcement: string
}

/** Each policy with the value the approved revision records and the enforcement state this console can report for it. */
export function policyRows(view: ScopeRead): PolicyRow[] {
  const effective = view.effective
  const windows = effective.roe.windows
  const zones = [...new Set(windows.map((w) => w.tz))].join(', ')
  return [
    { policy: 'Target boundary', value: `Approved scope ${effective.versionLabel ?? 'none yet'}`, enforcement: 'Not reported by the runtime' },
    { policy: 'Testing window', value: effective.windowText ?? (windows.length === 0 ? 'None (always allowed)' : 'Set'), enforcement: 'Not reported by the runtime' },
    { policy: 'Time zones', value: zones === '' ? '—' : zones, enforcement: 'Not reported by the runtime' },
    { policy: 'Emergency contact', value: effective.roe.emergencyContacts.length === 0 ? 'Missing' : effective.roe.emergencyContacts.join(', '), enforcement: 'Required for approval and preflight' },
    { policy: 'Restrictions', value: effective.roe.restrictions.length === 0 ? 'None recorded' : effective.roe.restrictions.join(' · '), enforcement: 'Not reported by the runtime' },
    { policy: 'Objectives', value: NOT_MODELLED, enforcement: '—' },
    { policy: 'Allowed activities', value: NOT_MODELLED, enforcement: '—' },
    { policy: 'Operational limits', value: NOT_MODELLED, enforcement: '—' },
    { policy: 'Data handling', value: NOT_MODELLED, enforcement: '—' },
    { policy: 'Abort & cleanup', value: NOT_MODELLED, enforcement: '—' },
  ]
}
