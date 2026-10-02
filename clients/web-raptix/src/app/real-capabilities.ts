/**
 * Real-mode capability map (W03): truthful reasons for the workspace pages
 * that have no connected backend source yet, plus create-error mapping for
 * the peer New Project form. Pure data — no React, no fixtures, no W04 APIs.
 */
import type { Screen } from '../types'
import { ApiClientError, ApiStatusError } from '../shared/api/errors'
import type { RealNewProjectFormError } from '../features/projects/real-project.types'

/**
 * One truthful reason per non-charter workspace page. The charter landing
 * (default route) is the only page with a connected real source: the public
 * project DTO. Owning work packages are named so the unavailable state is
 * auditable, not vague.
 */
export const REAL_UNAVAILABLE_REASONS: Partial<Record<Screen, string>> = {
  'operator-console':
    'The Operator Console binds to server threads, runs and HITL flows (work packages W07-W11). No runtime source is connected yet.',
  'vector-campaigns':
    'Vector campaigns need the campaign provider APIs (work package W17), which are not connected yet.',
  'c2-sessions':
    'C2 sessions need the session provider APIs (work package W17), which are not connected yet.',
  infrastructure:
    'Infrastructure data needs the scoped inventory projection (work package W13), which is not connected yet.',
  assets:
    'Assets & inventory need the public asset projection (work package W13), which is not connected yet.',
  credentials:
    'Credentials Vault needs the vault storage service (work package W18), which is not connected yet.',
  findings:
    'Findings & evidence need the findings/files APIs (work package W12), which are not connected yet.',
  logs:
    'The operations log needs the run-history APIs (work packages W09/W14), which are not connected yet.',
  reports:
    'Report preview/export need the outcome APIs (work package W14), which are not connected yet.',
  members:
    'Members need the identity/RBAC service (work package W19). No member directory exists in this build.',
  'project-settings':
    'Metadata editing arrives with the settings work package (W15). The project fields below are read-only.',
}

/** Defensive reason for a screen without a map entry (the router only mounts the 13 pages). */
export const REAL_FALLBACK_REASON =
  'This page has no connected backend source in this build. No demo data is shown.'

/**
 * Maps a failed createProject call to the peer form's error shape. Field
 * attribution is conservative: only the duplicate-slug conflict (409) is
 * provably about `name`; every other failure stays form-level.
 */
export function toCreateFormError(error: unknown): RealNewProjectFormError {
  if (error instanceof ApiStatusError) {
    if (error.isConflict) return { message: error.message, field: 'name' }
    if (error.isValidationError && ['name', 'displayName', 'targetType', 'targetValue', 'authorizationConfirmed'].includes(error.field ?? '')) return { message: error.message, field: error.field as RealNewProjectFormError['field'] }
    return { message: error.message }
  }
  if (error instanceof ApiClientError) return { message: error.message }
  return { message: 'Project creation failed. Try again.' }
}
