import { randomUUID } from 'node:crypto';
import type { RequestOperation, RequestRecoveryView, ThreadBindingView, ThreadKind } from '@raptix/web-contracts';
import type { Prisma, PrismaClient, Engagement, EngagementThread, WebRequestLedger } from '../generated/prisma/client.js';
import { assertProjectTarget, isProjectSlug, ProjectPolicyError } from '../security/project-policy.js';
import { requestFingerprint } from '../security/request-fingerprint.js';
import { isMemberRole, ROLE_RANK, type MemberRole } from '../auth/membership-policy.js';
import { ProjectNotFoundError } from './projects-service.js';

export interface BindingInput { threadId: string; assistantId: string; kind: ThreadKind; contextHash: string; runtimeConfigHash?: string }
export type Reservation = { reserved: true; token: string; request: RequestRecoveryView } | { reserved: false; request: RequestRecoveryView };
const conflict = (): ProjectPolicyError => new ProjectPolicyError('conflict', 'Runtime ownership or request intent conflicts with persisted state');
function identifier(value: string, request = false): void {
  if (typeof value !== 'string' || !(request ? /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/ : /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/).test(value)) throw new ProjectPolicyError('bad_request', 'Invalid runtime identifier');
}
function contextHash(project: Engagement, assistantId: string, kind: ThreadKind): string {
  // W01: partition identity, not the per-owner display name. Backfilled rows
  // carry workspaceSlug === name, so existing persisted thread hashes stay
  // byte-identical across the migration.
  return requestFingerprint({ engagementId: project.id, workspaceSlug: project.workspaceSlug, targetType: project.targetType, targetValue: project.targetValue, authorizationConfirmed: project.authorizationConfirmed, assistantId, kind });
}
function bindingView(row: EngagementThread): ThreadBindingView {
  return { engagementId: row.engagementId, threadId: row.threadId, assistantId: row.assistantId, kind: row.kind, title: row.title ?? null, hitlEnabled: row.hitlEnabled, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function recoveryView(row: WebRequestLedger): RequestRecoveryView {
  return { engagementId: row.engagementId, requestId: row.requestId, operation: row.operation, state: row.state, threadId: row.threadId, runId: row.runId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/**
 * Shared project access check for every runtime and environment write. Locks
 * the engagement row and answers 404 for foreign or unknown ids.
 */
export async function requireProjectAccess(tx: Prisma.TransactionClient, userId: string, engagementId: string, minRole: MemberRole = 'viewer'): Promise<Engagement> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Engagement" WHERE "id" = ${engagementId} AND ("userId" = ${userId} OR EXISTS (SELECT 1 FROM "WebMembership" WHERE "engagementId" = ${engagementId} AND "userId" = ${userId})) FOR UPDATE`;
  if (!rows.length) throw new ProjectNotFoundError();
  const project = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });
  if (!isProjectSlug(project.name)) throw new ProjectNotFoundError();
  // W02: an invited member is an authorized runtime actor on this engagement,
  // not just the owner. The membership role must still satisfy the action's
  // minimum role; foreign ids keep answering 404.
  if (project.userId !== userId) {
    const membership = await tx.webMembership.findFirst({ where: { engagementId, userId } });
    if (membership === null || !isMemberRole(membership.role) || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) throw new ProjectNotFoundError();
  }
  return project;
}

/** Admission for execution-starting operations, checked inside the reserving transaction. */
export interface ExecutionAdmission {
  assertAdmits(tx: Prisma.TransactionClient, engagementId: string): Promise<void>;
}

export class RuntimeOwnershipService {
  public constructor(private readonly db: PrismaClient, private readonly admission?: ExecutionAdmission) {}

  private async transaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.db.$transaction(action); }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict();
      throw error;
    }
  }

  private owned(tx: Prisma.TransactionClient, userId: string, engagementId: string, minRole: MemberRole = 'viewer'): Promise<Engagement> {
    return requireProjectAccess(tx, userId, engagementId, minRole);
  }

  private async binding(tx: Prisma.TransactionClient, project: Engagement, threadId: string): Promise<EngagementThread> {
    identifier(threadId);
    const row = await tx.engagementThread.findFirst({ where: { threadId, engagementId: project.id } });
    if (!row) throw new ProjectNotFoundError();
    if (row.contextHash !== contextHash(project, row.assistantId, row.kind)) throw conflict();
    return row;
  }

  public async prepareBinding(userId: string, engagementId: string, assistantId: string, kind: ThreadKind): Promise<string> {
    identifier(assistantId);
    if (!['planning', 'execution'].includes(kind)) throw new ProjectPolicyError('bad_request', 'Invalid thread kind');
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId);
      assertProjectTarget(project.targetType, project.targetValue);
      return contextHash(project, assistantId, kind);
    });
  }

  // Only a trusted runtime adapter may pass a returned thread ID plus its
  // pre-create context fingerprint. No browser binding/adoption endpoint exists.
  public async bindThread(userId: string, engagementId: string, input: BindingInput): Promise<ThreadBindingView> {
    identifier(input.threadId); identifier(input.assistantId);
    if (input.runtimeConfigHash !== undefined && !/^[a-f0-9]{64}$/.test(input.runtimeConfigHash)) throw new ProjectPolicyError('bad_request', 'Invalid trusted runtime context fingerprint');
    if (!['planning', 'execution'].includes(input.kind)) throw new ProjectPolicyError('bad_request', 'Invalid thread kind');
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      if (input.contextHash !== contextHash(project, input.assistantId, input.kind)) throw conflict();
      const existing = await tx.engagementThread.findUnique({ where: { threadId: input.threadId } });
      if (existing) {
        if (existing.engagementId !== engagementId || existing.contextHash !== input.contextHash || existing.kind !== input.kind || existing.assistantId !== input.assistantId || existing.runtimeConfigHash !== (input.runtimeConfigHash ?? null)) throw conflict();
        return bindingView(existing);
      }
      const row = await tx.engagementThread.create({ data: { engagementId, threadId: input.threadId, assistantId: input.assistantId, kind: input.kind, contextHash: input.contextHash, runtimeConfigHash: input.runtimeConfigHash ?? null } });
      await tx.engagement.update({ where: { id: engagementId }, data: { runtimeContextLockedAt: project.runtimeContextLockedAt ?? new Date() } });
      return bindingView(row);
    });
  }

  /** Refuses anything but an operator, before a caller can reach a runtime on the project's behalf. */
  public async requireOperator(userId: string, engagementId: string): Promise<void> {
    await this.transaction(async tx => { await this.owned(tx, userId, engagementId, 'operator'); });
  }

  /**
   * ADR-0092 I07: records the message count an operator verified for one migrated thread, read directly from the
   * legacy runtime before cutover. A rebind later reads this instead of trusting a client-supplied count. Operator-only.
   */
  public async importMigrationManifest(userId: string, engagementId: string, records: { threadId: string; verifiedMessageCount: number; sourceSlug: string }[]): Promise<number> {
    if (records.length === 0 || records.length > 500) throw new ProjectPolicyError('bad_request', 'A manifest holds 1 to 500 thread records');
    for (const record of records) {
      identifier(record.threadId);
      if (!Number.isSafeInteger(record.verifiedMessageCount) || record.verifiedMessageCount < 1 || record.verifiedMessageCount > 100000) throw new ProjectPolicyError('bad_request', 'Invalid verified message count');
      if (!isProjectSlug(record.sourceSlug)) throw new ProjectPolicyError('bad_request', 'Invalid source slug');
    }
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      if (records.some(record => record.sourceSlug !== project.workspaceSlug)) throw new ProjectPolicyError('bad_request', 'The manifest names a different project');
      for (const record of records) {
        await tx.threadMigrationRecord.upsert({
          where: { engagementId_threadId: { engagementId, threadId: record.threadId } },
          create: { engagementId, threadId: record.threadId, verifiedMessageCount: record.verifiedMessageCount, sourceSlug: record.sourceSlug, importedByUserId: userId },
          update: { verifiedMessageCount: record.verifiedMessageCount, sourceSlug: record.sourceSlug, importedByUserId: userId },
        });
      }
      // The count a rebind later trusts is decided here, so the import is audited in the same transaction: a manifest
      // that lands always has its audit entry, and one that fails leaves neither.
      await tx.webAuditEntry.create({
        data: { engagementId, actorId: userId, action: 'migration.manifest.imported', targetType: 'project', targetId: engagementId, reason: `threads=${records.length} source=${project.workspaceSlug}`, detail: { threadIds: records.map(record => record.threadId), verifiedMessageCounts: records.map(record => record.verifiedMessageCount) } },
      });
      return records.length;
    });
  }

  /** The verified message count imported for a thread, or null when no manifest named it. */
  public async verifiedMessageCount(userId: string, engagementId: string, threadId: string): Promise<number | null> {
    return this.transaction(async tx => {
      await this.owned(tx, userId, engagementId, 'operator');
      const row = await tx.threadMigrationRecord.findUnique({ where: { engagementId_threadId: { engagementId, threadId } } });
      return row?.verifiedMessageCount ?? null;
    });
  }

  /** The runtime configuration fingerprint a bound thread was last bound under, or null for a thread bound before it was recorded. */
  public async runtimeConfigHashOf(userId: string, engagementId: string, threadId: string): Promise<string | null> {
    return this.transaction(async tx => (await this.binding(tx, await this.owned(tx, userId, engagementId), threadId)).runtimeConfigHash ?? null);
  }

  /**
   * ADR-0092 I07: moves a bound thread to the runtime configuration of the environment that now serves it. The move is
   * a compare-and-set on the fingerprint it leaves, and the new fingerprints must match the project as it is now.
   */
  public async rebindThreadConfig(userId: string, engagementId: string, input: { threadId: string; expectedRuntimeConfigHash: string | null; contextHash: string; runtimeConfigHash: string }): Promise<ThreadBindingView> {
    identifier(input.threadId);
    if (!/^[a-f0-9]{64}$/.test(input.contextHash) || !/^[a-f0-9]{64}$/.test(input.runtimeConfigHash)) throw new ProjectPolicyError('bad_request', 'Invalid trusted runtime context fingerprint');
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      const row = await this.binding(tx, project, input.threadId);
      if ((row.runtimeConfigHash ?? null) !== input.expectedRuntimeConfigHash) throw conflict();
      if (input.contextHash !== contextHash(project, row.assistantId, row.kind)) throw conflict();
      const updated = await tx.engagementThread.update({ where: { threadId: row.threadId }, data: { contextHash: input.contextHash, runtimeConfigHash: input.runtimeConfigHash } });
      return bindingView(updated);
    });
  }

  public async getBinding(userId: string, engagementId: string, threadId: string, expected?: { assistantId: string; kind: ThreadKind; runtimeConfigHash?: string }): Promise<ThreadBindingView> {
    return this.transaction(async tx => {
      const row = await this.binding(tx, await this.owned(tx, userId, engagementId), threadId);
      if (expected && (expected.assistantId !== row.assistantId || expected.kind !== row.kind)) throw conflict();
      if (expected?.runtimeConfigHash !== undefined && row.runtimeConfigHash !== expected.runtimeConfigHash) throw conflict();
      return bindingView(row);
    });
  }

  /** Owner-set display name of a bound thread. Identity, binding and runtime context stay as they were. */
  public async renameBinding(userId: string, engagementId: string, threadId: string, title: string): Promise<ThreadBindingView> {
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      await this.binding(tx, project, threadId);
      await tx.engagementThread.updateMany({ where: { engagementId, threadId }, data: { title } });
      return bindingView(await this.binding(tx, project, threadId));
    });
  }

  /** Per-conversation HITL switch. Dangerous methods stay gated whatever the value is. */
  public async setThreadHitl(userId: string, engagementId: string, threadId: string, enabled: boolean): Promise<ThreadBindingView> {
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      await this.binding(tx, project, threadId);
      await tx.engagementThread.updateMany({ where: { engagementId, threadId }, data: { hitlEnabled: enabled } });
      await tx.webAuditEntry.create({ data: { engagementId, actorId: userId, action: 'thread.hitl.set', targetType: 'thread', targetId: threadId, detail: { enabled } } });
      return bindingView(await this.binding(tx, project, threadId));
    });
  }

  /** Owner-scoped bound-thread selector list (W10): newest activity first, bounded. */
  public async listBindings(userId: string, engagementId: string, limit = 50): Promise<ThreadBindingView[]> {
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId);
      const rows = await tx.engagementThread.findMany({ where: { engagementId }, orderBy: { updatedAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
      return rows.filter(row => row.contextHash === contextHash(project, row.assistantId, row.kind)).map(bindingView);
    });
  }

  public async reserve(userId: string, engagementId: string, requestId: string, operation: RequestOperation, payload: unknown, threadId: string | null = null): Promise<Reservation> {
    identifier(requestId, true);
    if (!['create_thread', 'create_run', 'resume'].includes(operation) || (operation === 'create_thread') !== (threadId === null)) throw new ProjectPolicyError('bad_request', 'Invalid request operation/thread binding');
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      const bound = threadId === null ? null : await this.binding(tx, project, threadId);
      const payloadHash = requestFingerprint({ operation, threadId, payload, contextHash: bound?.contextHash ?? contextHash(project, '', 'planning') });
      const existing = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.operation !== operation || existing.threadId !== threadId && operation !== 'create_thread') throw conflict();
        return { reserved: false, request: recoveryView(existing) };
      }
      if (bound && await tx.webRequestLedger.count({ where: { engagementId, activeThreadId: { not: null }, thread: { kind: bound.kind === 'planning' ? 'execution' : 'planning' } } })) throw conflict();
      // ADR-0092: a new execution start must hold the deployment slot. Replays above return the recorded answer.
      if (operation !== 'create_thread') await this.admission?.assertAdmits(tx, engagementId);
      // A resume never double-holds the active slot: the interrupted run keeps
      // the slot until the resume dispatch is acknowledged (accept transfers it).
      const row = await tx.webRequestLedger.create({ data: { engagementId, requestId, operation, payloadHash, threadId, activeThreadId: operation === 'resume' ? null : threadId, reservationToken: randomUUID() } });
      return { reserved: true, token: row.reservationToken, request: recoveryView(row) };
    });
  }

  public async replay(userId: string, engagementId: string, requestId: string, operation: RequestOperation, payload: unknown, threadId: string | null = null): Promise<RequestRecoveryView | null> {
    identifier(requestId, true);
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId);
      const bound = threadId === null ? null : await this.binding(tx, project, threadId);
      const row = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (!row) return null;
      const hash = requestFingerprint({ operation, threadId, payload, contextHash: bound?.contextHash ?? contextHash(project, '', 'planning') });
      if (row.operation !== operation || row.payloadHash !== hash) throw conflict();
      return recoveryView(row);
    });
  }

  public async recordDispatch(userId: string, engagementId: string, requestId: string, token: string, proof: { assistantId: string; kind: ThreadKind; runtimeConfigHash: string }, candidateThreadId: string | null = null): Promise<void> {
    await this.transaction(async tx => {
      await this.owned(tx, userId, engagementId, 'operator');
      const changed = await tx.webRequestLedger.updateMany({ where: { engagementId, requestId, reservationToken: token, state: 'creating', dispatchConfigHash: null }, data: { candidateThreadId, dispatchAssistantId: proof.assistantId, dispatchKind: proof.kind, dispatchConfigHash: proof.runtimeConfigHash } });
      if (!changed.count) throw conflict();
    });
  }

  public async inspect(userId: string, engagementId: string, requestId: string): Promise<WebRequestLedger> {
    identifier(requestId, true);
    return this.transaction(async tx => {
      await this.owned(tx, userId, engagementId);
      const row = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (!row) throw new ProjectNotFoundError();
      return row;
    });
  }

  public async runOwner(userId: string, engagementId: string, threadId: string, runId: string): Promise<WebRequestLedger> {
    identifier(runId);
    return this.transaction(async tx => {
      await this.binding(tx, await this.owned(tx, userId, engagementId), threadId);
      const row = await tx.webRequestLedger.findFirst({ where: { engagementId, threadId, runId, state: 'accepted' } });
      if (!row) throw new ProjectNotFoundError();
      return row;
    });
  }

  public async runs(userId: string, engagementId: string, threadId: string, offset: number, limit: number): Promise<WebRequestLedger[]> {
    return this.transaction(async tx => {
      await this.binding(tx, await this.owned(tx, userId, engagementId), threadId);
      return tx.webRequestLedger.findMany({ where: { engagementId, threadId, state: 'accepted', runId: { not: null } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit });
    });
  }

  public async active(userId: string, engagementId: string, threadId: string): Promise<WebRequestLedger | null> {
    return this.transaction(async tx => {
      await this.binding(tx, await this.owned(tx, userId, engagementId), threadId);
      return tx.webRequestLedger.findFirst({ where: { engagementId, activeThreadId: threadId } });
    });
  }

  public async staleDispatches(cutoff = new Date(Date.now() - 120_000)): Promise<{ userId: string; engagementId: string; requestId: string }[]> {
    const rows = await this.db.webRequestLedger.findMany({ where: { state: 'uncertain', dispatchConfigHash: { not: null }, updatedAt: { lt: cutoff } }, include: { engagement: { select: { userId: true } } }, orderBy: { updatedAt: 'asc' }, take: 10 });
    return rows.map(row => ({ userId: row.engagement.userId, engagementId: row.engagementId, requestId: row.requestId }));
  }

  public async recover(userId: string, engagementId: string, requestId: string): Promise<RequestRecoveryView> {
    identifier(requestId, true);
    return this.transaction(async tx => {
      await this.owned(tx, userId, engagementId);
      const row = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (!row) throw new ProjectNotFoundError();
      return recoveryView(row);
    });
  }

  public async accept(userId: string, engagementId: string, requestId: string, token: string, threadId: string, runId: string | null): Promise<RequestRecoveryView> {
    identifier(requestId, true); identifier(threadId); if (runId !== null) identifier(runId);
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId, 'operator');
      await this.binding(tx, project, threadId);
      const row = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (!row || row.reservationToken !== token || row.state === 'rejected') throw conflict();
      if (row.operation === 'create_thread' ? runId !== null : runId === null || row.threadId !== threadId) throw conflict();
      if (row.state === 'accepted') {
        if (row.threadId !== threadId || row.runId !== runId) throw conflict();
        return recoveryView(row);
      }
      if (row.operation === 'resume') {
        // Slot transfer: the interrupted holder releases exactly when the
        // resume run is acknowledged; the resume becomes the active holder.
        await tx.webRequestLedger.updateMany({ where: { engagementId, activeThreadId: threadId, id: { not: row.id } }, data: { activeThreadId: null } });
        return recoveryView(await tx.webRequestLedger.update({ where: { id: row.id }, data: { state: 'accepted', threadId, runId, activeThreadId: threadId } }));
      }
      return recoveryView(await tx.webRequestLedger.update({ where: { id: row.id }, data: { state: 'accepted', threadId, runId } }));
    });
  }

  public async markUncertain(userId: string, engagementId: string, requestId: string, token: string): Promise<void> {
    await this.changeCreating(userId, engagementId, requestId, token, 'uncertain');
  }
  public async rejectBeforeDispatch(userId: string, engagementId: string, requestId: string, token: string): Promise<void> {
    await this.changeCreating(userId, engagementId, requestId, token, 'rejected');
  }
  private async changeCreating(userId: string, engagementId: string, requestId: string, token: string, state: 'uncertain' | 'rejected'): Promise<void> {
    identifier(requestId, true);
    await this.transaction(async tx => {
      await this.owned(tx, userId, engagementId, 'operator');
      const count = await tx.webRequestLedger.updateMany({ where: { engagementId, requestId, reservationToken: token, state: 'creating' }, data: { state, ...(state === 'rejected' ? { activeThreadId: null } : {}) } });
      if (!count.count) throw conflict();
    });
  }

  // The caller must first observe this exact run in a terminal runtime state.
  public async releaseCompletedRun(userId: string, engagementId: string, requestId: string, runId: string): Promise<void> {
    identifier(requestId, true); identifier(runId);
    await this.transaction(async tx => {
      await this.owned(tx, userId, engagementId);
      const count = await tx.webRequestLedger.updateMany({ where: { engagementId, requestId, runId, state: 'accepted', operation: { not: 'create_thread' } }, data: { activeThreadId: null } });
      if (!count.count) throw conflict();
    });
  }

  public async sweepStaleCreating(cutoff = new Date(Date.now() - 120_000)): Promise<number> {
    const count = await this.db.webRequestLedger.updateMany({ where: { state: 'creating', updatedAt: { lt: cutoff } }, data: { state: 'uncertain' } });
    return count.count;
  }
}
