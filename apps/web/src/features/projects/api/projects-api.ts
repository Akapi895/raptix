/**
 * Public projects API contract (W03): the only projects surface the UI may
 * call in real mode. Mock/real implementations share these signatures.
 *
 * `CreateProjectRequest.authorizationConfirmed` is a literal `true`: the new
 * API rejects creation without explicit authorization (HTTP 400), so the type
 * cannot even express an unconfirmed create. `name` is the workspace slug
 * (server-enforced: 3-64 chars, [a-z0-9], internal hyphens only).
 */
import type { EngagementTargetType, ProjectViewModel } from '@raptix/web-contracts'

export interface CreateProjectRequest {
  name: string
  displayName?: string
  targetType: EngagementTargetType
  targetValue: string
  authorizationConfirmed: true
  /** Operator brief — required; the prompt Soundwave drafts scope/RoE from. */
  brief: string
}

/** Only these fields are patchable (PATCH /api/engagements/:id). */
export interface ProjectPatch {
  displayName?: string
  targetType?: EngagementTargetType
  targetValue?: string
  /** One-way handoff confirmation; only `true` is accepted. */
  handoffConfirmed?: true
}

export interface ProjectsApi {
  list(signal?: AbortSignal): Promise<readonly ProjectViewModel[]>
  get(id: string, signal?: AbortSignal): Promise<ProjectViewModel>
  create(input: CreateProjectRequest): Promise<ProjectViewModel>
  updateSupportedFields(id: string, patch: ProjectPatch): Promise<ProjectViewModel>
}
