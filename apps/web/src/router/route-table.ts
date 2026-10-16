/**
 * Single source of truth for which route keys render through
 * `RealFeatureRoute` (src/real/screens/feature-route.tsx) and what each one
 * shows — structural hardening, 2026-10-16 (see
 * docs/design/2026-10-16-web-mock-to-operational-system-implementation-plan.md).
 *
 * Previously this lived as two hand-maintained literals (one array of keys in
 * `router/host.tsx`, one `SURFACES` object in `real/screens/feature-route.tsx`)
 * that had to be edited together with nothing enforcing it; a key present in
 * one and missing from the other would resolve `undefined` and crash on
 * render. Both files now derive from this table instead.
 *
 * Several mock screens intentionally collapse onto one real panel group, and
 * one route key can render more than one panel (e.g. `asset-scope` shows both
 * the Assets and Scope panels) — that N:1/1:N shape is real (ADR-0078,
 * plan §4.1: AI instance, fleet, and C2 session are distinct entities) and is
 * recorded here explicitly via `mockScreens`/`panels` rather than implied by
 * matching file names.
 */

/** Real panel groups `RealFeatureRoute` can compose; each maps to one lazy-loaded panel component. */
export type PanelGroup =
  | 'operations' | 'governance' | 'fleet' | 'scope'
  | 'reports' | 'analysis' | 'c2' | 'campaigns' | 'assets' | 'library-review'

export interface RouteSurface {
  /** Page title `RealFeatureRoute` renders in the header. */
  readonly title: string
  /** Real panel groups rendered for this key, in display order. */
  readonly panels: readonly PanelGroup[]
  /** Mock screen file(s) under src/screens/ that render this key in mock mode — documentation only, never imported here. */
  readonly mockScreens: readonly string[]
}

/** Route keys composed through `RealFeatureRoute`; `Object.keys(...)` is the authoritative key list for `router/host.tsx`'s `REAL_PAGES`. */
export const FEATURE_ROUTE_SURFACES: Record<string, RouteSurface> = {
  operations: { title: 'Operations', panels: ['operations'], mockScreens: ['c-console.tsx'] },
  operation: { title: 'Operation', panels: ['operations'], mockScreens: ['c-console.tsx', 'c-results.tsx'] },
  'operation-new': { title: 'New operation', panels: ['governance', 'operations'], mockScreens: ['c.tsx'] },
  preflight: { title: 'Preflight', panels: ['governance'], mockScreens: ['c-console.tsx'] },
  'operation-schedule': { title: 'Operation scheduling', panels: ['governance', 'operations'], mockScreens: ['c-console.tsx'] },
  agents: { title: 'Agent fleet', panels: ['fleet'], mockScreens: ['d-agents.tsx'] },
  agent: { title: 'Agent detail', panels: ['fleet'], mockScreens: ['d-agents.tsx'] },
  'ai-fanout': { title: 'Observed fanout', panels: ['fleet'], mockScreens: ['g-fanout.tsx'] },
  'ai-branch': { title: 'Observed branch', panels: ['fleet'], mockScreens: ['g-fanout.tsx'] },
  asset: { title: 'Asset detail', panels: ['assets'], mockScreens: ['d-assets.tsx'] },
  'asset-new': { title: 'Import assets', panels: ['assets'], mockScreens: ['d-assets.tsx'] },
  'asset-scope': { title: 'Asset scope', panels: ['assets', 'scope'], mockScreens: ['d-assets.tsx'] },
  analysis: { title: 'Observed analysis', panels: ['analysis'], mockScreens: ['e-analysis.tsx'] },
  reports: { title: 'Reports', panels: ['reports'], mockScreens: ['f-report.tsx'] },
  'report-new': { title: 'New report', panels: ['reports'], mockScreens: ['f-report.tsx'] },
  report: { title: 'Report editor', panels: ['reports'], mockScreens: ['f-report.tsx'] },
  'report-preview': { title: 'Report preview', panels: ['reports'], mockScreens: ['f-report.tsx'] },
  'report-review': { title: 'Report review', panels: ['reports'], mockScreens: ['f-report.tsx'] },
  'ai-plan': { title: 'Business plan', panels: ['governance'], mockScreens: ['g-plan.tsx'] },
  'ai-plan-review': { title: 'Plan review', panels: ['governance'], mockScreens: ['g-plan.tsx'] },
  'ai-plan-compare': { title: 'Plan revisions', panels: ['governance'], mockScreens: ['g-plan.tsx'] },
  c2: { title: 'C2 access and console', panels: ['c2', 'campaigns'], mockScreens: ['h-session.tsx'] },
  'c2-channel': { title: 'C2 channel', panels: ['c2', 'campaigns'], mockScreens: ['h-session.tsx'] },
  'c2-session': { title: 'C2 session', panels: ['c2', 'campaigns'], mockScreens: ['h-session.tsx'] },
  'c2-console': { title: 'C2 console', panels: ['c2'], mockScreens: ['h-session.tsx'] },
  'playbook-review': { title: 'Library review proposals', panels: ['library-review'], mockScreens: ['d-library.tsx'] },
}

/** Route keys whose mock screen is the operational UI in both modes (plan 2026-10-16 screens unification); `router/host.tsx` renders them before `REAL_PAGES`. */
export const MIGRATED_ROUTES: ReadonlySet<string> = new Set(['findings', 'finding', 'finding-new', 'evidence', 'evidence-inspector'])
