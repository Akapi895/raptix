import { randomUUID } from 'node:crypto';
import type { RequestOperation, RequestRecoveryView, ThreadBindingView, ThreadKind } from '@raptix/web-contracts';
import type { Prisma, PrismaClient, Engagement, EngagementThread, WebRequestLedger } from '../generated/prisma/client.js';
import { assertProjectTarget, isProjectSlug, ProjectPolicyError } from '../security/project-policy.js';
import { requestFingerprint } from '../security/request-fingerprint.js';
import { ProjectNotFoundError } from './projects-service.js';

export interface BindingInput { threadId: string; assistantId: string; kind: ThreadKind; contextHash: string; runtimeConfigHash?: string }
export type Reservation = { reserved: true; token: string; request: RequestRecoveryView } | { reserved: false; request: RequestRecoveryView };
const conflict = (): ProjectPolicyError => new ProjectPolicyError('conflict', 'Runtime ownership or request intent conflicts with persisted state');
function identifier(value: string, request = false): void {
  if (typeof value !== 'string' || !(request ? /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/ : /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/).test(value)) throw new ProjectPolicyError('bad_request', 'Invalid runtime identifier');
}
function contextHash(project: Engagement, assistantId: string, kind: ThreadKind): string {
  return requestFingerprint({ engagementId: project.id, workspaceSlug: project.name, targetType: project.targetType, targetValue: project.targetValue, authorizationConfirmed: project.authorizationConfirmed, assistantId, kind });
}
function bindingView(row: EngagementThread): ThreadBindingView {
  return { engagementId: row.engagementId, threadId: row.threadId, assistantId: row.assistantId, kind: row.kind, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function recoveryView(row: WebRequestLedger): RequestRecoveryView {
  return { engagementId: row.engagementId, requestId: row.requestId, operation: row.operation, state: row.state, threadId: row.threadId, runId: row.runId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export class RuntimeOwnershipService {
  public constructor(private readonly db: PrismaClient) {}

  private async transaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.db.$transaction(action); }
    catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict();
      throw error;
    }
  }

  private async owned(tx: Prisma.TransactionClient, userId: string, engagementId: string): Promise<Engagement> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Engagement" WHERE "id" = ${engagementId} AND "userId" = ${userId} FOR UPDATE`;
    if (!rows.length) throw new ProjectNotFoundError();
    const project = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    if (!isProjectSlug(project.name)) throw new ProjectNotFoundError();
    return project;
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
      const project = await this.owned(tx, userId, engagementId);
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

  public async getBinding(userId: string, engagementId: string, threadId: string, expected?: { assistantId: string; kind: ThreadKind; runtimeConfigHash?: string }): Promise<ThreadBindingView> {
    return this.transaction(async tx => {
      const row = await this.binding(tx, await this.owned(tx, userId, engagementId), threadId);
      if (expected && (expected.assistantId !== row.assistantId || expected.kind !== row.kind)) throw conflict();
      if (expected?.runtimeConfigHash !== undefined && row.runtimeConfigHash !== expected.runtimeConfigHash) throw conflict();
      return bindingView(row);
    });
  }

  public async reserve(userId: string, engagementId: string, requestId: string, operation: RequestOperation, payload: unknown, threadId: string | null = null): Promise<Reservation> {
    identifier(requestId, true);
    if (!['create_thread', 'create_run', 'resume'].includes(operation) || (operation === 'create_thread') !== (threadId === null)) throw new ProjectPolicyError('bad_request', 'Invalid request operation/thread binding');
    return this.transaction(async tx => {
      const project = await this.owned(tx, userId, engagementId);
      const bound = threadId === null ? null : await this.binding(tx, project, threadId);
      const payloadHash = requestFingerprint({ operation, threadId, payload, contextHash: bound?.contextHash ?? contextHash(project, '', 'planning') });
      const existing = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.operation !== operation || existing.threadId !== threadId && operation !== 'create_thread') throw conflict();
        return { reserved: false, request: recoveryView(existing) };
      }
      if (bound && await tx.webRequestLedger.count({ where: { engagementId, activeThreadId: { not: null }, thread: { kind: bound.kind === 'planning' ? 'execution' : 'planning' } } })) throw conflict();
      const row = await tx.webRequestLedger.create({ data: { engagementId, requestId, operation, payloadHash, threadId, activeThreadId: threadId, reservationToken: randomUUID() } });
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
      await this.owned(tx, userId, engagementId);
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
      const project = await this.owned(tx, userId, engagementId);
      await this.binding(tx, project, threadId);
      const row = await tx.webRequestLedger.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (!row || row.reservationToken !== token || row.state === 'rejected') throw conflict();
      if (row.operation === 'create_thread' ? runId !== null : runId === null || row.threadId !== threadId) throw conflict();
      if (row.state === 'accepted') {
        if (row.threadId !== threadId || row.runId !== runId) throw conflict();
        return recoveryView(row);
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
      await this.owned(tx, userId, engagementId);
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
