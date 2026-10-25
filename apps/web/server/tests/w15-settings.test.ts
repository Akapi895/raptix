import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isEngagementSettingsView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerSettingsRoutes } from '../src/http/routes/settings.routes.js';
import { EngagementDeleteConflictError, SettingsService, toSettingsView } from '../src/services/settings-service.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';

const BASE = { id: 'eng-1', name: 'w15-slug', workspaceSlug: 'w15-slug', displayName: 'W15 Settings', targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, status: 'draft', userId: 'local', threadId: null, runtimeContextLockedAt: null, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') } as const;

function buildDb(record: Record<string, unknown> | null) {
  return {
    engagement: { findFirst: async () => record },
    webRequestLedger: {
      count: async ({ where }: { where: { activeThreadId?: unknown } }) => (record && where.activeThreadId !== undefined ? 1 : 0),
      deleteMany: async () => ({ count: 1 }),
    },
    engagementThread: { deleteMany: async () => ({ count: 1 }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ engagement: { delete: async () => record } }),
  } as never;
}

function buildApp(record: Record<string, unknown> | null, deleted: { value: boolean } = { value: false }): FastifyInstance {
  const service = new SettingsService(buildDb(record), { id: 'local', mode: 'local-single-user' });
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerSettingsRoutes(app, {
    settings: (userId: string, id: string) => service.settings(userId, id),
    deleteEngagement: async () => {
      if (!record) throw new ProjectNotFoundError();
      if (record.threadId !== null) throw new EngagementDeleteConflictError('1 runtime request(s) still hold an active run. Let them settle (or cancel the runs) before deleting the engagement.');
      deleted.value = true;
      return { ok: true, workspaceRetained: true } as const;
    },
  } as unknown as SettingsService, { id: 'local', mode: 'local-single-user' });
  return app;
}

describe('W15 engagement settings', () => {
  it('returns the persisted view with an up-front target-change policy', async () => {
    const app = buildApp({ ...BASE });
    const response = await app.inject({ method: 'GET', url: '/api/engagements/eng-1/settings' });
    expect(response.statusCode).toBe(200);
    const view = response.json();
    expect(isEngagementSettingsView(view)).toBe(true);
    expect(view.targetChange).toEqual({ allowed: true, reason: null });
    expect(view.name).toBe('w15-slug');
  });

  it('states the lifecycle and runtime-lock reasons that block target changes', () => {
    expect(toSettingsView({ ...BASE, status: 'planning' }).targetChange).toEqual({ allowed: false, reason: 'Target changes are only allowed while the project is in draft' });
    expect(toSettingsView({ ...BASE, threadId: 'th-1' }).targetChange).toEqual({ allowed: false, reason: 'Target changes are not allowed once a runtime thread is linked' });
    expect(toSettingsView({ ...BASE, runtimeContextLockedAt: new Date() }).targetChange).toEqual({ allowed: false, reason: 'Target changes are not allowed once the runtime context is locked' });
  });

  it('answers 404 for foreign engagements', async () => {
    const app = buildApp(null);
    expect((await app.inject({ method: 'GET', url: '/api/engagements/other/settings' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/engagements/eng-other' })).statusCode).toBe(404);
  });

  it('deletes the DB record truthfully and refuses while runtime requests are in flight', async () => {
    const deleted = { value: false };
    const app = buildApp({ ...BASE }, deleted);
    const response = await app.inject({ method: 'DELETE', url: '/api/engagements/eng-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, workspaceRetained: true });
    expect(deleted.value).toBe(true);
    const busyApp = buildApp({ ...BASE, threadId: 'th-1' });
    const busy = await busyApp.inject({ method: 'DELETE', url: '/api/engagements/eng-1' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.message).toContain('settle');
  });
});
