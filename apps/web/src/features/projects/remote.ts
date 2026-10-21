import { isProjectViewModel, type ProjectViewModel } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';

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
export function patchEngagement(engagementId: string, input: { displayName?: string; targetValue?: string; brief?: string }): Promise<ProjectViewModel> {
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
