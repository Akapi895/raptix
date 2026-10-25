import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isProjectViewModel } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerProjectRoutes } from '../src/http/routes/projects.routes.js';
import { ProjectsService } from '../src/services/projects-service.js';
import type {
  CreateProjectData,
  ProjectRecord,
  ProjectRepositoryPort,
  UpdateProjectData,
} from '../src/services/projects-service.js';
import { WorkspaceSlugConflictError } from '../src/services/projects-service.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { SandboxProvisionError } from '../src/integrations/sandboxes/sandbox-controller-client.js';

class FakeEngagementNameConflictError extends Error {
  public constructor(slug: string) {
    super(`An engagement named "${slug}" already exists for this owner`);
    this.name = 'EngagementNameConflictError';
  }
}

type MutableProjectRecord = {
  -readonly [K in keyof ProjectRecord]: ProjectRecord[K];
};

class InMemoryProjectRepository implements ProjectRepositoryPort {
  private readonly store: MutableProjectRecord[] = [];
  private readonly takenSlugs = new Set<string>();
  public get records(): ProjectRecord[] {
    return this.store;
  }
  public readonly created: CreateProjectData[] = [];
  public readonly updated: Array<{ id: string; data: UpdateProjectData }> = [];
  public createError: Error | null = null;

  public async list(userId: string): Promise<ProjectRecord[]> {
    return this.store
      .filter((record) => record.userId === userId)
      .map((record) => ({ ...record }));
  }

  public async findById(userId: string, id: string): Promise<ProjectRecord | null> {
    const found = this.store.find(
      (record) => record.userId === userId && record.id === id,
    );
    return found ? { ...found } : null;
  }

  public async allocateWorkspaceSlug(name: string): Promise<string> {
    const used = new Set(this.store.map((record) => record.workspaceSlug));
    if (!used.has(name)) return name;
    let attempt = 0;
    while (used.has(`${name}-${attempt}`)) attempt += 1;
    return `${name}-${attempt}`;
  }

  public async create(userId: string, data: CreateProjectData): Promise<ProjectRecord> {
    this.created.push({ ...data });
    if (this.createError !== null) throw this.createError;
    if (
      this.store.some(
        (record) => record.userId === userId && record.name === data.name,
      )
    ) {
      throw new FakeEngagementNameConflictError(data.name);
    }
    if (this.store.some((record) => record.workspaceSlug === data.workspaceSlug)) {
      throw new WorkspaceSlugConflictError(data.workspaceSlug);
    }
    const now = new Date();
    const record: ProjectRecord = {
      id: `eng_${String(this.created.length).padStart(3, '0')}`,
      name: data.name,
      workspaceSlug: data.workspaceSlug,
      displayName: data.displayName ?? null,
      targetType: data.targetType,
      targetValue: data.targetValue,
      authorizationConfirmed: data.authorizationConfirmed,
      status: 'draft',
      userId,
      threadId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.push({ ...record });
    return { ...record };
  }

  public async update(
    userId: string,
    id: string,
    data: UpdateProjectData,
  ): Promise<ProjectRecord | null> {
    const found = this.store.find(
      (record) => record.userId === userId && record.id === id,
    );
    if (!found) return null;
    this.updated.push({ id, data });
    if (data.displayName !== undefined) found.displayName = data.displayName;
    if (data.targetType !== undefined) found.targetType = data.targetType;
    if (data.targetValue !== undefined) found.targetValue = data.targetValue;
    return { ...found };
  }
}

const BRIEF = 'Authorized lab assessment with scoped constraints.';

let recordSeq = 0;

function makeRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  recordSeq += 1;
  const name = overrides.name ?? 'seed-project';
  return {
    id: overrides.id ?? `eng_${String(recordSeq).padStart(3, '0')}`,
    name,
    workspaceSlug: overrides.workspaceSlug ?? name,
    displayName: null,
    targetType: 'web_url',
    targetValue: 'http://authorized-local-target:3010',
    authorizationConfirmed: true,
    brief: null,
    handoffConfirmedAt: null,
    status: 'draft',
    userId: 'local',
    threadId: null,
    createdAt: new Date('2026-09-30T10:00:00.000Z'),
    updatedAt: new Date('2026-09-30T11:00:00.000Z'),
    ...overrides,
  };
}

interface TestContext {
  readonly app: FastifyInstance;
  readonly repo: InMemoryProjectRepository;
  readonly workspaceRoot: string;
}

let ctx: TestContext;

async function setupContext(): Promise<TestContext> {
  const repo = new InMemoryProjectRepository();
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'raptix-projects-'),
  );
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerProjectRoutes(app, {
    service: new ProjectsService({
      repository: repo,
      files: new LocalProjectFiles(workspaceRoot),
      identity: { id: 'local', mode: 'local-single-user' },
      sandboxes: recordingSandboxes(),
    }),
    identity: { id: 'local', mode: 'local-single-user' },
  });
  return { app, repo, workspaceRoot };
}

beforeEach(async () => {
  ctx = await setupContext();
});

afterEach(async () => {
  await ctx.app.close();
  await rm(ctx.workspaceRoot, { recursive: true, force: true });
});

const EXPECTED_VIEW_KEYS = [
  'id',
  'workspaceSlug',
  'displayName',
  'targetType',
  'targetValue',
  'authorizationConfirmed',
  'brief',
  'handoffConfirmedAt',
  'metadataState',
  'lifecycleStatus',
  'findingCount',
  'assetCount',
  'activeAgentCount',
  'createdAt',
  'updatedAt',
  'source',
].sort();

describe('GET /api/engagements', () => {
  it('lists projects as public view models with null projections and no field leaks', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', name: 'confirmed-project' }),
      makeRecord({
        id: 'eng_002',
        name: 'unconfirmed-project',
        authorizationConfirmed: false,
      }),
      makeRecord({
        id: 'eng_003',
        name: 'imported-project',
        targetValue: 'imported from CLI',
      }),
      makeRecord({ id: 'eng_004', name: 'with/slash' }),
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as unknown[];
    expect(body).toHaveLength(3);
    const json = response.body;
    expect(json).not.toContain('"userId"');
    expect(json).not.toContain('workspacePath');
    expect(json).not.toContain('"name":');
    for (const item of body) {
      expect(isProjectViewModel(item)).toBe(true);
      expect(item).toMatchObject({
        findingCount: null,
        assetCount: null,
        activeAgentCount: null,
        source: 'api',
      });
      expect(Object.keys(item as object).sort()).toEqual(EXPECTED_VIEW_KEYS);
    }
    expect(body[0]).toMatchObject({
      id: 'eng_001',
      workspaceSlug: 'confirmed-project',
      metadataState: 'verified',
      lifecycleStatus: 'draft',
    });
    expect(body[1]).toMatchObject({
      id: 'eng_002',
      metadataState: 'needs_review',
    });
    expect(body[2]).toMatchObject({
      id: 'eng_003',
      metadataState: 'needs_review',
    });
  });

  it('marks legacy confirmed rows with semantically invalid targets needs_review', async () => {
    ctx.repo.records.push(
      makeRecord({
        id: 'eng_101',
        name: 'bogus-web',
        targetType: 'web_url',
        targetValue: 'not-a-url',
      }),
      makeRecord({
        id: 'eng_102',
        name: 'bogus-range',
        targetType: 'ip_range',
        targetValue: '999.999.999.999',
      }),
      makeRecord({
        id: 'eng_103',
        name: 'valid-range',
        targetType: 'ip_range',
        targetValue: '10.0.0.0/24',
      }),
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body[0]).toMatchObject({
      id: 'eng_101',
      metadataState: 'needs_review',
    });
    expect(body[1]).toMatchObject({
      id: 'eng_102',
      metadataState: 'needs_review',
    });
    expect(body[2]).toMatchObject({
      id: 'eng_103',
      metadataState: 'verified',
    });

    const detail = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements/eng_101',
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ metadataState: 'needs_review' });
  });

  it('is side-effect-free: no repository writes and no CLI workspace auto-import', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001', name: 'known-project' }));
    const strayDir = path.join(ctx.workspaceRoot, 'stray-cli-project');
    await mkdir(strayDir, { recursive: true });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(ctx.repo.created).toHaveLength(0);
    expect(ctx.repo.updated).toHaveLength(0);
    expect(response.body).not.toContain('stray-cli-project');
    expect(existsSync(strayDir)).toBe(true);
  });

  it('returns an empty array for a fresh store', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('GET /api/engagements/:id', () => {
  it('returns the public view model and falls back displayName to the slug', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', name: 'acme-web', displayName: null }),
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements/eng_001',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(isProjectViewModel(body)).toBe(true);
    expect(body).toMatchObject({
      id: 'eng_001',
      workspaceSlug: 'acme-web',
      displayName: 'acme-web',
      targetType: 'web_url',
      authorizationConfirmed: true,
      metadataState: 'verified',
      lifecycleStatus: 'draft',
    });
  });

  it('returns the typed 404 envelope for an unknown id', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.statusCode).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it('returns 404 for rows whose name is not a safe workspace slug', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001', name: 'bad\\name' }));

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements/eng_001',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/engagements', () => {
  it('creates a project, persists the workspace path and the plan dir', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'acme-external-assessment',
        targetType: 'web_url',
        targetValue: 'http://authorized-local-target:3010',
        authorizationConfirmed: true,
        brief: BRIEF,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(isProjectViewModel(body)).toBe(true);
    expect(body).toMatchObject({
      workspaceSlug: 'acme-external-assessment',
      displayName: 'acme-external-assessment',
      targetType: 'web_url',
      authorizationConfirmed: true,
      metadataState: 'verified',
      lifecycleStatus: 'draft',
      source: 'api',
    });
    expect(ctx.repo.created).toHaveLength(1);
    expect(ctx.repo.created[0]).toMatchObject({
      name: 'acme-external-assessment',
      targetType: 'web_url',
      authorizationConfirmed: true,
    });
    // The API never creates a project directory; the project's sandbox creates it inside its container.
    await expect(
      stat(path.join(ctx.workspaceRoot, 'acme-external-assessment')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists an optional displayName on create', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'acme-web',
        displayName: 'Acme External',
        targetType: 'web_url',
        targetValue: 'http://authorized-local-target:3010',
        authorizationConfirmed: true,
        brief: BRIEF,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ displayName: 'Acme External' });
    expect(ctx.repo.created[0]).toMatchObject({ displayName: 'Acme External' });
  });

  it('accepts ip_range targets', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'range-lab',
        targetType: 'ip_range',
        targetValue: '10.0.0.0/24',
        authorizationConfirmed: true,
        brief: BRIEF,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      targetType: 'ip_range',
      targetValue: '10.0.0.0/24',
    });
  });

  it.each([
    [
      'missing name',
      { targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true },
    ],
    ['uppercase slug', { name: 'Acme', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['too-short slug', { name: 'ab', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['leading hyphen slug', { name: '-abc', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['trailing hyphen slug', { name: 'abc-', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['too-long slug', { name: 'a'.repeat(65), targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['path-like slug', { name: '../escape', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['dotfile slug', { name: '.hidden', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['invalid targetType', { name: 'acme-web', targetType: 'ssh', targetValue: 'http://t.local', authorizationConfirmed: true }],
    ['missing targetValue', { name: 'acme-web', targetType: 'web_url', authorizationConfirmed: true }],
    ['empty targetValue', { name: 'acme-web', targetType: 'web_url', targetValue: '', authorizationConfirmed: true }],
    ['non-url web target', { name: 'acme-web', targetType: 'web_url', targetValue: 'not-a-url', authorizationConfirmed: true }],
    ['authorizationConfirmed false', { name: 'acme-web', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: false }],
    ['authorizationConfirmed missing', { name: 'acme-web', targetType: 'web_url', targetValue: 'http://t.local' }],
    ['unknown field', { name: 'acme-web', targetType: 'web_url', targetValue: 'http://t.local', authorizationConfirmed: true, status: 'running' }],
  ])('rejects invalid create payload: %s with typed 400', async (_label, payload) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: payload as Record<string, unknown>,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error.code).toBe('bad_request');
  });

  it('performs no repository or filesystem writes when the payload is invalid', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'auth-check',
        targetType: 'web_url',
        targetValue: 'http://t.local',
        authorizationConfirmed: false,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(ctx.repo.created).toHaveLength(0);
    expect(existsSync(path.join(ctx.workspaceRoot, 'auth-check'))).toBe(false);
  });

  it('rejects payloads that are not JSON objects', async () => {
    for (const rawBody of ['[]', 'null', '"acme-web"', '42']) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/engagements',
        payload: rawBody,
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('bad_request');
    }
    expect(ctx.repo.created).toHaveLength(0);
  });

  it('returns 409 conflict for a duplicate project name', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', name: 'acme-web' }),
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'acme-web',
        targetType: 'web_url',
        targetValue: 'http://t.local',
        authorizationConfirmed: true,
        brief: BRIEF,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.statusCode).toBe(409);
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toContain('acme-web');
    expect(ctx.repo.created).toHaveLength(1);
  });

  it('maps a raw Prisma P2002 unique violation to 409', async () => {
    ctx.repo.createError = Object.assign(
      new Error('Unique constraint failed on the fields: (`userId`,`name`)'),
      { code: 'P2002' },
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'acme-web',
        targetType: 'web_url',
        targetValue: 'http://t.local',
        authorizationConfirmed: true,
        brief: BRIEF,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('conflict');
  });

  it('returns 503 and no DB write when the project sandbox cannot be started', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerProjectRoutes(app, {
      service: new ProjectsService({
        repository: ctx.repo,
        files: new LocalProjectFiles(ctx.workspaceRoot),
        identity: { id: 'local', mode: 'local-single-user' },
        sandboxes: { async ensure() { throw new SandboxProvisionError(); } },
      }),
      identity: { id: 'local', mode: 'local-single-user' },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/engagements',
        payload: {
          name: 'no-sandbox',
          targetType: 'web_url',
          targetValue: 'http://t.local',
          authorizationConfirmed: true,
          brief: BRIEF,
        },
      });

      expect(response.statusCode).toBe(503);
      expect(ctx.repo.created).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/engagements/:id', () => {
  it('returns 404 without mutation for a displayName-only patch on a poisoned-slug row', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', name: '../poisoned', displayName: 'Old Name' }),
    );

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { displayName: 'New Name' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    expect(ctx.repo.updated).toHaveLength(0);
    expect(ctx.repo.records[0]?.displayName).toBe('Old Name');
  });

  it('returns 404 without mutation for a target patch on a poisoned-slug row', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', name: 'bad\\name' }),
    );

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { targetValue: 'http://t.local' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    expect(ctx.repo.updated).toHaveLength(0);
  });

  it('updates displayName without touching the slug', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', name: 'acme-web', displayName: 'Old Name' }),
    );

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { displayName: 'Acme External' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'eng_001',
      displayName: 'Acme External',
      workspaceSlug: 'acme-web',
    });
    expect(ctx.repo.records[0]?.name).toBe('acme-web');
  });

  it('rejects displayName null — clearing is not supported', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { displayName: null },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
    expect(ctx.repo.updated).toHaveLength(0);
  });

  it('updates the target on a draft project without a thread', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { targetType: 'ip_range', targetValue: '10.0.0.0/24' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targetType: 'ip_range',
      targetValue: '10.0.0.0/24',
      lifecycleStatus: 'draft',
    });
  });

  it('merges a partial target patch with the current record before validation', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001', name: 'acme-web' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { targetValue: 'http://new-target.local:8080' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targetType: 'web_url',
      targetValue: 'http://new-target.local:8080',
    });
  });

  it.each([
    ['planning status', { status: 'planning' } as Partial<ProjectRecord>],
    ['running status', { status: 'running' } as Partial<ProjectRecord>],
    ['completed status', { status: 'completed' } as Partial<ProjectRecord>],
    ['failed status', { status: 'failed' } as Partial<ProjectRecord>],
    ['linked thread', { threadId: 'thread-1' } as Partial<ProjectRecord>],
  ])('rejects target changes with 409 when %s', async (_label, overrides) => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', ...overrides }),
    );

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { targetValue: 'http://other-target.local' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('conflict');
    expect(ctx.repo.updated).toHaveLength(0);
  });

  it('still allows displayName patches on locked projects', async () => {
    ctx.repo.records.push(
      makeRecord({ id: 'eng_001', status: 'running', threadId: 'thread-1' }),
    );

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: { displayName: 'Renamed While Running' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ displayName: 'Renamed While Running' });
  });

  it.each([
    ['name', { name: 'renamed-project' }],
    ['status', { status: 'running' }],
    ['threadId', { threadId: 'thread-9' }],
    ['userId', { userId: 'someone-else' }],
    ['workspaceRoot', { workspaceRoot: '/etc/passwd' }],
    ['authorizationConfirmed', { authorizationConfirmed: false }],
    ['unknown field', { bogus: 1 }],
  ])('rejects immutable or unknown field %s with 400 and no write', async (_label, payload) => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001', name: 'acme-web' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
    expect(ctx.repo.updated).toHaveLength(0);
    const detail = await ctx.app.inject({
      method: 'GET',
      url: '/api/engagements/eng_001',
    });
    expect(detail.json()).toMatchObject({
      workspaceSlug: 'acme-web',
      lifecycleStatus: 'draft',
      authorizationConfirmed: true,
    });
  });

  it('rejects an empty patch', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(ctx.repo.updated).toHaveLength(0);
  });

  it.each([
    ['empty displayName', { displayName: '' }],
    ['whitespace displayName', { displayName: '   ' }],
    ['non-string displayName', { displayName: 42 }],
    ['too-long displayName', { displayName: 'x'.repeat(201) }],
    ['invalid targetType', { targetType: 'ssh' }],
    ['empty targetValue', { targetValue: '' }],
    ['invalid merged web target', { targetValue: 'not-a-url' }],
    ['merged ip_range with web value', { targetType: 'ip_range' }],
  ])('rejects invalid patch value: %s', async (_label, payload) => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001', name: 'acme-web' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
    expect(ctx.repo.updated).toHaveLength(0);
  });

  it('returns the typed 404 envelope for an unknown id', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/does-not-exist',
      payload: { displayName: 'Nope' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    expect(ctx.repo.updated).toHaveLength(0);
  });

  it('rejects a patch payload that is not a JSON object', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001' }));

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/engagements/eng_001',
      payload: ['displayName'],
    });

    expect(response.statusCode).toBe(400);
    expect(ctx.repo.updated).toHaveLength(0);
  });
});

describe('W01 workspace identity isolation', () => {
  it('gives two owners with the same name distinct workspace slugs and directories', async () => {
    const payload = {
      name: 'acme-web',
      targetType: 'web_url',
      targetValue: 'http://authorized-local-target:3010',
      authorizationConfirmed: true,
      brief: BRIEF,
    };
    const createdA = await ctx.app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload,
    });
    expect(createdA.statusCode).toBe(201);

    const ownerB = new ProjectsService({
      repository: ctx.repo,
      files: new LocalProjectFiles(ctx.workspaceRoot),
      identity: { id: 'operator-b', mode: 'local-single-user' },
      sandboxes: recordingSandboxes(),
    });
    const appB = Fastify({ logger: false });
    registerErrorHandler(appB);
    registerProjectRoutes(appB, {
      service: ownerB,
      identity: { id: 'operator-b', mode: 'local-single-user' },
    });
    try {
      const createdB = await appB.inject({
        method: 'POST',
        url: '/api/engagements',
        payload,
      });
      expect(createdB.statusCode).toBe(201);

      const a = createdA.json();
      const b = createdB.json();
      expect(b.workspaceSlug).not.toBe(a.workspaceSlug);
      // In production each project's sandbox creates its plan directory; the test stands in for it.
      await mkdir(path.join(ctx.workspaceRoot, a.workspaceSlug, 'plan'), { recursive: true });
      await mkdir(path.join(ctx.workspaceRoot, b.workspaceSlug, 'plan'), { recursive: true });
      expect(ctx.repo.created).toHaveLength(2);

      await writeFile(
        path.join(ctx.workspaceRoot, a.workspaceSlug, 'plan', 'marker-a'),
        'owner A',
      );
      expect(
        existsSync(
          path.join(ctx.workspaceRoot, b.workspaceSlug, 'plan', 'marker-a'),
        ),
      ).toBe(false);

      const listB = await appB.inject({ method: 'GET', url: '/api/engagements' });
      expect(listB.statusCode).toBe(200);
      expect(listB.json()).toHaveLength(1);
      expect(listB.json()[0]).toMatchObject({ id: b.id });
    } finally {
      await appB.close();
    }
  });
});

describe('unsupported operations', () => {
  it('DELETE /api/engagements/:id is not supported and returns the typed 404 envelope', async () => {
    ctx.repo.records.push(makeRecord({ id: 'eng_001' }));

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/engagements/eng_001',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    expect(ctx.repo.records).toHaveLength(1);
  });
});
