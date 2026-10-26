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
import { readPlannerScope, readPlanningView, type PlannerScope } from './planning-service.js';
import type { ProjectFiles } from './project-files.js';
import type { PlanningView, WorkspaceFileView, WorkspaceTreeView } from '@raptix/web-contracts';

/**
 * Persistence-level project record (int-w02-prisma `EngagementRecord` shape).
 * This is NOT the public DTO: `toProjectViewModel` is the only place that
 * produces the wire shape, and it never emits `userId`.
 */
export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  /** Server-issued, globally unique workspace partition identity (W01). */
  readonly workspaceSlug: string;
  readonly displayName: string | null;
  readonly targetType: EngagementTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: boolean;
  readonly brief?: string | null;
  readonly handoffConfirmedAt?: Date | null;
  readonly status: EngagementStatus;
  readonly userId: string;
  readonly threadId: string | null;
  readonly runtimeContextLockedAt?: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateProjectData {
  readonly name: string;
  /** Server-issued by `allocateWorkspaceSlug`; immutable after create. */
  readonly workspaceSlug: string;
  readonly displayName?: string | null;
  readonly targetType: EngagementTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: boolean;
  readonly brief?: string | null;
}

export interface UpdateProjectData {
  readonly displayName?: string | null;
  readonly targetType?: EngagementTargetType;
  readonly targetValue?: string;
  readonly handoffConfirmedAt?: Date | null;
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
  /**
   * Reserve a globally unique workspace slug derived from `name`. Pure read
   * allocation: the `workspaceSlug` unique constraint remains the backstop
   * for concurrent creators.
   */
  allocateWorkspaceSlug(name: string): Promise<string>;
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

/**
 * Signalled by the repository when the globally unique `workspaceSlug`
 * constraint rejects an insert (concurrent allocation raced past the
 * pre-check). The service retries with a freshly allocated slug.
 */
export class WorkspaceSlugConflictError extends Error {
  public readonly slug: string;

  public constructor(slug: string) {
    super(`Workspace slug "${slug}" is already in use`);
    this.name = 'WorkspaceSlugConflictError';
    this.slug = slug;
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
    workspaceSlug: record.workspaceSlug,
    displayName: record.displayName ?? record.name,
    targetType: record.targetType,
    targetValue: record.targetValue,
    authorizationConfirmed: record.authorizationConfirmed,
    brief: record.brief ?? null,
    handoffConfirmedAt: record.handoffConfirmedAt instanceof Date
      ? record.handoffConfirmedAt.toISOString()
      : record.handoffConfirmedAt ?? null,
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

/** Starts the project's own sandbox container. A project is created only after this resolves. */
export interface ProjectSandboxes {
  ensure(workspaceSlug: string): Promise<void>;
}

export interface ProjectsServiceOptions {
  readonly repository: ProjectRepositoryPort;
  /** Each project's files, held by its own sandbox (ADR-0102). */
  readonly files: ProjectFiles;
  /** Local single-user owner; used when a method is called without userId. */
  readonly identity: LocalIdentity;
  /** ADR-0086 A: every project gets its own sandbox container at creation. */
  readonly sandboxes: ProjectSandboxes;
  /** ADR-0085: approves the planner's scope at the handoff (wired with the database). */
  readonly confirmPlannerScope?: (actorId: string, engagementId: string, plan: PlannerScope) => Promise<unknown>;
}

/** The most workspace entries one listing returns; the rest are reported as truncated. */
const WORKSPACE_TREE_LIMIT = 2000;
/** The most bytes one file preview returns; a larger file is shown from its start, marked truncated. */
const WORKSPACE_FILE_PREVIEW_BYTES = 64 * 1024;

export class ProjectsService {
  private readonly repository: ProjectRepositoryPort;
  private readonly files: ProjectFiles;
  private readonly identity: LocalIdentity;
  private readonly sandboxes: ProjectSandboxes;
  private readonly confirmPlannerScope: ProjectsServiceOptions['confirmPlannerScope'];

  public constructor(options: ProjectsServiceOptions) {
    this.repository = options.repository;
    this.files = options.files;
    this.identity = options.identity;
    this.sandboxes = options.sandboxes;
    this.confirmPlannerScope = options.confirmPlannerScope;
  }

  private ownerId(userId?: string): string {
    return userId ?? this.identity.id;
  }

  /** The project's whole /workspace as a read-only listing, read from its sandbox. */
  public async getWorkspaceTree(userId: string, id: string): Promise<WorkspaceTreeView> {
    const record = await this.repository.findById(userId, id);
    if (record === null || !isProjectSlug(record.name)) throw new ProjectNotFoundError();
    const tree = await this.files.tree(record.workspaceSlug, WORKSPACE_TREE_LIMIT);
    return {
      root: '/workspace',
      truncated: tree.truncated,
      entries: tree.entries.map(entry => ({ path: entry.path, kind: entry.isDirectory ? 'dir' : 'file', size: entry.size, modifiedAt: entry.mtime.toISOString() })),
    };
  }

  /** One file under /workspace for display: a preview of its start, and no content for binary files. */
  public async getWorkspaceFile(userId: string, id: string, rel: string): Promise<WorkspaceFileView> {
    const record = await this.repository.findById(userId, id);
    if (record === null || !isProjectSlug(record.name)) throw new ProjectNotFoundError();
    const data = await this.files.read(record.workspaceSlug, rel);
    if (data === null) throw new ProjectApiError(404, 'No file exists at this path.');
    const binary = data.subarray(0, 8192).includes(0);
    const shown = data.subarray(0, WORKSPACE_FILE_PREVIEW_BYTES);
    return { path: rel, size: data.length, binary, truncated: data.length > shown.length, content: binary ? null : shown.toString('utf8') };
  }

  public async getPlanning(userId: string, id: string): Promise<PlanningView> {
    const record = await this.repository.findById(userId, id);
    if (record === null || !isProjectSlug(record.name)) throw new ProjectNotFoundError();
    return readPlanningView(this.files, record, toMetadataState(record) === 'verified');
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
   * Create order matters: parse, then allocate a globally unique workspace
   * slug (W01 — the per-owner `name` alone is not a safe partition identity),
   * then start the project's own sandbox container (ADR-0086 A), which creates
   * its directory inside the container, then persist. The API never creates a
   * project directory itself: the sandbox is the only writer of its workspace.
   * The sandbox is started before the row exists, so a project never exists
   * without its sandbox: a failed start returns 503 and leaves no DB row. A
   * sandbox failure never yields a fake 201; a DB failure (409 on the per-owner
   * unique name, or a lost `workspaceSlug` allocation race) retries allocation
   * on the slug conflict only. Residue is accepted: a sandbox container whose row
   * failed to persist, which an operator removes with
   * `docker rm -f sbx-<slug>`.
   */
  public async createProject(
    userId: string | undefined,
    raw: unknown,
  ): Promise<ProjectViewModel> {
    const parsed = parseCreateProject(raw);
    let slugConflict: WorkspaceSlugConflictError | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const workspaceSlug = await this.repository.allocateWorkspaceSlug(
        parsed.name,
      );
      await this.sandboxes.ensure(workspaceSlug);
      try {
        const record = await this.repository.create(this.ownerId(userId), {
          name: parsed.name,
          ...(parsed.displayName === undefined
            ? {}
            : { displayName: parsed.displayName }),
          targetType: parsed.targetType,
          targetValue: parsed.targetValue,
          authorizationConfirmed: parsed.authorizationConfirmed,
          brief: parsed.brief,
          workspaceSlug,
        });
        return toProjectViewModel(record);
      } catch (error) {
        if (error instanceof WorkspaceSlugConflictError) {
          slugConflict = error;
          continue;
        }
        if (isOwnerNameConflict(error)) {
          throw new ProjectNameConflictError(parsed.name);
        }
        throw error;
      }
    }
    throw (
      slugConflict ??
      new Error('Workspace slug allocation raced repeatedly; giving up')
    );
  }

  /**
   * ADR-0085: the handoff is refused unless every required planning document is
   * ready, and confirming it approves the scope roe.json plans for a
   * single-operator engagement. Engagements with more members keep the
   * independent scope review.
   */
  private async confirmPlanningHandoff(actorId: string, record: ProjectRecord): Promise<void> {
    const view = await readPlanningView(this.files, record, toMetadataState(record) === 'verified');
    if (view.readiness.state !== 'ready') {
      throw new ProjectApiError(409, `Planning is not ready for handoff: ${view.readiness.reasons.join('; ')}`);
    }
    if (this.confirmPlannerScope === undefined) {
      throw new ProjectApiError(409, 'The planning scope cannot be approved without the database.');
    }
    const plan = await readPlannerScope(this.files, record.workspaceSlug);
    if (plan === null) throw new ProjectApiError(409, 'roe.json is not a valid planning document, so the handoff cannot approve its scope.');
    await this.confirmPlannerScope(actorId, record.id, plan);
  }

  /**
   * Only displayName/targetType/targetValue plus the one-way handoff
   * confirmation are patchable (strict policy parse). Every patch first
   * loads the owned record and refuses rows whose stored name is not a safe
   * workspace slug — a poisoned legacy row is 404 with no mutation.
   * Target-field changes are additionally gated on draft + no runtime thread
   * and validated as the MERGED pair.
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
    if (patch.handoffConfirmed !== undefined) {
      await this.confirmPlanningHandoff(this.ownerId(userId), current);
    }
    const record = await this.repository.update(this.ownerId(userId), id, {
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.targetType === undefined ? {} : { targetType: patch.targetType }),
      ...(patch.targetValue === undefined ? {} : { targetValue: patch.targetValue }),
      ...(patch.handoffConfirmed === undefined ? {} : { handoffConfirmedAt: new Date() }),
    });
    if (record === null) throw new ProjectNotFoundError();
    return toProjectViewModel(record);
  }
}
