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
  /** Curated findings (every status except AI suggestion); AI suggestions are proposals and are never counted here. */
  total: number
  engagements: number
  engagementsWithFindings: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  /** Curated findings not yet resolved, by severity; the basis of the risk level. */
  unresolvedBySeverity: Record<string, number>
  /** Creation time of the newest curated finding; null when the source does not record it (demo data). */
  latestCreatedAt: string | null
  truncated: boolean
}

export interface OverviewCommand {
  id: string
  engagementId: string
  sessionId: string
  status: string
  createdAt: string
}

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'severe'

/** Severity weights of the weighted risk score; informational findings carry no weight. */
const RISK_WEIGHT: Record<string, number> = { critical: 10, high: 5, medium: 2, low: 0.5 }

/**
 * The risk level of the unresolved curated findings, from the same weighted score and thresholds the reference uses:
 * no weighted finding is safe, up to 3 is low, up to 10 medium, up to 30 high, and above that severe. The score is computed
 * from recorded counts only; it is not a stored value.
 */
export function riskAssessment(unresolved: Record<string, number>): { level: RiskLevel; score: number } {
  const score = Object.entries(RISK_WEIGHT).reduce((sum, [severity, weight]) => sum + (unresolved[severity] ?? 0) * weight, 0)
  if (score === 0) return { level: 'safe', score }
  if (score <= 3) return { level: 'low', score }
  if (score <= 10) return { level: 'medium', score }
  if (score <= 30) return { level: 'high', score }
  return { level: 'severe', score }
}

export interface OverviewC2 {
  pendingGrants: number
  /** Null when the source does not record a command audit (the demo data has no command log). */
  commandsByStatus: Record<string, number> | null
  recentCommands: OverviewCommand[]
}

/** Curated findings still open: confirmed, in remediation or awaiting retest. Drafts, reviews and AI suggestions are counted apart. */
const OPEN_CURATED_STATUSES = ['confirmed', 'remediation', 'retest']

export function openCuratedCount(view: OverviewFindings): number {
  return OPEN_CURATED_STATUSES.reduce((sum, status) => sum + (view.byStatus[status] ?? 0), 0)
}

export interface OverviewOperation {
  id: string
  engagementId: string
  engagementName: string | null
  /** The runtime thread that identifies the operation in its project; null while the binding has none. */
  threadId: string | null
  /** The governance binding state: bound, running, stopped or completed. */
  status: string
  updatedAt: string
}

export interface OverviewOperations {
  /** Bindings per governance state across the accessible projects; null when the source does not record them (demo data). */
  counts: Record<string, number> | null
  recent: OverviewOperation[]
  engagements: number
  truncated: boolean
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

/** The task inbox for the visible projects. `limited` and `stopsLimited` say which count reached its row cap, so that count is a lower bound. */
export interface OverviewTaskList {
  items: OverviewTask[]
  limited: boolean
  stopsLimited: boolean
}

/** Actor-bound overview reads; the overview is global, so no project is named. */
export interface OverviewService {
  projects(): Promise<ServiceResult<OverviewProject[]>>
  findings(): Promise<ServiceResult<OverviewFindings>>
  c2(): Promise<ServiceResult<OverviewC2>>
  operations(): Promise<ServiceResult<OverviewOperations>>
  tasks(): Promise<ServiceResult<OverviewTaskList>>
}
