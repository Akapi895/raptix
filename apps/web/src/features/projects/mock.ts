/**
 * Demo implementation of the project list port (migration Mốc 2). Maps the demo authority's accessible projects; the
 * demo has no per-project target or metadata verification, so those fields stay null and the portfolio shows them as
 * unavailable.
 */
import type { Project } from '../../domain/entities'
import type { ListResult } from '../../domain/service'
import type { ProjectRow, ProjectsService } from './service'

export function projectRow(p: Project): ProjectRow {
  return { id: p.id, name: p.name, workspaceSlug: null, target: null, targetType: null, metadataVerified: null, client: p.client, status: p.status, updatedAt: p.updated }
}

/** `readAccessible` is the demo project handler's accessible-list read for the actor. */
export function createProjectsService(readAccessible: () => Promise<ListResult<Project>>): ProjectsService {
  return {
    async list() {
      const res = await readAccessible()
      if (!res.ok) return res
      return { ok: true, data: res.data.items.map(projectRow) }
    },
  }
}
