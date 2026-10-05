import type {
  EngagementStatus,
  EngagementTargetType,
  MetadataState,
  ProjectViewModel,
} from '@raptix/web-contracts';
import type { LocalIdentity } from '../auth/identity-provider.js';
import {
  assertProjectTarget,
  assertProjectTargetChangeAllowed,
  isProjectSlug,
  parseCreateProject,
  parseProjectPatch,
  ProjectPolicyError,
} from '../security/project-policy.js';
import {
  prepareEngagementPlanDir,
  resolveEngagementWorkspaceDir,
} from '../security/workspace-policy.js';
import { readPlanningView } from './planning-service.js';
import type { PlanningView } from '@raptix/web-contracts';

/**
 * Persistence-level project record (int-w02-prisma `EngagementRecord` shape).
 * This is NOT the public DTO: `toProjectViewModel` is the only place that
 * produces the wire shape, and it never emits `userId`/`workspacePath`.
 */
export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly targetType: EngagementTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: boolean;
  readonly status: EngagementStatus;
  readonly userId: string;
  readonly threadId: string | null;
  readonly workspacePath: string | null;
  readonly runtimeContextLockedAt?: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateProjectData {
  readonly name: string;
  readonly displayName?: string | null;
  readonly targetType: EngagementTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: boolean;
  readonly workspacePath?: string | null;
}

export interface UpdateProjectData {
  readonly displayName?: string | null;
  readonly targetType?: EngagementTargetType;
  readonly targetValue?: string;
}

/**
 * Storage port satisfied structurally by int-w02-prisma
 * `EngagementsRepository` (its extra `getByName` is irrelevant here).
 * Owner scoping (`userId` first argument) is part of the contract: no method
 * may read or write across owners, and conflict is signalled by throwing an
 * error named `EngagementNameConflictError` or carrying Prisma code `P2002`.
 */
export interface ProjectRepositoryPort {
  list(userId: string): Promise<ProjectRecord[]>;
  findById(userId: string, id: string): Promise<ProjectRecord | null>;
  create(userId: string, data: CreateProjectData): Promise<ProjectRecord>;
  update(
    userId: string,
    id: string,
    data: UpdateProjectData,
  ): Promise<ProjectRecord | null>;
}

export class ProjectApiError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
  }
}

export class ProjectNotFoundError extends ProjectApiError {
  public constructor() {
    super(404, 'Project not found');
  }
}

export class ProjectNameConflictError extends ProjectApiError {
  public constructor(slug: string) {
    super(409, `An engagement named "${slug}" already exists for this owner`);
  }
}

function isOwnerNameConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'EngagementNameConflictError' ||
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Marker value the legacy CLI auto-import wrote into fresh DB rows. */
const IMPORTED_TARGET_PLACEHOLDER = 'imported from CLI';

/**
 * Legacy rows may carry confirmed but semantically invalid targets (legacy
 * POST only required a non-empty value), so `verified` additionally demands
 * the stored target to pass the exact policy check. Only ProjectPolicyError
 * is treated as "invalid target" — anything else propagates.
 */
function hasSemanticTarget(record: ProjectRecord): boolean {
  try {
    assertProjectTarget(record.targetType, record.targetValue);
    return true;
  } catch (error) {
    if (error instanceof ProjectPolicyError) return false;
    throw error;
  }
}

function toMetadataState(record: ProjectRecord): MetadataState {
  if (!record.authorizationConfirmed) return 'needs_review';
  if (record.targetValue === IMPORTED_TARGET_PLACEHOLDER) return 'needs_review';
  if (!hasSemanticTarget(record)) return 'needs_review';
  return 'verified';
}

function toProjectViewModel(record: ProjectRecord): ProjectViewModel {
  return {
    id: record.id,
    workspaceSlug: record.name,
    displayName: record.displayName ?? record.name,
    targetType: record.targetType,
    targetValue: record.targetValue,
    authorizationConfirmed: record.authorizationConfirmed,
    metadataState: toMetadataState(record),
    lifecycleStatus: record.status,
    findingCount: null,
    assetCount: null,
    activeAgentCount: null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    source: 'api',
  };
}

export interface ProjectsServiceOptions {
  readonly repository: ProjectRepositoryPort;
  /** Trusted workspace root; the service writes only <root>/<slug>/plan. */
  readonly workspaceRoot: string;
  /** Local single-user owner; used when a method is called without userId. */
  readonly identity: LocalIdentity;
}

export class ProjectsService {
  private readonly repository: ProjectRepositoryPort;
  private readonly workspaceRoot: string;
  private readonly identity: LocalIdentity;

  public constructor(options: ProjectsServiceOptions) {
    this.repository = options.repository;
    this.workspaceRoot = options.workspaceRoot;
    this.identity = options.identity;
  }

  private ownerId(userId?: string): string {
    return userId ?? this.identity.id;
  }

  public async getPlanning(userId: string, id: string): Promise<PlanningView> {
    const record = await this.repository.findById(userId, id);
    if (record === null || !isProjectSlug(record.name)) throw new ProjectNotFoundError();
    return readPlanningView(this.workspaceRoot, record, toMetadataState(record) === 'verified');
  }

  /**
   * Read-only listing: no legacy auto-import, no filesystem side effects.
   * Rows whose stored name is not a safe workspace slug are omitted so every
   * emitted DTO keeps a usable `workspaceSlug`.
   */
  public async listProjects(userId?: string): Promise<ProjectViewModel[]> {
    const records = await this.repository.list(this.ownerId(userId));
    return records
      .filter((record) => isProjectSlug(record.name))
      .map(toProjectViewModel);
  }

  public async getProject(
    userId: string | undefined,
    id: string,
  ): Promise<ProjectViewModel> {
    const record = await this.repository.findById(this.ownerId(userId), id);
    if (record === null || !isProjectSlug(record.name)) {
      throw new ProjectNotFoundError();
    }
    return toProjectViewModel(record);
  }

  /**
   * Create order matters: parse, then containment-check and mkdir the plan
   * dir, then persist. A filesystem failure therefore never leaves a DB row
   * and never yields a fake 201; a DB failure (e.g. 409 on the per-owner
   * unique name) can leave an idempotent empty slug dir that the same slug
   * reuses — accepted residue, no compensation needed.
   */
  public async createProject(
    userId: string | undefined,
    raw: unknown,
  ): Promise<ProjectViewModel> {
    const parsed = parseCreateProject(raw);
    const workspacePath = await resolveEngagementWorkspaceDir(
      this.workspaceRoot,
      parsed.name,
    );
    await prepareEngagementPlanDir(this.workspaceRoot, parsed.name);
    let record: ProjectRecord;
    try {
      record = await this.repository.create(this.ownerId(userId), {
        name: parsed.name,
        ...(parsed.displayName === undefined
          ? {}
          : { displayName: parsed.displayName }),
        targetType: parsed.targetType,
        targetValue: parsed.targetValue,
        authorizationConfirmed: parsed.authorizationConfirmed,
        workspacePath,
      });
    } catch (error) {
      if (isOwnerNameConflict(error)) {
        throw new ProjectNameConflictError(parsed.name);
      }
      throw error;
    }
    return toProjectViewModel(record);
  }

  /**
   * Only displayName/targetType/targetValue are patchable (strict policy
   * parse). Every patch first loads the owned record and refuses rows whose
   * stored name is not a safe workspace slug — a poisoned legacy row is 404
   * with no mutation. Target-field changes are additionally gated on draft +
   * no runtime thread and validated as the MERGED pair.
   */
  public async patchProject(
    userId: string | undefined,
    id: string,
    raw: unknown,
  ): Promise<ProjectViewModel> {
    const patch = parseProjectPatch(raw);
    const current = await this.repository.findById(this.ownerId(userId), id);
    if (current === null || !isProjectSlug(current.name)) {
      throw new ProjectNotFoundError();
    }
    const changesTarget =
      patch.targetType !== undefined || patch.targetValue !== undefined;
    if (changesTarget) {
      assertProjectTargetChangeAllowed({
        lifecycleStatus: current.status,
        threadId: current.threadId,
        runtimeContextLocked: current.runtimeContextLockedAt != null,
      });
      assertProjectTarget(
        patch.targetType ?? current.targetType,
        patch.targetValue ?? current.targetValue,
      );
    }
    const record = await this.repository.update(this.ownerId(userId), id, patch);
    if (record === null) throw new ProjectNotFoundError();
    return toProjectViewModel(record);
  }
}
