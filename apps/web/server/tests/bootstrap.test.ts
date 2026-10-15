import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getLocalIdentity } from '../src/auth/identity-provider.js';
import { EnvValidationError, loadServerEnv } from '../src/config/env.js';
import type { DatabaseHealth } from '../src/http/routes/health.routes.js';
import type {
  ProjectRecord,
  ProjectRepositoryPort,
} from '../src/services/projects-service.js';
import { ProjectsService } from '../src/services/projects-service.js';

/** In-memory owner-scoped repository satisfying ProjectRepositoryPort. */
function makeInMemoryRepository(): ProjectRepositoryPort {
  const store = new Map<string, ProjectRecord>();
  const takenSlugs = new Set<string>();
  return {
    async list(userId) {
      return [...store.values()].filter((row) => row.userId === userId);
    },
    async findById(userId, id) {
      const row = store.get(id);
      return row !== undefined && row.userId === userId ? row : null;
    },
    async allocateWorkspaceSlug(name) {
      if (!takenSlugs.has(name)) return name;
      let attempt = 0;
      while (takenSlugs.has(`${name}-${attempt}`)) attempt += 1;
      return `${name}-${attempt}`;
    },
    async create(userId, data) {
      const now = new Date();
      const row: ProjectRecord = {
        id: `eng-${store.size + 1}`,
        name: data.name,
        workspaceSlug: data.workspaceSlug,
        displayName: data.displayName ?? null,
        targetType: data.targetType,
        targetValue: data.targetValue,
        authorizationConfirmed: data.authorizationConfirmed,
        status: 'draft',
        userId,
        threadId: null,
        workspacePath: data.workspacePath ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.set(row.id, row);
      takenSlugs.add(data.workspaceSlug);
      return row;
    },
    async update(userId, id, data) {
      const row = store.get(id);
      if (row === undefined || row.userId !== userId) return null;
      const updated: ProjectRecord = {
        ...row,
        ...(data.displayName !== undefined
          ? { displayName: data.displayName }
          : {}),
        ...(data.targetType !== undefined
          ? { targetType: data.targetType }
          : {}),
        ...(data.targetValue !== undefined
          ? { targetValue: data.targetValue }
          : {}),
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
  };
}

const tempRoots: string[] = [];

/** Real service over the in-memory port: exercises the registration seam. */
function makeProjectsService(): ProjectsService {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'w02-bootstrap-'));
  tempRoots.push(workspaceRoot);
  return new ProjectsService({
    repository: makeInMemoryRepository(),
    workspaceRoot,
    identity: getLocalIdentity(),
  });
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('server bootstrap (unconfigured)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds the app without listening side effects', () => {
    expect(app.server.listening).toBe(false);
  });

  it('GET /api/health reports process liveness without pretending integrations were probed', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.checks.bootstrap.status).toBe('ok');
    expect(body.checks.integrations.status).toBe('not_checked');
    expect(body.scope).toBe('process_liveness');
    expect(body.notProbed).toContain('model_inference');
  });

  it('GET /api/health/ready returns 503 and does not claim fullstack health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health/ready',
    });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('unavailable');
    expect(body.checks.bootstrap.status).toBe('ok');
    expect(body.checks.integrations.status).toBe('not_connected');
    expect(body.checks.database.status).toBe('not_configured');
    expect(body.checks.runtime.status).toBe('not_connected');
  });

  it('GET /api/capabilities returns version 1, local-single-user and all business capabilities service_missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBe(1);
    expect(body.mode).toBe('local-single-user');
    const entries = Object.values(
      body.capabilities as Record<
        string,
        { supported: boolean; available: boolean; reason: string }
      >,
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.supported).toBe(false);
      expect(entry.available).toBe(false);
      expect(entry.reason).toBe('service_missing');
    }
  });

  it('project routes are not registered without an injected projects service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/engagements',
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.statusCode).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it('unknown routes return the typed 404 error envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.statusCode).toBe(404);
    expect(body.error.code).toBe('not_found');
    expect(typeof body.error.message).toBe('string');
  });
});

it('dependency readiness can be healthy without claiming inference or tool execution was tested', async () => {
  const runtime = { agents: vi.fn(async () => ({ source: 'runtime', graphs: ['soundwave'] })) };
  const app = await buildApp({ databaseHealth: { check: async () => ({ status: 'ok' }) }, runtimeContext: runtime as unknown as NonNullable<Parameters<typeof buildApp>[0]>['runtimeContext'] });
  try {
    const response = await app.inject('/api/health/ready');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ scope: 'dependency_wiring', notProbed: ['model_inference', 'tool_execution', 'provider_operations'] });
    expect(runtime.agents).toHaveBeenCalledOnce();
  } finally { await app.close(); }
});

describe('server bootstrap (injected projects service + database health)', () => {
  let app: FastifyInstance;
  let projectsService: ProjectsService;

  beforeAll(async () => {
    projectsService = makeProjectsService();
    app = await buildApp({ projectsService });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the projects capability supported and available when the service is injected without a health probe', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.capabilities.projects).toEqual({
      supported: true,
      available: true,
    });
    expect(body.capabilities.runs).toEqual({
      supported: false,
      available: false,
      reason: 'service_missing',
    });
    expect(body.capabilities.graphs).toEqual({
      supported: false,
      available: false,
      reason: 'service_missing',
    });
  });

  it('registers the project routes only for the injected service', async () => {
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/engagements',
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([]);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/engagements',
      payload: {
        name: 'w02-wired-project',
        targetType: 'web_url',
        targetValue: 'http://authorized-local-target:3010',
        authorizationConfirmed: true,
        brief: 'Authorized lab assessment with scoped constraints.',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.workspaceSlug).toBe('w02-wired-project');
    expect(created.metadataState).toBe('verified');
    expect(created).not.toHaveProperty('userId');
    expect(created).not.toHaveProperty('workspacePath');
  });

  it('reports projects unavailable with database_unavailable when the injected database probe fails', async () => {
    const degraded = await buildApp({
      projectsService: makeProjectsService(),
      databaseHealth: { check: async () => ({ status: 'not_connected' }) },
    });
    try {
      const response = await degraded.inject({
        method: 'GET',
        url: '/api/capabilities',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().capabilities.projects).toEqual({
        supported: true,
        available: false,
        reason: 'database_unavailable',
      });
    } finally {
      await degraded.close();
    }
  });

  it('reports projects available when the injected database probe passes', async () => {
    const healthy = await buildApp({
      projectsService: makeProjectsService(),
      databaseHealth: { check: async () => ({ status: 'ok' }) },
    });
    try {
      const response = await healthy.inject({
        method: 'GET',
        url: '/api/capabilities',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().capabilities.projects).toEqual({
        supported: true,
        available: true,
      });
    } finally {
      await healthy.close();
    }
  });
});

describe('readiness aggregate with database health', () => {
  it('reports degraded 503 with healthy database and truthful runtime/integration states', async () => {
    const app = await buildApp({
      projectsService: makeProjectsService(),
      databaseHealth: { check: async () => ({ status: 'ok' }) },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health/ready',
      });
      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.status).toBe('degraded');
      expect(body.checks.database).toEqual({ status: 'ok' });
      expect(body.checks.runtime.status).toBe('not_connected');
      expect(body.checks.integrations.status).toBe('not_connected');
    } finally {
      await app.close();
    }
  });

  it('reports unavailable 503 with a failing database probe', async () => {
    const app = await buildApp({
      databaseHealth: { check: async () => ({ status: 'not_connected' }) },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health/ready',
      });
      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.status).toBe('unavailable');
      expect(body.checks.database.status).toBe('not_connected');
    } finally {
      await app.close();
    }
  });

  it('treats a throwing database probe as not_connected instead of a 500', async () => {
    const app = await buildApp({
      databaseHealth: {
        check: async () => {
          throw new Error('probe failed');
        },
      },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health/ready',
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().checks.database.status).toBe('not_connected');
    } finally {
      await app.close();
    }
  });
});

describe('lifecycle', () => {
  it('disposes the injected database health once on app close', async () => {
    const dispose = vi.fn(async () => {});
    const databaseHealth: DatabaseHealth = {
      check: async () => ({ status: 'ok' }),
      dispose,
    };
    const app = await buildApp({ databaseHealth });
    await app.close();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not register a dispose hook when none is provided', async () => {
    const app = await buildApp();
    await expect(app.close()).resolves.toBeUndefined();
  });
});

describe('server environment', () => {
  it('defaults to 127.0.0.1:5280 with development log level info', () => {
    expect(loadServerEnv({})).toEqual({
      host: '127.0.0.1',
      port: 5280,
      nodeEnv: 'development',
      logLevel: 'info',
    });
  });

  it('accepts explicit valid overrides', () => {
    expect(
      loadServerEnv({ HOST: '0.0.0.0', PORT: '6000', LOG_LEVEL: 'debug' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 6000,
      nodeEnv: 'development',
      logLevel: 'debug',
    });
  });

  it('parses explicit DATABASE_URL and WORKSPACE_PATH without extra keys', () => {
    const secretUrl = 'postgres://tester:pw@127.0.0.1:5432/w02test';
    const env = loadServerEnv({
      DATABASE_URL: secretUrl,
      WORKSPACE_PATH: 'D:/tmp/w02-workspace',
    });
    expect(env.databaseUrl).toBe(secretUrl);
    expect(env.workspacePath).toBe('D:/tmp/w02-workspace');
    expect(env.graph).toBeUndefined();
    expect(Object.keys(env).sort()).toEqual([
      'databaseUrl',
      'host',
      'logLevel',
      'nodeEnv',
      'port',
      'workspacePath',
    ]);
  });

  it('serves graph config only with an explicit non-default NEO4J_PASSWORD', () => {
    const env = loadServerEnv({
      NEO4J_PASSWORD: 'explicit-secret',
      NEO4J_HTTP_PORT: '7475',
    });
    expect(env.graph).toEqual({ httpUri: 'http://127.0.0.1:7475', user: 'neo4j', password: 'explicit-secret' });
    const custom = loadServerEnv({ NEO4J_PASSWORD: 'explicit-secret', NEO4J_HTTP_URI: 'http://neo4j.internal:7474', NEO4J_USER: 'reader' });
    expect(custom.graph).toEqual({ httpUri: 'http://neo4j.internal:7474', user: 'reader', password: 'explicit-secret' });
    expect(() => loadServerEnv({ NEO4J_PASSWORD: 'raptix-graph' })).toThrow(/public default/);
    expect(loadServerEnv({}).graph).toBeUndefined();
  });

  it('rejects an empty DATABASE_URL without echoing the value', () => {
    const raw = '   ';
    expect(() => loadServerEnv({ DATABASE_URL: raw })).toThrow(
      EnvValidationError,
    );
    try {
      loadServerEnv({ DATABASE_URL: raw });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(JSON.stringify(error)).not.toContain('DATABASE_URL=');
    }
  });

  it('rejects an empty WORKSPACE_PATH without echoing the value', () => {
    expect(() => loadServerEnv({ WORKSPACE_PATH: ' ' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects an invalid port without echoing the raw value', () => {
    const rawPort = 'not-a-port';
    expect(() => loadServerEnv({ PORT: rawPort })).toThrow(EnvValidationError);
    try {
      loadServerEnv({ PORT: rawPort });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(JSON.stringify(error)).not.toContain(rawPort);
    }
  });

  it('never reads or echoes unknown environment variables', () => {
    const secretValue = 'super-secret-value';
    const env = loadServerEnv({ RAPTIX_WEB_SECRET_TOKEN: secretValue });
    expect(Object.keys(env).sort()).toEqual([
      'host',
      'logLevel',
      'nodeEnv',
      'port',
    ]);
    expect(JSON.stringify(env)).not.toContain(secretValue);
  });
});
