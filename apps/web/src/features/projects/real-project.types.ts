/**
 * W03 real-projects shared feature module: the exact prop contracts for the
 * real Home/New Project UI plus the pure helpers its components and tests
 * share. No React, no fetch, no fixtures — components own all rendering.
 */
import type {
  EngagementStatus,
  EngagementTargetType,
  ProjectViewModel,
} from '@raptix/web-contracts'

export type RealProjectFilter = 'all' | EngagementStatus

export interface RealProjectsHomeProps {
  projects: ProjectViewModel[]
  loading: boolean
  error: string | null
  /** Parent-owned navigation: receives the full public view model. */
  onEnter: (project: ProjectViewModel) => void
  onCreate: () => void
  onRefresh: () => void
}

export type CreateProjectField =
  | 'name'
  | 'displayName'
  | 'targetType'
  | 'targetValue'
  | 'authorizationConfirmed'
  | 'brief'

export interface CreateProjectInput {
  /** Workspace slug; sent to the backend as `name` and immutable after create. */
  name: string
  /** Optional human-readable label; omitted when blank (server falls back to slug). */
  displayName?: string
  targetType: EngagementTargetType
  targetValue: string
  authorizationConfirmed: true
  /** Operator brief — the prompt Soundwave drafts scope/RoE from. Required. */
  brief: string
}

export interface RealNewProjectFormError {
  message: string
  /** Absent → form-level error; present → rendered under that field. */
  field?: CreateProjectField
}

export interface RealNewProjectModalProps {
  onClose: () => void
  /** Resolves after server acknowledgement; the parent navigates and closes. */
  onCreate: (input: CreateProjectInput) => Promise<void>
  pending: boolean
  error?: RealNewProjectFormError | null
}

/** Public counts are `null` when no projection source exists — never shown as 0. */
export function formatPublicCount(value: number | null): string {
  return value === null ? '—' : String(value)
}

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function countByLifecycle(projects: ProjectViewModel[], status: EngagementStatus): number {
  return projects.filter(project => project.lifecycleStatus === status).length
}

export function filterRealProjects(
  projects: ProjectViewModel[],
  search: string,
  filter: RealProjectFilter,
): ProjectViewModel[] {
  const needle = search.trim().toLowerCase()
  return projects.filter(project => {
    const matchesSearch =
      needle === '' ||
      project.displayName.toLowerCase().includes(needle) ||
      project.workspaceSlug.toLowerCase().includes(needle) ||
      project.targetValue.toLowerCase().includes(needle)
    return matchesSearch && (filter === 'all' || project.lifecycleStatus === filter)
  })
}

/** Light slate/red palette copied from the source screens/Home.tsx look. */
export const REAL_HOME_COLORS = {
  page: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  ink: '#0F172A',
  muted: '#94A3B8',
  body: '#475569',
  red: '#DC2626',
  redAlert: '#EF4444',
  green: '#22C55E',
  amber: '#F59E0B',
} as const

export const REAL_LIFECYCLE_META: Record<
  EngagementStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  draft: { label: 'Draft', bg: 'rgba(100,116,139,0.12)', text: '#64748B', dot: '#64748B' },
  planning: { label: 'Planning', bg: 'rgba(100,116,139,0.12)', text: '#64748B', dot: '#64748B' },
  running: { label: 'Running', bg: 'rgba(34,197,94,0.12)', text: '#22C55E', dot: '#22C55E' },
  completed: { label: 'Completed', bg: 'rgba(59,130,246,0.12)', text: '#3B82F6', dot: '#3B82F6' },
  failed: { label: 'Failed', bg: 'rgba(239,68,68,0.12)', text: '#EF4444', dot: '#EF4444' },
}

/** Same policy as server/src/security/project-policy.ts (browser-safe copy). */
export const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

export interface CreateProjectDraft {
  name: string
  displayName: string
  targetType: EngagementTargetType
  targetValue: string
  authorizationConfirmed: boolean
  brief: string
}

/** Brief bounds mirror the server policy (security/project-policy.ts). */
export const BRIEF_MIN_LENGTH = 20
export const BRIEF_MAX_LENGTH = 20_000

export function validateCreateProjectDraft(
  draft: CreateProjectDraft,
): Partial<Record<CreateProjectField, string>> {
  const errors: Partial<Record<CreateProjectField, string>> = {}
  if (!PROJECT_SLUG_PATTERN.test(draft.name)) {
    errors.name = 'Invalid project name — must be 3-64 chars, lowercase letters / digits / internal hyphens'
  }
  if (draft.displayName.length > 200) {
    errors.displayName = 'Invalid displayName — must be at most 200 characters'
  }
  const targetError = targetValueError(draft.targetType, draft.targetValue)
  if (targetError !== undefined) errors.targetValue = targetError
  if (!draft.authorizationConfirmed) {
    errors.authorizationConfirmed = 'Explicit authorization confirmation is required'
  }
  const brief = draft.brief.trim()
  if (brief.length < BRIEF_MIN_LENGTH) {
    errors.brief = 'Brief is required — paste the engagement brief or upload a markdown file (min 20 characters)'
  } else if (brief.length > BRIEF_MAX_LENGTH) {
    errors.brief = `Brief is too long — at most ${BRIEF_MAX_LENGTH} characters`
  }
  return errors
}

function targetValueError(targetType: EngagementTargetType, value: string): string | undefined {
  if (targetType === 'web_url') {
    if (value.trim() === '' || /\s/.test(value)) {
      return 'Invalid web_url target — must be an absolute HTTP(S) URL without whitespace'
    }
    try {
      const url = new URL(value)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
        return 'Invalid web_url target — must be an absolute HTTP(S) URL'
      }
      if (url.username !== '' || url.password !== '') {
        return 'Invalid web_url target — embedded credentials are not allowed'
      }
      return undefined
    } catch {
      return 'Invalid web_url target — must be an absolute HTTP(S) URL'
    }
  }
  // Exact ip_range validation is server-authoritative; the form only rejects
  // values the server can never accept (empty or whitespace).
  if (value.trim() === '' || /\s/.test(value)) {
    return 'Invalid ip_range target — must be a bare IPv4/IPv6 address or CIDR'
  }
  return undefined
}
