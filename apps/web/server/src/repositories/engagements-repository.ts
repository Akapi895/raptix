import { randomBytes } from 'node:crypto';
import type {
  EngagementStatus,
  EngagementTargetType,
} from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectPolicyError } from '../security/project-policy.js';
import { WorkspaceSlugConflictError } from '../services/projects-service.js';

type EngagementDelegate = PrismaClient['engagement'];
type EngagementRow = Awaited<ReturnType<EngagementDelegate['findFirstOrThrow']>>;

/**
 * Persistence-level engagement record (legacy `Engagement` table row shape,
 * camelCase). This is NOT the public project DTO: mapping to
 * `ProjectViewModel` (no `userId`/`workspacePath` exposure) belongs to the
 * service/routes owner.
 */
export interface EngagementRecord {
  readonly id: string;
  readonly name: string;
  readonly workspaceSlug: string;
  readonly displayName: string | null;
  readonly targetType: EngagementTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: boolean;
  readonly brief: string | null;
  readonly handoffConfirmedAt: Date | null;
  readonly status: EngagementStatus;
  readonly userId: string;
  readonly threadId: string | null;
  readonly workspacePath: string | null;
  readonly runtimeContextLockedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateEngagementData {
  readonly name: string;
  readonly workspaceSlug: string;
  readonly displayName?: string | null;
  readonly targetType: EngagementTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: boolean;
  readonly brief?: string | null;
  readonly threadId?: string | null;
  readonly workspacePath?: string | null;
}

export interface UpdateEngagementData {
  readonly name?: string;
  readonly displayName?: string | null;
  readonly targetType?: EngagementTargetType;
  readonly targetValue?: string;
  readonly status?: EngagementStatus;
  readonly threadId?: string | null;
  readonly workspacePath?: string | null;
  readonly brief?: string | null;
  readonly handoffConfirmedAt?: Date | null;
}

/**
 * Thrown when create/update violates the per-owner unique engagement name
 * (`P2002` on `Engagement_userId_name_key`). The HTTP layer maps this to a
 * 409 conflict.
 */
export class EngagementNameConflictError extends Error {
  public readonly userId: string;
  public readonly requestedName: string;

  public constructor(userId: string, requestedName: string) {
    super(`An engagement named "${requestedName}" already exists for this owner`);
    this.name = 'EngagementNameConflictError';
    this.userId = userId;
    this.requestedName = requestedName;
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Serialized P2002 metadata. Shape differs by stack: classic Prisma exposes
 * `meta.target`; the pg driver adapter nests the violated constraint under
 * `meta.driverAdapterError.cause`. Serializing covers both without coupling
 * to either internal shape.
 */
function uniqueViolationDetail(error: unknown): string {
  const meta = (error as { meta?: unknown }).meta;
  try {
    return JSON.stringify(meta ?? {}).toLowerCase();
  } catch {
    return '';
  }
}

function isWorkspaceSlugViolation(error: unknown): boolean {
  return (
    isUniqueConstraintViolation(error) &&
    uniqueViolationDetail(error).includes('workspaceslug')
  );
}

function toRecord(row: EngagementRow): EngagementRecord {
  return {
    id: row.id,
    name: row.name,
    workspaceSlug: row.workspaceSlug,
    displayName: row.displayName,
    targetType: row.targetType as EngagementTargetType,
    targetValue: row.targetValue,
    authorizationConfirmed: row.authorizationConfirmed,
    brief: row.brief,
    handoffConfirmedAt: row.handoffConfirmedAt,
    status: row.status as EngagementStatus,
    userId: row.userId,
    threadId: row.threadId,
    workspacePath: row.workspacePath,
    runtimeContextLockedAt: row.runtimeContextLockedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prisma-backed engagement storage. Every lookup and mutation is scoped to
 * the owning `userId`; no method performs filesystem auto-import or any
 * other read-triggered mutation (unlike the legacy GET list handler).
 */
export class EngagementsRepository {
  private readonly db: EngagementDelegate;

  public constructor(db: EngagementDelegate, private readonly memberships?: PrismaClient['webMembership'], private readonly deploymentId?: string) {
    this.db = db;
  }

  public async list(userId: string): Promise<EngagementRecord[]> {
    const memberships = this.memberships ? await this.memberships.findMany({ where: { userId }, select: { engagementId: true } }) : [];
    const rows = await this.db.findMany({
      where: memberships.length ? { OR: [{ userId }, { id: { in: memberships.map((m) => m.engagementId) } }] } : { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  public async findById(
    userId: string,
    id: string,
  ): Promise<EngagementRecord | null> {
    const membership = this.memberships ? await this.memberships.findFirst({ where: { userId, engagementId: id } }) : null;
    const row = await this.db.findFirst({ where: membership ? { id } : { id, userId } });
    return row ? toRecord(row) : null;
  }

  public async getByName(
    userId: string,
    name: string,
  ): Promise<EngagementRecord | null> {
    const row = await this.db.findFirst({ where: { userId, name } });
    return row ? toRecord(row) : null;
  }

  /**
   * Pure-read slug allocation (W01): `name` when globally unused, else a
   * bounded random suffix derived from it. The `workspaceSlug` unique index
   * remains the authoritative backstop against concurrent creators.
   */
  public async allocateWorkspaceSlug(name: string): Promise<string> {
    const rows = await this.db.findMany({
      where: { workspaceSlug: { startsWith: name } },
      select: { workspaceSlug: true },
    });
    const taken = new Set(rows.map((row) => row.workspaceSlug));
    if (!taken.has(name)) return name;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `${name.slice(0, 57)}-${randomBytes(3).toString('hex')}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new WorkspaceSlugConflictError(name);
  }

  public async create(
    userId: string,
    data: CreateEngagementData,
  ): Promise<EngagementRecord> {
    try {
      const row = await this.db.create({
        data: {
          userId,
          name: data.name,
          workspaceSlug: data.workspaceSlug,
          displayName: data.displayName ?? null,
          targetType: data.targetType,
          targetValue: data.targetValue,
          authorizationConfirmed: data.authorizationConfirmed,
          brief: data.brief ?? null,
          threadId: data.threadId ?? null,
          workspacePath: data.workspacePath ?? null,
          ...(this.deploymentId === undefined ? {} : { environments: { create: { deploymentId: this.deploymentId } } }),
        },
      });
      return toRecord(row);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        if (isWorkspaceSlugViolation(error)) {
          throw new WorkspaceSlugConflictError(data.workspaceSlug);
        }
        throw new EngagementNameConflictError(userId, data.name);
      }
      throw error;
    }
  }

  /**
   * Owner-scoped partial update. `authorizationConfirmed`, `userId` and `id`
   * are intentionally immutable here (legacy PATCH parity). Returns `null`
   * when no engagement with `id` exists for `userId`.
   */
  public async update(
    userId: string,
    id: string,
    data: UpdateEngagementData,
  ): Promise<EngagementRecord | null> {
    const patch: {
      name?: string;
      displayName?: string | null;
      targetType?: EngagementTargetType;
      targetValue?: string;
      status?: EngagementStatus;
      threadId?: string | null;
      workspacePath?: string | null;
      brief?: string | null;
      handoffConfirmedAt?: Date | null;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.displayName !== undefined) patch.displayName = data.displayName;
    if (data.targetType !== undefined) patch.targetType = data.targetType;
    if (data.targetValue !== undefined) patch.targetValue = data.targetValue;
    if (data.status !== undefined) patch.status = data.status;
    if (data.threadId !== undefined) patch.threadId = data.threadId;
    if (data.workspacePath !== undefined) patch.workspacePath = data.workspacePath;
    if (data.brief !== undefined) patch.brief = data.brief;
    if (data.handoffConfirmedAt !== undefined) patch.handoffConfirmedAt = data.handoffConfirmedAt;

    try {
      const result = await this.db.updateMany({
        where: { id, userId, ...(data.targetType !== undefined || data.targetValue !== undefined ? { runtimeContextLockedAt: null, threadId: null, status: 'draft' as const } : {}) },
        data: patch,
      });
      if (result.count === 0) {
        if ((data.targetType !== undefined || data.targetValue !== undefined) && await this.db.findFirst({ where: { id, userId } })) throw new ProjectPolicyError('conflict', 'Target context is locked or no longer draft');
        return null;
      }
      const row = await this.db.findFirst({ where: { id, userId } });
      return row ? toRecord(row) : null;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const requestedName = data.name ?? '';
        throw new EngagementNameConflictError(userId, requestedName);
      }
      throw error;
    }
  }
}
