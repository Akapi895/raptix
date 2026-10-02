/**
 * Real-mode projects state (W03): a light custom store (no query library)
 * consumed via `useSyncExternalStore`, matching the existing mock-adapter
 * pattern in `src/mocks/adapters`.
 *
 * Guarantees:
 * - Reads are deduped per key (single-flight) and scoped: each key owns an
 *   AbortController; when the last subscriber releases, the read aborts.
 * - Superseded/aborted responses never overwrite state (controller guard).
 * - Read errors land in the snapshot (`status: 'error'`); nothing falls back
 *   to fixtures. Mutations never auto-retry; their errors go to the caller.
 * - Mutations refresh the list, seed the detail cache, and return the
 *   validated server DTO (real DB id — never a locally generated one).
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { ApiClientError, ApiCanceledError, ApiNetworkError } from '../../../shared/api/errors'
import { realProjectsApi } from '../api/projects-real'
import type { CreateProjectRequest, ProjectPatch } from '../api/projects-api'

export type RealProjectsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RealProjectsSnapshot {
  status: RealProjectsStatus
  projects: readonly ProjectViewModel[]
  error: ApiClientError | null
}

export interface RealProjectSnapshot {
  status: RealProjectsStatus
  project: ProjectViewModel | null
  error: ApiClientError | null
}

export interface RealProjectsActions {
  reload(): void
  createProject(input: CreateProjectRequest): Promise<ProjectViewModel>
  updateSupportedFields(id: string, patch: ProjectPatch): Promise<ProjectViewModel>
}

const LIST_KEY = 'list'
const IDLE_PROJECTS: RealProjectsSnapshot = { status: 'idle', projects: [], error: null }
const IDLE_PROJECT: RealProjectSnapshot = { status: 'idle', project: null, error: null }

interface Entry {
  kind: 'list' | 'detail'
  id?: string
  refs: number
  controller: AbortController | null
  inFlight: Promise<void> | null
  list?: RealProjectsSnapshot
  detail?: RealProjectSnapshot
}

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

function ensureEntry(key: string, make: () => Entry): Entry {
  let entry = entries.get(key)
  if (!entry) { entry = make(); entries.set(key, entry) }
  return entry
}

function detailKey(id: string): string { return `detail:${encodeURIComponent(id)}` }

function listEntry(): Entry {
  return ensureEntry(LIST_KEY, () => ({ kind: 'list', refs: 0, controller: null, inFlight: null }))
}

function detailEntry(id: string): Entry {
  return ensureEntry(detailKey(id), () => ({ kind: 'detail', id, refs: 0, controller: null, inFlight: null }))
}

function publish(entry: Entry, next: RealProjectsSnapshot | RealProjectSnapshot): void {
  if (entry.kind === 'list') entry.list = next as RealProjectsSnapshot; else entry.detail = next as RealProjectSnapshot
  notify()
}

const isListResult = (value: readonly ProjectViewModel[] | ProjectViewModel): value is readonly ProjectViewModel[] =>
  Array.isArray(value)

function startRead(entry: Entry): void {
  const controller = new AbortController()
  entry.controller = controller
  publish(entry, entry.kind === 'list'
    ? { status: 'loading', projects: entry.list?.projects ?? [], error: null }
    : { status: 'loading', project: entry.detail?.project ?? null, error: null })
  const request: Promise<readonly ProjectViewModel[] | ProjectViewModel> = entry.kind === 'list'
    ? realProjectsApi.list(controller.signal)
    : realProjectsApi.get(entry.id ?? '', controller.signal)
  const settled = entry.inFlight = request.then(
    result => {
      if (entry.controller !== controller || controller.signal.aborted) return
      publish(entry, isListResult(result)
        ? { status: 'ready', projects: result, error: null }
        : { status: 'ready', project: result, error: null })
    },
    error => {
      if (entry.controller !== controller || controller.signal.aborted) return
      if (error instanceof ApiCanceledError) return
      const clientError = error instanceof ApiClientError ? error : new ApiNetworkError(error)
      publish(entry, entry.kind === 'list'
        ? { status: 'error', projects: entry.list?.projects ?? [], error: clientError }
        : { status: 'error', project: entry.detail?.project ?? null, error: clientError })
    },
  )
  void settled.finally(() => {
    if (entry.controller === controller) { entry.controller = null; entry.inFlight = null }
  })
}

function retain(entry: Entry): void {
  entry.refs += 1
  if (!entry.inFlight) startRead(entry)
}

function release(entry: Entry): void {
  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs === 0 && entry.controller) {
    entry.controller.abort(); entry.controller = null; entry.inFlight = null
  }
}

function seedAndRefresh(project: ProjectViewModel): void {
  const detail = detailEntry(project.id)
  detail.detail = { status: 'ready', project, error: null }
  notify()
  const list = listEntry()
  if (list.controller) { list.controller.abort(); list.controller = null; list.inFlight = null }
  startRead(list)
}

async function mutate(run: () => Promise<ProjectViewModel>): Promise<ProjectViewModel> {
  const project = await run()
  seedAndRefresh(project)
  return project
}

export function createProjectReal(input: CreateProjectRequest): Promise<ProjectViewModel> {
  return mutate(() => realProjectsApi.create(input))
}

export function updateProjectReal(id: string, patch: ProjectPatch): Promise<ProjectViewModel> {
  return mutate(() => realProjectsApi.updateSupportedFields(id, patch))
}

function reloadEntry(entry: Entry): void {
  if (!entry.inFlight) startRead(entry)
}

export function reloadProjects(): void { reloadEntry(listEntry()) }

export function reloadProject(id: string): void { reloadEntry(detailEntry(id)) }

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function readListSnapshot(): RealProjectsSnapshot {
  return entries.get(LIST_KEY)?.list ?? IDLE_PROJECTS
}

export function useRealProjects(): RealProjectsSnapshot & RealProjectsActions {
  useEffect(() => {
    const entry = listEntry()
    retain(entry)
    return () => release(entry)
  }, [])
  const snapshot = useSyncExternalStore(subscribe, readListSnapshot, readListSnapshot)
  return {
    ...snapshot,
    reload: reloadProjects,
    createProject: createProjectReal,
    updateSupportedFields: updateProjectReal,
  }
}

export function useRealProject(id: string | null): RealProjectSnapshot & { reload(): void } {
  const key = id === null ? null : detailKey(id)
  useEffect(() => {
    if (id === null || key === null) return
    const entry = detailEntry(id)
    retain(entry)
    return () => release(entry)
  }, [id, key])
  const readSnapshot = () => (key === null ? IDLE_PROJECT : entries.get(key)?.detail ?? IDLE_PROJECT)
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  return { ...snapshot, reload: () => { if (id !== null) reloadProject(id) } }
}

/**
 * Imperative seam backing the hooks (used by contract tests and any
 * non-component caller): refcounted retention with dedup + abort semantics,
 * snapshot readers, explicit reloads and a test reset.
 */
export const projectsStore = {
  retainList: () => { retain(listEntry()) },
  releaseList: () => { release(listEntry()) },
  retainProject: (id: string) => { retain(detailEntry(id)) },
  releaseProject: (id: string) => { release(detailEntry(id)) },
  readList: readListSnapshot,
  readProject: (id: string): RealProjectSnapshot => entries.get(detailKey(id))?.detail ?? IDLE_PROJECT,
  reloadList: reloadProjects,
  reloadProject,
  reset: () => { for (const entry of entries.values()) entry.controller?.abort(); entries.clear(); listeners.clear() },
}
