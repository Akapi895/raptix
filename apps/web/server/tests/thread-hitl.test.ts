import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import Fastify from 'fastify';
import type { PlanningView, ProjectViewModel, ThreadBindingView } from '@raptix/web-contracts';
import { PLANNING_DOCUMENTS } from '@raptix/web-contracts';
import type { LocalIdentity } from '../src/auth/identity-provider.js';
import { loadRuntimeConfig } from '../src/config/runtime.js';
import { parseThreadHitl, registerThreadHitlRoutes } from '../src/http/routes/thread-hitl.routes.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';
import { RuntimeContextService } from '../src/services/runtime/runtime-context.js';
import { requestFingerprint } from '../src/security/request-fingerprint.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';

describe('parseThreadHitl', () => {
  it('accepts exactly {"enabled": boolean}', () => {
    expect(parseThreadHitl({ enabled: true })).toBe(true);
    expect(parseThreadHitl({ enabled: false })).toBe(false);
  });

  it('refuses any other body shape', () => {
    for (const body of [undefined, null, 'off', [], {}, { enabled: 'false' }, { enabled: 1 }, { enabled: true, threadId: 'x' }]) {
      expect(() => parseThreadHitl(body)).toThrow(/HITL switch/);
    }
  });
});

describe('PATCH /api/engagements/:id/threads/:thread/hitl', () => {
  async function app(calls: unknown[]) {
    const server = Fastify();
    const ownership = {
      async setThreadHitl(user: string, engagementId: string, threadId: string, enabled: boolean): Promise<ThreadBindingView> {
        calls.push({ user, engagementId, threadId, enabled });
        return { engagementId, threadId, assistantId: 'raptix', kind: 'execution', createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', hitlEnabled: enabled };
      },
    };
    registerThreadHitlRoutes(server, ownership as unknown as RuntimeOwnershipService, { id: 'owner-1' } as LocalIdentity);
    return server;
  }

  it('returns the thread id and the stored switch on a valid body', async () => {
    const calls: unknown[] = [];
    const server = await app(calls);
    const response = await server.inject({ method: 'PATCH', url: '/api/engagements/eng-1/threads/th-1/hitl', payload: { enabled: false } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ threadId: 'th-1', hitlEnabled: false });
    expect(calls).toEqual([{ user: 'owner-1', engagementId: 'eng-1', threadId: 'th-1', enabled: false }]);
    await server.close();
  });

  it('answers 400 and never reaches the ownership service for a non-boolean body', async () => {
    const calls: unknown[] = [];
    const server = await app(calls);
    const response = await server.inject({ method: 'PATCH', url: '/api/engagements/eng-1/threads/th-1/hitl', payload: { enabled: 'no' } });
    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await server.close();
  });
});

describe('RuntimeOwnershipService.setThreadHitl', () => {
  it('writes the switch and one audit entry in the same transaction, and returns the stored view', async () => {
    const updates: { where: unknown; data: { hitlEnabled: boolean } }[] = [];
    const audits: Record<string, unknown>[] = [];
    const tx = {
      engagementThread: { updateMany: async (args: { where: unknown; data: { hitlEnabled: boolean } }) => { updates.push(args); return { count: 1 }; } },
      webAuditEntry: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; } },
    };
    const db = { $transaction: async (action: (t: typeof tx) => Promise<unknown>) => action(tx) };
    const service = new RuntimeOwnershipService(db as never);
    const internals = service as unknown as { owned: () => Promise<unknown>; binding: () => Promise<unknown> };
    const threadRow = { engagementId: 'eng-1', threadId: 'th-1', assistantId: 'raptix', kind: 'execution', title: null, contextHash: 'h', runtimeConfigHash: null, createdAt: new Date('2026-10-18T00:00:00Z'), updatedAt: new Date('2026-10-18T00:00:00Z') };
    internals.owned = async () => ({ id: 'eng-1' });
    internals.binding = async () => ({ ...threadRow, hitlEnabled: updates.length ? updates[updates.length - 1]!.data.hitlEnabled : true });

    const view = await service.setThreadHitl('owner-1', 'eng-1', 'th-1', false);

    expect(view.hitlEnabled).toBe(false);
    expect(updates).toEqual([{ where: { engagementId: 'eng-1', threadId: 'th-1' }, data: { hitlEnabled: false } }]);
    expect(audits).toEqual([{ engagementId: 'eng-1', actorId: 'owner-1', action: 'thread.hitl.set', targetType: 'thread', targetId: 'th-1', detail: { enabled: false } }]);
  });

  it('defaults the migrated column to true so existing conversations keep approval gates on', () => {
    const sql = readFileSync(new URL('../prisma/migrations/20261027000000_thread_hitl/migration.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ADD COLUMN "hitlEnabled" BOOLEAN NOT NULL DEFAULT true');
  });
});

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function runtimeSetup(initialHitl: boolean | undefined) {
  const root = await mkdtemp(path.join(tmpdir(), 'raptix-hitl-')); roots.push(root);
  await mkdir(path.join(root, 'parity-project'));
  const project: ProjectViewModel = { id: 'owned', workspaceSlug: 'parity-project', displayName: 'Project', targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, brief: null, handoffConfirmedAt: null, metadataState: 'verified', lifecycleStatus: 'draft', source: 'api', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const bound: { current: ThreadBindingView } = { current: { engagementId: 'owned', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: project.createdAt, updatedAt: project.updatedAt, ...(initialHitl === undefined ? {} : { hitlEnabled: initialHitl }) } };
  const control = { metadata: {} as Record<string, unknown> };
  const config = loadRuntimeConfig({ LANGGRAPH_API_URL: 'http://127.0.0.1:2400', RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' })!;
  const planning = { version: 1, engagementId: 'owned', documents: Object.fromEntries(['roe', 'conops', 'deconfliction', 'opplan'].map(n => [n, { state: 'missing' }])), bundle: Object.fromEntries(PLANNING_DOCUMENTS.map(n => [n, 'missing'])), readiness: { state: 'blocked', reasons: ['roe:missing'], runtimeSignal: 'not_observed' } } as PlanningView;
  const service = new RuntimeContextService({ config, workspaceRoot: root,
    projects: { async getProject(user: string, id: string) { if (user !== 'local' || id !== project.id) throw new ProjectNotFoundError(); return project; }, async getPlanning() { return planning; } },
    ownership: { async getBinding(user: string, id: string, thread: string) { if (user !== 'local' || id !== 'owned' || thread !== 'thread') throw new ProjectNotFoundError(); return bound.current; }, async prepareBinding() { return requestFingerprint({ engagementId: project.id, workspaceSlug: project.workspaceSlug, targetType: project.targetType, targetValue: project.targetValue, authorizationConfirmed: project.authorizationConfirmed, assistantId: 'soundwave', kind: 'planning' }); } },
    runtime: { async instanceExchange() { throw new Error('not used in this test'); }, async catalog() { return ['soundwave', 'decepticon', 'raptix']; }, async thread() { return { thread_id: 'thread', metadata: control.metadata }; }, async state() { return { values: {}, graphId: 'soundwave' }; } },
  } as never);
  return { service, bound, control };
}

describe('runtime-context carries the conversation HITL switch', () => {
  it('omits the key while HITL is on, so the default configurable and its hash stay unchanged', async () => {
    const { service, control } = await runtimeSetup(true);
    const first = await service.resolve('local', 'owned', { kind: 'planning' });
    control.metadata = first.metadata;
    const bound = await service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' });
    expect(bound.configurable).not.toHaveProperty('hitl_enabled');
    expect(bound.runtimeConfigHash).toBe(first.runtimeConfigHash);
  });

  it('sends hitl_enabled false for a switched-off conversation without changing its runtime hash', async () => {
    const { service, bound, control } = await runtimeSetup(true);
    const first = await service.resolve('local', 'owned', { kind: 'planning' });
    control.metadata = first.metadata;
    bound.current = { ...bound.current, hitlEnabled: false };
    const context = await service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' });
    expect(context.configurable.hitl_enabled).toBe(false);
    expect(context.runtimeConfigHash).toBe(first.runtimeConfigHash);
  });
});
