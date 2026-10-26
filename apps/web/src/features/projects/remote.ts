import { isProjectViewModel, isWorkspaceFileView, isWorkspaceTreeView, type ProjectViewModel, type WorkspaceFileView, type WorkspaceTreeView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';
import { guarded } from '../../platform/adapter-shared';
import { utcMinute } from '../../platform/format';
import type { ProjectRow, ProjectsService } from './service';
import type { Capability } from '@raptix/web-contracts';

export function isProjectViewModelArray(value: unknown): value is ProjectViewModel[] {
  return Array.isArray(value) && value.every(isProjectViewModel)
}

export function listEngagements(): Promise<ProjectViewModel[]> {
  return apiFetch('/engagements', isProjectViewModelArray)
}

export function getEngagement(id: string): Promise<ProjectViewModel> {
  return apiFetch(`/engagements/${encodeURIComponent(id)}`, (v): v is ProjectViewModel => isProjectViewModel(v) && v.id === id)
}

/** The subset of the demo wizard's create fields the engagement contract accepts. */
export interface CreateEngagementInput {
  name: string
  displayName?: string
  targetType: ProjectViewModel['targetType']
  targetValue: string
  authorizationConfirmed: true
  brief?: string
}

export function createEngagement(input: CreateEngagementInput): Promise<ProjectViewModel> {
  return apiFetch('/engagements', isProjectViewModel, { method: 'POST', body: input })
}

/** One-way planning-handoff confirmation (server stamps handoffConfirmedAt). */
export function confirmHandoff(engagementId: string): Promise<ProjectViewModel> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}`, (v): v is ProjectViewModel => isProjectViewModel(v) && v.id === engagementId, {
    method: 'PATCH',
    body: { handoffConfirmed: true },
  })
}

/** W22: edit the display name, primary target and brief on the project detail Settings tab. */
export function patchEngagement(engagementId: string, input: { displayName?: string; targetType?: ProjectViewModel['targetType']; targetValue?: string; brief?: string }): Promise<ProjectViewModel> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}`, (v): v is ProjectViewModel => isProjectViewModel(v) && v.id === engagementId, {
    method: 'PATCH',
    body: input,
  })
}

/**
 * Maps the public engagement DTO onto the console's UI Project entity.
 * Fields with no engagement-API source are explicit neutral values, never
 * fabricated: the portfolio/ribbon render them as unavailable rather than
 * as demo-shaped facts. `lifecycleStatus` maps 1:1 (raw status is kept).
 */
export function engagementToProject(dto: ProjectViewModel): import('../../domain/entities').Project {
  return {
    id: dto.id,
    name: dto.displayName,
    client: '',
    owner: '',
    type: dto.targetType,
    status: dto.lifecycleStatus,
    start: '',
    end: '',
    tz: 'UTC',
    desc: dto.brief ?? '',
    pinned: false,
    roeStatus: 'none',
    roeVersion: '',
    window: '',
    emergency: '',
    methods: [],
    restrictions: [],
    objectives: [],
    members: [],
    updated: dto.updatedAt,
  }
}

/** Real project list: the engagement API's records, most recently updated first; each field is what the API carries. */
export function createRealProjectsService(): ProjectsService {
  return {
    list: () => guarded(async () => {
      const projects = await listEngagements()
      const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return {
        ok: true,
        data: sorted.map((p): ProjectRow => ({
          id: p.id,
          name: p.displayName,
          workspaceSlug: p.workspaceSlug,
          target: p.targetValue,
          targetType: p.targetType,
          metadataVerified: p.metadataState === 'verified',
          status: p.lifecycleStatus,
          updatedAt: utcMinute(p.updatedAt),
          updatedAtIso: p.updatedAt,
        })),
      }
    }),
  }
}

/** Why the project list is unavailable, worded as the capability document states it (the same wording the readiness hook uses). */
export function projectsUnavailableReason(capability: Capability | null): string {
  if (!capability || !capability.supported) return 'This capability is not implemented on the connected server.'
  if (!capability.available) return capability.reason ? `Unavailable: ${capability.reason.replace(/_/g, ' ')}.` : 'This capability is currently unavailable on the server.'
  return 'Projects are unavailable on this server.'
}

export function fetchWorkspaceTree(engagementId: string): Promise<WorkspaceTreeView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/workspace/tree`, isWorkspaceTreeView)
}

export function fetchWorkspaceFile(engagementId: string, path: string): Promise<WorkspaceFileView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/workspace/file?path=${encodeURIComponent(path)}`, isWorkspaceFileView)
}
