/**
 * The one route declaration (migration Mốc 4). Every route key appears once here. How the console renders a key, and the
 * lists derived from it (the real feature surfaces, the shared presentations), come from this table, so a key is changed in
 * one place.
 *
 * `real` says how the console renders the key:
 * - 'shared': a presentation mounted from its slice module (see registry.tsx); the slice names where the key is loaded from.
 * - 'feature': real panels composed by RealFeatureRoute (the title and the panel groups below).
 * - 'component': one real component, loaded on demand.
 * - 'system': a system page that renders itself.
 *
 * Feature-flagged keys are included only while their flag is on.
 */
import type { ComponentType } from 'react'
import { isAssetMapEnabled } from '../features/asset-map/flag'

/** The slice modules a shared presentation is mounted from (registry.tsx). */
export type SharedSlice = 'ov' | 'pj' | 'd' | 'e' | 'f' | 'st'

/** Real panel groups `RealFeatureRoute` can compose; each maps to one lazy-loaded panel component. */
export type PanelGroup = 'operations' | 'governance' | 'fleet' | 'scope' | 'analysis' | 'c2' | 'campaigns'

export type RealSurface =
  | { kind: 'shared'; slice: SharedSlice }
  | { kind: 'feature'; title: string; panels: readonly PanelGroup[] }
  | { kind: 'component'; load: () => Promise<ComponentType> }
  | { kind: 'system' }

export interface RouteDeclaration {
  real: RealSurface
}

const system: RealSurface = { kind: 'system' }
const shared = (slice: SharedSlice): RealSurface => ({ kind: 'shared', slice })
const feature = (title: string, panels: readonly PanelGroup[]): RealSurface => ({ kind: 'feature', title, panels })
const component = (load: () => Promise<ComponentType>): RealSurface => ({ kind: 'component', load })

const BASE_ROUTES: Record<string, RouteDeclaration> = {
  login: { real: component(() => import('../shell/real-login').then((m) => m.RealLogin)) },
  forbidden: { real: system },
  notfound: { real: system },
  error: { real: system },
  offline: { real: system },
  'session-expired': { real: system },
  overview: { real: shared('ov') },
  tasks: { real: component(() => import('../features/tasks').then((m) => m.RealCommandCenter)) },

  projects: { real: shared('pj') },
  'project-new': { real: component(() => import('../features/projects/routes').then((m) => m.RealProjectNewRoute)) },
  project: { real: component(() => import('../features/projects/routes').then((m) => m.RealProjectDetail)) },

  operations: { real: feature('Operations', ['operations']) },
  'operation-new': { real: feature('New operation', ['governance', 'operations']) },
  preflight: { real: feature('Preflight', ['governance']) },
  'operation-schedule': { real: feature('Operation scheduling', ['governance', 'operations']) },
  operation: { real: feature('Operation', ['operations']) },

  infrastructure: { real: component(() => import('../features/infrastructure').then((m) => m.RealInfrastructureRoute)) },
  agents: { real: feature('Agent fleet', ['fleet']) },
  agent: { real: feature('Agent detail', ['fleet']) },
  assets: { real: shared('d') },
  'asset-new': { real: shared('d') },
  'asset-scope': { real: shared('d') },
  asset: { real: shared('d') },
  capabilities: { real: shared('d') },
  playbook: { real: shared('d') },
  technique: { real: shared('d') },
  'playbook-review': { real: shared('d') },

  analysis: { real: feature('Observed analysis', ['analysis']) },
  findings: { real: shared('e') },
  'finding-new': { real: shared('e') },
  finding: { real: shared('e') },
  evidence: { real: shared('e') },
  'evidence-inspector': { real: shared('e') },

  reports: { real: shared('f') },
  'report-new': { real: shared('f') },
  report: { real: shared('f') },
  'report-preview': { real: shared('f') },
  'report-review': { real: shared('f') },
  settings: { real: shared('st') },

  'ai-operator': { real: component(() => import('../features/aichat').then((m) => m.RealWorkspace)) },
  'ai-plan': { real: feature('Business plan', ['governance']) },
  'ai-plan-review': { real: feature('Plan review', ['governance']) },
  'ai-plan-compare': { real: feature('Plan revisions', ['governance']) },
  'ai-trace': { real: component(() => import('../features/operations/trace-panel').then((m) => m.RealTrace)) },
  'ai-history': { real: component(() => import('../features/aichat').then((m) => m.RealWorkspace)) },
  'ai-fanout': { real: feature('Observed fanout', ['fleet']) },
  'ai-branch': { real: feature('Observed branch', ['fleet']) },

  c2: { real: feature('C2 access and console', ['c2', 'campaigns']) },
  'c2-channel': { real: feature('C2 channel', ['c2', 'campaigns']) },
  'c2-session': { real: feature('C2 session', ['c2', 'campaigns']) },
  'c2-console': { real: feature('C2 console', ['c2']) },
}

/** Feature-flagged (off by default): when off the key is absent, so the route resolves as unknown. */
const FLAGGED_ROUTES: Record<string, RouteDeclaration> = isAssetMapEnabled()
  ? { 'asset-map': { real: component(() => import('../features/asset-map').then((m) => m.AssetMapPage)) } }
  : {}

/** Every route key the console knows, once. */
export const ROUTES: Record<string, RouteDeclaration> = { ...BASE_ROUTES, ...FLAGGED_ROUTES }

/** Real-feature surfaces: the keys whose real rendering is RealFeatureRoute's composed panels. */
export const FEATURE_SURFACES: Record<string, { title: string; panels: readonly PanelGroup[] }> = Object.fromEntries(
  Object.entries(ROUTES).flatMap(([key, decl]) => (decl.real.kind === 'feature' ? [[key, { title: decl.real.title, panels: decl.real.panels }]] : [])),
)

/** Keys whose real rendering is a shared presentation mounted from a slice. */
export const SHARED_ROUTES: ReadonlySet<string> = new Set(
  Object.entries(ROUTES).flatMap(([key, decl]) => (decl.real.kind === 'shared' ? [key] : [])),
)

/** Keys that show the global resource in real mode when no project is scoped; the set is owned by the navigation feature. */
export { GLOBAL_RESOURCE_PAGES } from '../features/navigation'
