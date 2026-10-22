/**
 * The project list's read port (ADR-0096, migration Mốc 2). Each field is the value its source records, or null when
 * the source does not record it: the real engagement API has no client, and the demo data has no per-project target.
 * The shared portfolio shows null as unavailable, never as a demo value.
 */
import type { ServiceResult } from '../../domain/service'

export interface ProjectRow {
  id: string
  name: string
  /** The workspace slug the real API assigns; null where the source has none. */
  workspaceSlug: string | null
  target: string | null
  targetType: string | null
  /** Metadata policy result in real mode; null where the source does not verify metadata. */
  metadataVerified: boolean | null
  client: string | null
  /** The project status in its source's vocabulary. */
  status: string
  /** Display instant, already formatted by the adapter for its source. */
  updatedAt: string
}

export interface ProjectsService {
  /** Projects the actor can access, in the order the source lists them. */
  list(): Promise<ServiceResult<ProjectRow[]>>
}
