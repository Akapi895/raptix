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
 * auditable, not vague. Operator Console (W10) renders real threads/runs and
 * is mounted directly; Findings & Evidence (W12) render parsed workspace
 * findings and the artifact browser; Infrastructure & Assets (W13) render the
 * scoped public graph projection and derived asset inventory; Operations Log
 * and Reports (W14) render the merged server timeline and the validated
 * engagement exports; Settings (W15) edits the persisted engagement fields
 * through the validated PATCH with save/reload acknowledgement and owns the
 * explicit danger delete; Vector Campaigns and C2 (W17) render the persisted
 * drafts with truthful provider jobs and the scoped session-unavailable state;
 * Credentials Vault (W18) renders redacted server metadata with the explicit
 * audited reveal and revocation actions; Members (W19) renders the truthful
 * local single-user topology with the stated-absent invite/RBAC reason —
 * every workspace page now has a real, verified source.
 */
export const REAL_UNAVAILABLE_REASONS: Partial<Record<Screen, string>> = {}

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
