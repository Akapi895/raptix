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
  /** The project status in its source's vocabulary. */
  status: string
  /** Display instant, already formatted by the adapter for its source. */
  updatedAt: string
  /** The same instant as an ISO string for filtering; null where the source records no instant (demo data). */
  updatedAtIso: string | null
}

export interface ProjectsService {
  /** Projects the actor can access, in the order the source lists them. */
  list(): Promise<ServiceResult<ProjectRow[]>>
}
