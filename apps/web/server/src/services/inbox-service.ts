import type { PrismaClient } from '../generated/prisma/client.js';
import type { GovernanceService } from './governance-service.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess, type ActorContext } from '../auth/membership-policy.js';

/**
 * Ticket 15: command-center aggregates, the cross-engagement task inbox and
 * durable per-actor notices.
 *
 * Readiness CONSUMES the governance preflight (the authoritative checklist) —
 * summary endpoints never re-implement business decisions. Completion counts
 * and activity are raw observed counts only. Missing sources render as
 * explicit unavailable states, never fake zeros. Tasks aggregate only
 * engagements the actor owns or holds a membership on; notices are scoped to
 * the trusted actor and persist read/dismiss state.
 */

export interface OverviewView {
  readonly engagementId: string;
  readonly readiness: { readonly state: 'available' | 'unavailable'; readonly ok: boolean | null; readonly failed: readonly { readonly id: string; readonly detail: string | null }[]; readonly reason: string | null };
  readonly completion: { readonly findingsConfirmed: number | null; readonly reportsDelivered: number | null; readonly activeStops: number };
  readonly activity: readonly { readonly action: string; readonly actorId: string; readonly createdAt: string }[];
  readonly source: 'db';
}

export interface TaskItemView {
  readonly kind: 'scope-revision' | 'business-plan' | 'c2-grant' | 'report-review' | 'finding-review' | 'active-stop';
  readonly engagementId: string;
  readonly engagementName: string | null;
  readonly refId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly href: string;
  readonly awaitingActor: boolean;
}

export interface TaskEngagementView {
  readonly engagementId: string;
  readonly name: string | null;
  readonly readiness: { readonly state: 'available' | 'unavailable'; readonly ok: boolean | null; readonly failedChecks: number; readonly reason: string | null };
}

export interface TasksView {
  readonly tasks: readonly TaskItemView[];
  readonly engagements: readonly TaskEngagementView[];
  readonly counts: Readonly<Record<string, number>>;
  readonly source: 'db';
}

export interface NoticeView {
  readonly id: string;
  readonly engagementId: string | null;
  readonly kind: string;
  readonly title: string;
  readonly detail: Record<string, unknown> | null;
  readonly readAt: string | null;
  readonly dismissedAt: string | null;
  readonly createdAt: string;
}

export interface NoticesView {
  readonly notices: readonly NoticeView[];
  readonly unread: number;
  readonly source: 'db';
}

/**
 * Cross-engagement System Overview reads. Deliberately separate per domain
 * (findings, C2) instead of one aggregate document: each section loads,
 * degrades and is authorized on its own, and a missing source never blanks
 * the rest of the dashboard.
 */
export interface FindingsSummaryView {
  readonly total: number;
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly engagementsWithFindings: number;
  readonly engagements: number;
  /** True when the scan hit the row cap; counts are a lower bound. */
  readonly truncated: boolean;
  readonly source: 'db';
}

export interface C2SummaryCommandView {
  readonly id: string;
  readonly engagementId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface C2SummaryView {
  readonly commandsByStatus: Readonly<Record<string, number>>;
  readonly recentCommands: readonly C2SummaryCommandView[];
  readonly pendingGrants: number;
  readonly source: 'db';
}

const MAX_TASKS_PER_KIND = 25;
const MAX_ACTIVITY = 10;
const MAX_NOTICES = 50;
const MAX_FINDINGS_SCAN = 5000;
const MAX_RECENT_C2_COMMANDS = 20;
const C2_COMMAND_STATUSES = ['creating', 'succeeded', 'failed', 'uncertain'] as const;

export function toNoticeView(row: { id: string; engagementId: string | null; kind: string; title: string; detail: unknown; readAt: Date | null; dismissedAt: Date | null; createdAt: Date }): NoticeView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    kind: row.kind,
    title: row.title,
    detail: row.detail === null || row.detail === undefined ? null : (row.detail as Record<string, unknown>),
    readAt: row.readAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class InboxService {
  public constructor(private readonly db: PrismaClient, private readonly governance: GovernanceService | null) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async overview(actorId: string, engagementId: string): Promise<OverviewView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    let readiness: OverviewView['readiness'] = { state: 'unavailable', ok: null, failed: [], reason: 'The governance preflight service is not available in this deployment.' };
    if (this.governance !== null) {
      try {
        const pre = await this.governance.preflight(actorId, engagementId, null);
        readiness = { state: 'available', ok: pre.ok, failed: pre.checks.filter((c) => c.state !== 'pass').map((c) => ({ id: c.id, detail: c.detail })), reason: null };
      } catch (error) {
        if (!(error instanceof ProjectApiError)) throw error;
        readiness = { state: 'unavailable', ok: null, failed: [], reason: error.message };
      }
    }
    const [findingsConfirmed, reportsDelivered, activeStops, activityRows] = await Promise.all([
      this.db.findingRecord.count({ where: { engagementId, status: 'confirmed' } }).catch(() => null),
      this.db.reportRecord.count({ where: { engagementId, status: 'delivered' } }).catch(() => null),
      this.db.emergencyStop.count({ where: { engagementId, outcome: { in: ['requested', 'acknowledged'] } } }).catch(() => 0),
      this.db.webAuditEntry.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' }, take: MAX_ACTIVITY }).catch(() => []),
    ]);
    return {
      engagementId,
      readiness,
      completion: { findingsConfirmed, reportsDelivered, activeStops },
      activity: activityRows.map((row) => ({ action: String(row.action), actorId: String(row.actorId), createdAt: (row.createdAt as Date).toISOString() })),
      source: 'db',
    };
  }

  public async tasks(actorId: string): Promise<TasksView> {
    const engagements = await this.authorizedEngagements(actorId);
    const ids = engagements.map((e) => e.id);
    const nameOf = new Map(engagements.map((e) => [e.id, typeof e.name === 'string' ? e.name : null]));
    const tasks: TaskItemView[] = [];
    const href = (engagementId: string, tab: string): string => `#/project/${engagementId}?tab=${tab}`;
    if (ids.length > 0) {
      const [scopeRevisions, plans, grants, reports, findings, stops] = await Promise.all([
        this.db.scopeRevision.findMany({ where: { engagementId: { in: ids }, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
        this.db.businessPlan.findMany({ where: { engagementId: { in: ids }, status: 'proposed' }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
        this.db.c2Grant.findMany({ where: { engagementId: { in: ids }, status: 'requested' }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
        this.db.reportRecord.findMany({ where: { engagementId: { in: ids }, status: 'in_review' }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
        this.db.findingRecord.findMany({ where: { engagementId: { in: ids }, status: 'review' }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
        this.db.emergencyStop.findMany({ where: { engagementId: { in: ids }, outcome: { in: ['requested', 'acknowledged'] } }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
      ]);
      const push = (kind: TaskItemView['kind'], tab: string, rows: readonly Record<string, unknown>[], titleOf: (row: Record<string, unknown>) => string): void => {
        for (const row of rows) {
          const engagementId = String(row.engagementId);
          tasks.push({
            kind,
            engagementId,
            engagementName: nameOf.get(engagementId) ?? null,
            refId: String(row.id),
            title: titleOf(row),
            createdAt: (row.createdAt as Date).toISOString(),
            href: href(engagementId, tab),
            awaitingActor: String(row.requestedBy ?? row.actorId ?? row.createdBy ?? '') === actorId,
          });
        }
      };
      push('scope-revision', 'scope', scopeRevisions, (r) => `Scope revision v${String(r.version)} awaits review`);
      push('business-plan', 'governance', plans, (r) => {
        const body = r.body as { objective?: unknown } | null;
        const title = typeof body?.objective === 'string' && body.objective.length > 0 ? body.objective : 'untitled';
        return `Plan "${title}" v${String(r.version)} awaits decision`;
      });
      push('c2-grant', 'c2', grants, (r) => `C2 session grant for ${String(r.sessionId)} awaits review`);
      push('report-review', 'reports', reports, (r) => `Report "${String(r.title)}" awaits review`);
      push('finding-review', 'findings', findings, (r) => `Finding "${String(r.title)}" awaits confirmation`);
      push('active-stop', 'governance', stops, (r) => `Emergency stop (${String(r.scope)}) is active`);
    }
    const counts: Record<string, number> = {};
    for (const task of tasks) counts[task.kind] = (counts[task.kind] ?? 0) + 1;
    tasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    // Readiness consumes the authoritative preflight per engagement; a
    // refusal (e.g. viewer role) degrades to an explicit unavailable state.
    const engagementViews: TaskEngagementView[] = [];
    for (const engagement of engagements) {
      const name = typeof engagement.name === 'string' ? engagement.name : null;
      if (this.governance === null) {
        engagementViews.push({ engagementId: engagement.id, name, readiness: { state: 'unavailable', ok: null, failedChecks: 0, reason: 'The governance preflight service is not available in this deployment.' } });
        continue;
      }
      try {
        const pre = await this.governance.preflight(actorId, engagement.id, null);
        engagementViews.push({ engagementId: engagement.id, name, readiness: { state: 'available', ok: pre.ok, failedChecks: pre.checks.filter((c) => c.state !== 'pass').length, reason: null } });
      } catch (error) {
        if (!(error instanceof ProjectApiError)) throw error;
        engagementViews.push({ engagementId: engagement.id, name, readiness: { state: 'unavailable', ok: null, failedChecks: 0, reason: error.message } });
      }
    }
    return { tasks, engagements: engagementViews, counts, source: 'db' };
  }

  public async notices(actorId: string): Promise<NoticesView> {
    const rows = await this.db.webNotice.findMany({ where: { actorId, dismissedAt: null }, orderBy: { createdAt: 'desc' }, take: MAX_NOTICES });
    return { notices: rows.map(toNoticeView), unread: rows.filter((r) => r.readAt === null).length, source: 'db' };
  }

  /**
   * Observed finding counts over the engagements the actor owns or holds a
   * membership on. Raw counts only — no eligibility re-decisions. The scan is
   * capped and reports `truncated` instead of silently rounding.
   */
  public async findingsSummary(actorId: string): Promise<FindingsSummaryView> {
    const engagements = await this.authorizedEngagements(actorId);
    const ids = engagements.map((e) => e.id);
    const rows = ids.length === 0
      ? []
      : await this.db.findingRecord.findMany({ where: { engagementId: { in: ids } }, take: MAX_FINDINGS_SCAN }).catch(() => []);
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const perEngagement = new Set<string>();
    for (const row of rows) {
      const severity = String(row.severity);
      const status = String(row.status);
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      perEngagement.add(String(row.engagementId));
    }
    return {
      total: rows.length,
      bySeverity,
      byStatus,
      engagementsWithFindings: perEngagement.size,
      engagements: engagements.length,
      truncated: rows.length >= MAX_FINDINGS_SCAN,
      source: 'db',
    };
  }

  /**
   * Durable C2 activity from the command audit (live Sliver sessions stay a
   * per-engagement provider read — this section never pretends to observe
   * them). Counts include every durable command row; `recentCommands` is the
   * bounded newest slice.
   */
  public async c2Summary(actorId: string): Promise<C2SummaryView> {
    const engagements = await this.authorizedEngagements(actorId);
    const ids = engagements.map((e) => e.id);
    const [recent, grants, ...counts] = await Promise.all([
      ids.length === 0 ? Promise.resolve([]) : this.db.c2Command.findMany({ where: { engagementId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: MAX_RECENT_C2_COMMANDS }).catch(() => []),
      ids.length === 0 ? Promise.resolve([]) : this.db.c2Grant.findMany({ where: { engagementId: { in: ids }, status: 'requested' }, orderBy: { createdAt: 'desc' }, take: MAX_TASKS_PER_KIND }).catch(() => []),
      ...C2_COMMAND_STATUSES.map((status) => (ids.length === 0 ? Promise.resolve(0) : this.db.c2Command.count({ where: { engagementId: { in: ids }, status } }).catch(() => 0))),
    ]);
    const commandsByStatus: Record<string, number> = {};
    C2_COMMAND_STATUSES.forEach((status, index) => { commandsByStatus[status] = Number(counts[index]); });
    return {
      commandsByStatus,
      recentCommands: recent.map((row) => ({
        id: String(row.id),
        engagementId: String(row.engagementId),
        sessionId: String(row.sessionId),
        status: String(row.status),
        createdAt: (row.createdAt as Date).toISOString(),
      })),
      pendingGrants: grants.length,
      source: 'db',
    };
  }

  public async markNoticeRead(actorId: string, noticeId: string): Promise<NoticeView> {
    const row = await this.ownedNotice(actorId, noticeId);
    const updated = await this.db.webNotice.update({ where: { id: row.id }, data: { readAt: new Date() } });
    return toNoticeView(updated as never);
  }

  public async markNoticeDismissed(actorId: string, noticeId: string): Promise<NoticeView> {
    const row = await this.ownedNotice(actorId, noticeId);
    const updated = await this.db.webNotice.update({ where: { id: row.id }, data: { dismissedAt: new Date(), ...(row.readAt === null ? { readAt: new Date() } : {}) } });
    return toNoticeView(updated as never);
  }

  public async markAllNoticesRead(actorId: string): Promise<{ updated: number }> {
    const updated = await this.db.webNotice.updateMany({ where: { actorId, readAt: null, dismissedAt: null }, data: { readAt: new Date() } });
    return { updated: updated.count };
  }

  private async ownedNotice(actorId: string, noticeId: string): Promise<{ id: string; readAt: Date | null }> {
    const row = await this.db.webNotice.findFirst({ where: { id: noticeId, actorId } });
    if (row === null) throw new ProjectApiError(404, 'Notice not found');
    return row as unknown as { id: string; readAt: Date | null };
  }

  /** Only engagements the actor owns or holds a membership on (404-safe). */
  private async authorizedEngagements(actorId: string): Promise<Array<{ id: string; name: unknown }>> {
    const owned = await this.db.engagement.findMany({ where: { userId: actorId }, select: { id: true, name: true } }).catch(() => []);
    const memberships = await this.db.webMembership.findMany({ where: { userId: actorId }, select: { engagementId: true } }).catch(() => []);
    const memberIds = memberships.map((m) => String(m.engagementId)).filter((id) => !owned.some((e) => e.id === id));
    const memberRows = memberIds.length > 0
      ? await this.db.engagement.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } }).catch(() => [])
      : [];
    return [...owned, ...memberRows];
  }
}

/** Durable notice for a lifecycle decision; best-effort, never blocks the decision. */
export async function createNotice(db: PrismaClient, input: { engagementId: string; actorId: string; kind: string; title: string; detail?: Record<string, unknown> }): Promise<void> {
  try {
    await db.webNotice.create({ data: { engagementId: input.engagementId, actorId: input.actorId, kind: input.kind, title: input.title, ...(input.detail === undefined ? {} : { detail: input.detail as object }) } });
  } catch { /* a notice must never break the authoritative transition */ }
}
