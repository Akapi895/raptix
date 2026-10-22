/**
 * The global overview's read port (ADR-0096, migration Mốc 2). One read per section, so each section fails, loads
 * and degrades on its own. Every section answers with what its source records; a source the mode does not
 * record returns `unavailable` (or a null field) and is shown as such, never as zero or demo data.
 */
import type { ServiceResult } from '../../domain/service'

export type OverviewTaskKind = 'scope-revision' | 'business-plan' | 'c2-grant' | 'report-review' | 'finding-review' | 'active-stop'

export interface OverviewProject {
  id: string
  name: string
  /** A detail line the source records for the project: the target in real mode, the client in demo data. */
  detail: string
  /** The project status in its source's vocabulary; the status map renders both vocabularies. */
  status: string
  updatedAt: string
}

export interface OverviewFindings {
  /** Verified findings only; AI suggestions are proposals and never counted here. */
  total: number
  engagements: number
  engagementsWithFindings: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  truncated: boolean
}

export interface OverviewCommand {
  id: string
  engagementId: string
  sessionId: string
  status: string
  createdAt: string
}

export interface OverviewC2 {
  pendingGrants: number
  /** Null when the source does not record a command audit (the demo data has no command log). */
  commandsByStatus: Record<string, number> | null
  recentCommands: OverviewCommand[]
}

export interface OverviewTask {
  kind: OverviewTaskKind
  refId: string
  engagementId: string
  engagementName: string | null
  title: string
  createdAt: string
  /** Route of the owning screen, as a hash path (`project/<id>?tab=…`). */
  href: string
  awaitingActor: boolean
}

/** Actor-bound overview reads; the overview is global, so no project is named. */
export interface OverviewService {
  projects(): Promise<ServiceResult<OverviewProject[]>>
  findings(): Promise<ServiceResult<OverviewFindings>>
  c2(): Promise<ServiceResult<OverviewC2>>
  tasks(): Promise<ServiceResult<OverviewTask[]>>
}
