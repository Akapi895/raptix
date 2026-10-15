import type { PrismaClient } from '../generated/prisma/client.js';
import type { ThreadHistoryEvent } from '@raptix/web-contracts';
import type { RuntimeContextService } from './runtime/runtime-context.js';
import type { RunService } from './runtime/run-service.js';
import { requireEngagementAccess, type ActorContext } from '../auth/membership-policy.js';

/**
 * Ticket 13: engagement-scoped agent fleet projection. Three distinct
 * identities are never conflated: the assistant graph catalog (runtime
 * catalog IDs — NOT endpoint health), bound execution threads (runtime
 * thread status) and subagent invocations ("branches", projected from
 * checkpoint transcripts with checkpoint provenance). Missing heartbeat or
 * inventory data is reported as unknown, never fabricated.
 *
 * Action surface: the runtime exposes run-level cancel only (ticket 05).
 * Branch-level retry/reassign/cancel and agent allocation/grouping have no
 * runtime action contract and are recorded as excluded (D1/D2) — the fleet
 * view surfaces them as unavailable instead of pretending.
 */

export interface FleetAgentView {
  readonly graphId: string;
  readonly source: 'catalog';
}

export interface FleetThreadView {
  readonly threadId: string;
  readonly assistantId: string | null;
  readonly kind: string | null;
  readonly rawStatus: string | null;
  readonly updatedAt: string | null;
  readonly activeRunId: string | null;
}

export interface FleetBranchView {
  readonly threadId: string;
  /** Session-scoped grouping key (subagent session id, else agent fallback). */
  readonly key: string;
  readonly agent: string;
  readonly state: 'running' | 'ended' | 'unknown';
  readonly outcome: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly provenance: 'checkpoint';
}

export interface FleetView {
  readonly engagementId: string;
  readonly agents: readonly FleetAgentView[];
  readonly threads: readonly FleetThreadView[];
  readonly branches: readonly FleetBranchView[];
  readonly counts: {
    readonly threads: number;
    readonly threadsTruncated: boolean;
    readonly activeRuns: number;
    readonly branches: number;
    readonly runningBranches: number;
  };
  readonly excludedActions: readonly string[];
  readonly sources: { agents: 'runtime-catalog'; threads: 'runtime'; branches: 'checkpoint' };
  readonly source: 'runtime';
}

interface BranchAcc {
  agent: string;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
}

/** Pairs observed subagent_start/subagent_end checkpoint events per session. */
export function projectFleetBranches(threadId: string, transcripts: readonly ThreadHistoryEvent[]): FleetBranchView[] {
  const groups = new Map<string, BranchAcc>();
  for (const event of transcripts) {
    const payload = event.payload as { type?: unknown; agent?: unknown; sessionId?: unknown; createdAt?: unknown; status?: unknown; cancelled?: unknown; error?: unknown };
    if (payload.type !== 'subagent_start' && payload.type !== 'subagent_end') continue;
    if (typeof payload.agent !== 'string' || payload.agent.length === 0) continue;
    const key = typeof payload.sessionId === 'string' && payload.sessionId.length > 0 ? payload.sessionId : `agent:${payload.agent}`;
    const at = typeof payload.createdAt === 'string' ? payload.createdAt : null;
    const acc = groups.get(key) ?? { agent: payload.agent, startedAt: null, endedAt: null, outcome: null };
    if (payload.type === 'subagent_start') {
      acc.startedAt = at ?? acc.startedAt;
      acc.endedAt = null;
      acc.outcome = null;
    } else {
      acc.endedAt = at;
      acc.outcome = payload.error === true ? 'failed' : payload.cancelled === true ? 'cancelled' : (typeof payload.status === 'string' && payload.status.length > 0 ? payload.status : 'completed');
    }
    groups.set(key, acc);
  }
  return [...groups.entries()].map(([key, acc]) => ({
    threadId,
    key,
    agent: acc.agent,
    state: acc.endedAt !== null ? 'ended' : acc.startedAt !== null ? 'running' : 'unknown',
    outcome: acc.outcome,
    startedAt: acc.startedAt,
    endedAt: acc.endedAt,
    provenance: 'checkpoint',
  }));
}

const MAX_THREADS = 20;
const MAX_ACTIVE_RUN_LOOKUPS = 10;
const ACTIVE_RUN_STATUSES = ['pending', 'running'];

export class FleetService {
  public constructor(private readonly db: PrismaClient, private readonly context: RuntimeContextService, private readonly runs: RunService) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  public async fleet(actorId: string, engagementId: string): Promise<FleetView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const [catalog, threads] = await Promise.all([
      this.context.agents(),
      this.runs.listThreads(actorId, engagementId),
    ]);
    const bounded = threads.threads.slice(0, MAX_THREADS);
    const threadViews: FleetThreadView[] = [];
    const branches: FleetBranchView[] = [];
    let activeLookups = 0;
    let activeRuns = 0;
    for (const binding of bounded) {
      let rawStatus: string | null = null;
      let threadBranches: FleetBranchView[] = [];
      let activeRunId: string | null = null;
      // A thread whose runtime read fails still appears with honest unknown
      // state; the whole read fails only when the runtime itself is down.
      try {
        const snap = await this.runs.snapshot(actorId, engagementId, binding.threadId);
        rawStatus = snap.rawStatus;
        threadBranches = projectFleetBranches(binding.threadId, snap.transcripts ?? []);
      } catch { /* keep unknown */ }
      if (rawStatus === 'busy' && activeLookups < MAX_ACTIVE_RUN_LOOKUPS) {
        activeLookups += 1;
        try {
          const runs = await this.runs.listRuns(actorId, engagementId, binding.threadId, { offset: '0', limit: '5' });
          activeRunId = runs.runs.find((r) => ACTIVE_RUN_STATUSES.includes(r.rawStatus))?.runId ?? null;
        } catch { /* keep null */ }
      }
      if (activeRunId !== null) activeRuns += 1;
      threadViews.push({
        threadId: binding.threadId,
        assistantId: binding.assistantId,
        kind: binding.kind,
        rawStatus,
        updatedAt: binding.updatedAt,
        activeRunId,
      });
      branches.push(...threadBranches);
    }
    return {
      engagementId,
      agents: catalog.graphs.map((graphId) => ({ graphId, source: 'catalog' })),
      threads: threadViews,
      branches,
      counts: {
        threads: threads.threads.length,
        threadsTruncated: threads.threads.length > MAX_THREADS,
        activeRuns,
        branches: branches.length,
        runningBranches: branches.filter((b) => b.state === 'running').length,
      },
      excludedActions: ['branch-retry', 'branch-reassign', 'branch-cancel', 'agent-allocation', 'agent-grouping'],
      sources: { agents: 'runtime-catalog', threads: 'runtime', branches: 'checkpoint' },
      source: 'runtime',
    };
  }
}
