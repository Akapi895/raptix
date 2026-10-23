/**
 * The one route declaration (migration Mốc 4). Every route key appears once here. The mock slice that resolves a key, the
 * real-mode rendering, and the lists derived from them (the real feature surfaces, the shared presentations) all come from
 * this table, so a key is changed in one place.
 *
 * `slice` names the module the key is mounted from (see registry.tsx). `real` says how real mode renders the key:
 * - 'shared': the same presentation the slice mounts; one presentation for both modes.
 * - 'feature': real panels composed by RealFeatureRoute (the title and the panel groups below).
 * - 'component': one real-only component, loaded on demand.
 * - 'system': a system page that renders itself.
 * - 'unavailable': the honest not-connected panel; no demo content.
 *
 * Feature-flagged keys are included only while their flag is on.
 */
import type { ComponentType } from 'react'
import { isAssetMapEnabled } from '../features/asset-map/flag'
import { PROTOTYPE_PAGES_ENABLED } from './prototype-pages'

export type Slice = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 's' | 'st' | 'pj' | 'ov' | 'dp' | 'am'

/** Real panel groups `RealFeatureRoute` can compose; each maps to one lazy-loaded panel component. */
export type PanelGroup = 'operations' | 'governance' | 'fleet' | 'scope' | 'analysis' | 'c2' | 'campaigns'

export type RealSurface =
  | { kind: 'shared' }
  | { kind: 'feature'; title: string; panels: readonly PanelGroup[] }
  | { kind: 'component'; load: () => Promise<ComponentType> }
  | { kind: 'system' }
  | { kind: 'unavailable' }

export interface RouteDeclaration {
  slice: Slice
  real: RealSurface
}

const shared: RealSurface = { kind: 'shared' }
const system: RealSurface = { kind: 'system' }
const unavailable: RealSurface = { kind: 'unavailable' }
const feature = (title: string, panels: readonly PanelGroup[]): RealSurface => ({ kind: 'feature', title, panels })
const component = (load: () => Promise<ComponentType>): RealSurface => ({ kind: 'component', load })

const BASE_ROUTES: Record<string, RouteDeclaration> = {
  login: { slice: 'a', real: component(() => import('../shell/real-login').then((m) => m.RealLogin)) },
  forbidden: { slice: 'a', real: system },
  notfound: { slice: 'a', real: system },
  error: { slice: 'a', real: system },
  offline: { slice: 'a', real: system },
  'session-expired': { slice: 'a', real: system },
  overview: { slice: 'ov', real: shared },
  tasks: { slice: 'a', real: component(() => import('../features/tasks').then((m) => m.RealCommandCenter)) },

  projects: { slice: 'pj', real: shared },
  'project-new': { slice: 'b', real: component(() => import('../features/projects/routes').then((m) => m.RealProjectNewRoute)) },
  project: { slice: 'dp', real: component(() => import('../features/projects/routes').then((m) => m.RealProjectDetail)) },

  operations: { slice: 'c', real: feature('Operations', ['operations']) },
  'operation-new': { slice: 'c', real: feature('New operation', ['governance', 'operations']) },
  preflight: { slice: 'c', real: feature('Preflight', ['governance']) },
  'operation-schedule': { slice: 'c', real: feature('Operation scheduling', ['governance', 'operations']) },
  operation: { slice: 'c', real: feature('Operation', ['operations']) },

  infrastructure: { slice: 'i', real: component(() => import('../features/infrastructure').then((m) => m.RealInfrastructureRoute)) },
  agents: { slice: 'i', real: feature('Agent fleet', ['fleet']) },
  agent: { slice: 'd', real: feature('Agent detail', ['fleet']) },
  assets: { slice: 'd', real: shared },
  'asset-new': { slice: 'd', real: shared },
  'asset-scope': { slice: 'd', real: shared },
  asset: { slice: 'd', real: shared },
  capabilities: { slice: 'd', real: shared },
  playbook: { slice: 'd', real: shared },
  technique: { slice: 'd', real: shared },
  'playbook-review': { slice: 'd', real: shared },

  analysis: { slice: 'e', real: feature('Observed analysis', ['analysis']) },
  findings: { slice: 'e', real: shared },
  'finding-new': { slice: 'e', real: shared },
  finding: { slice: 'e', real: shared },
  evidence: { slice: 'e', real: shared },
  'evidence-inspector': { slice: 'e', real: shared },

  reports: { slice: 'f', real: shared },
  'report-new': { slice: 'f', real: shared },
  report: { slice: 'f', real: shared },
  'report-preview': { slice: 'f', real: shared },
  'report-review': { slice: 'f', real: shared },
  settings: { slice: 'st', real: shared },

  'ai-operator': { slice: 'g', real: component(() => import('../features/aichat').then((m) => m.RealWorkspace)) },
  'ai-plan': { slice: 'g', real: feature('Business plan', ['governance']) },
  'ai-plan-review': { slice: 'g', real: feature('Plan review', ['governance']) },
  'ai-plan-compare': { slice: 'g', real: feature('Plan revisions', ['governance']) },
  'ai-trace': { slice: 'g', real: component(() => import('../features/operations/trace-panel').then((m) => m.RealTrace)) },
  'ai-history': { slice: 'g', real: component(() => import('../features/aichat').then((m) => m.RealWorkspace)) },
  'ai-fanout': { slice: 'g', real: feature('Observed fanout', ['fleet']) },
  'ai-branch': { slice: 'g', real: feature('Observed branch', ['fleet']) },

  c2: { slice: 'i', real: feature('C2 access and console', ['c2', 'campaigns']) },
  'c2-channel': { slice: 'h', real: feature('C2 channel', ['c2', 'campaigns']) },
  'c2-session': { slice: 'h', real: feature('C2 session', ['c2', 'campaigns']) },
  'c2-console': { slice: 'h', real: feature('C2 console', ['c2']) },
}

/** Prototype and QA pages (build-gated, see prototype-pages.ts): when off the keys are absent, so the routes resolve as unknown. */
const PROTOTYPE_ROUTES: Record<string, RouteDeclaration> = PROTOTYPE_PAGES_ENABLED
  ? {
      states: { slice: 'a', real: unavailable },
      scenarios: { slice: 's', real: unavailable },
      workspaces: { slice: 's', real: unavailable },
    }
  : {}

/** Feature-flagged (off by default): when off the key is absent, so the route resolves as unknown. */
const FLAGGED_ROUTES: Record<string, RouteDeclaration> = isAssetMapEnabled()
  ? { 'asset-map': { slice: 'am', real: component(() => import('../features/asset-map').then((m) => m.AssetMapPage)) } }
  : {}

/** Every route key the console knows, once. */
export const ROUTES: Record<string, RouteDeclaration> = { ...BASE_ROUTES, ...PROTOTYPE_ROUTES, ...FLAGGED_ROUTES }

/** Real-feature surfaces: the keys whose real rendering is RealFeatureRoute's composed panels. */
export const FEATURE_SURFACES: Record<string, { title: string; panels: readonly PanelGroup[] }> = Object.fromEntries(
  Object.entries(ROUTES).flatMap(([key, decl]) => (decl.real.kind === 'feature' ? [[key, { title: decl.real.title, panels: decl.real.panels }]] : [])),
)

/** Keys whose real rendering is the shared presentation the mock slice mounts too. */
export const SHARED_ROUTES: ReadonlySet<string> = new Set(
  Object.entries(ROUTES).flatMap(([key, decl]) => (decl.real.kind === 'shared' ? [key] : [])),
)

/** Keys that show the global resource in real mode when no project is scoped (host.tsx applies the scope rule). */
export const GLOBAL_RESOURCE_PAGES: ReadonlySet<string> = new Set(['reports', 'operations', 'analysis', 'agents', 'c2'])
