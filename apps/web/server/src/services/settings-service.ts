import type { PrismaClient } from '../generated/prisma/client.js';
import type { EngagementSettingsView } from '@raptix/web-contracts';
import type { LocalIdentity } from '../auth/identity-provider.js';
import { ProjectNotFoundError, type ProjectRecord } from './projects-service.js';

/**
 * W15 engagement settings: only the fields the new server actually persists.
 * The view states the target-change policy up front (draft-only lifecycle and
 * no linked/locked runtime thread); deletion is an explicit danger action that
 * removes the database record, bound threads and request ledger while workspace
 * artifacts on disk are retained and said so.
 */

const IN_FLIGHT_GUARD = { activeThreadId: { not: null }, operation: { not: 'create_thread' } } as const;

export class EngagementDeleteConflictError extends Error {
  public readonly statusCode = 409;
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SettingsService {
  public constructor(private readonly db: PrismaClient, private readonly identity: LocalIdentity) {}

  public async settings(userId: string, engagementId: string): Promise<EngagementSettingsView> {
    const record = await this.find(userId, engagementId);
    return toSettingsView(record);
  }

  public async deleteEngagement(userId: string, engagementId: string): Promise<{ ok: true; workspaceRetained: true }> {
    const record = await this.find(userId, engagementId);
    // A bound planning thread legitimately holds `activeThreadId` forever; only
    // in-flight run/resume holds (no completion release yet) block deletion.
    const active = await this.db.webRequestLedger.count({
      where: { engagementId: record.id, ...IN_FLIGHT_GUARD },
    });
    if (active > 0) {
      throw new EngagementDeleteConflictError(`${active} runtime request(s) still hold an active run. Let them settle (or cancel the runs) before deleting the engagement.`);
    }
    await this.db.$transaction(async tx => {
      await tx.webRequestLedger.deleteMany({ where: { engagementId: record.id } });
      await tx.engagementThread.deleteMany({ where: { engagementId: record.id } });
      await tx.engagement.delete({ where: { id: record.id } });
    });
    return { ok: true, workspaceRetained: true };
  }

  private async find(userId: string, engagementId: string): Promise<ProjectRecord> {
    const record = await this.db.engagement.findFirst({ where: { id: engagementId, userId: userId === undefined ? this.identity.id : userId } });
    if (!record) throw new ProjectNotFoundError();
    return record as unknown as ProjectRecord;
  }
}

export function toSettingsView(record: ProjectRecord): EngagementSettingsView {
  if (record.status !== 'draft') {
    return buildView(record, false, 'Target changes are only allowed while the project is in draft');
  }
  if (record.threadId !== null) {
    return buildView(record, false, 'Target changes are not allowed once a runtime thread is linked');
  }
  if (record.runtimeContextLockedAt != null) {
    return buildView(record, false, 'Target changes are not allowed once the runtime context is locked');
  }
  return buildView(record, true, null);
}

function buildView(record: ProjectRecord, allowed: boolean, reason: string | null): EngagementSettingsView {
  return {
    engagementId: record.id,
    displayName: record.displayName ?? record.name,
    name: record.name,
    targetType: record.targetType,
    targetValue: record.targetValue,
    authorizationConfirmed: record.authorizationConfirmed,
    lifecycleStatus: record.status,
    targetChange: { allowed, reason },
    source: 'db',
  };
}
