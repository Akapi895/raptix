import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import type { ProjectViewModel, PlanningView, ThreadBindingView } from '@raptix/web-contracts';
import { PLANNING_DOCUMENTS } from '@raptix/web-contracts';
import { RuntimeContextService } from '../src/services/runtime/runtime-context.js';
import { loadRuntimeConfig } from '../src/config/runtime.js';
import { requestFingerprint } from '../src/security/request-fingerprint.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(opts: { pinnedSlug?: string; perProjectSandbox?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'raptix-w06-')); roots.push(root);
  await mkdir(path.join(root, 'parity-project'));
  const project: ProjectViewModel = { id: 'owned', workspaceSlug: 'parity-project', displayName: 'Untrusted display name', targetType: 'web_url', targetValue: 'https://authorized.invalid', authorizationConfirmed: true, brief: null, handoffConfirmedAt: null, metadataState: 'verified', lifecycleStatus: 'draft', source: 'api', findingCount: null, assetCount: null, activeAgentCount: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const bound: ThreadBindingView = { engagementId: 'owned', threadId: 'thread', assistantId: 'soundwave', kind: 'planning', createdAt: project.createdAt, updatedAt: project.updatedAt };
  const control = { graphs: ['soundwave', 'decepticon', 'vulnresearch', 'recon'], stateGraph: null as string | null, proof: '', metadata: {} as Record<string, unknown>, values: {} as Record<string, unknown>, calls: 0 };
  const config = loadRuntimeConfig({ LANGGRAPH_API_URL: 'http://127.0.0.1:2400', RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace', ...(opts.pinnedSlug === undefined ? {} : { RAPTIX_RUNTIME_WORKSPACE_SLUG: opts.pinnedSlug }), ...(opts.perProjectSandbox ? { RAPTIX_SANDBOX_PER_PROJECT: '1' } : {}) })!;
  const planning = { version: 1, engagementId: 'owned', documents: Object.fromEntries(['roe', 'conops', 'deconfliction', 'opplan'].map(n => [n, { state: 'missing' }])), bundle: Object.fromEntries(PLANNING_DOCUMENTS.map(n => [n, 'missing'])), readiness: { state: 'blocked', reasons: ['roe:missing'], runtimeSignal: 'not_observed' } } as PlanningView;
  const service = new RuntimeContextService({ config, workspaceRoot: root,
    projects: { async getProject(user, id) { if (user !== 'local' || id !== project.id) throw new ProjectNotFoundError(); return project; }, async getPlanning() { return planning; } },
    ownership: { async getBinding(user, id, thread, expected) { if (user !== 'local' || id !== 'owned' || thread !== 'thread') throw new ProjectNotFoundError(); if (expected?.runtimeConfigHash && expected.runtimeConfigHash !== control.proof) throw Object.assign(new Error('Persisted proof mismatch'), { statusCode: 409 }); return bound; }, async prepareBinding() { return requestFingerprint({ engagementId: project.id, workspaceSlug: project.workspaceSlug, targetType: project.targetType, targetValue: project.targetValue, authorizationConfirmed: project.authorizationConfirmed, assistantId: bound.assistantId, kind: bound.kind }); } },
    runtime: { async instanceExchange() { throw new Error('not used in this test'); }, async catalog() { control.calls++; return control.graphs; }, async thread() { return { thread_id: 'thread', metadata: control.metadata }; }, async state() { return { values: control.values, graphId: control.stateGraph ?? bound.assistantId }; } },
  });
  return { root, project, bound, control, config, service };
}
it('resolves the five CLI configurable fields from persisted metadata and trusted POSIX mapping', async () => {
  const { service } = await setup({ pinnedSlug: 'parity-project' });
  const context = await service.resolve('local', 'owned', { kind: 'planning' });
  const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/w06/cli-context.json', import.meta.url), 'utf8'));
  const cli = readFileSync(new URL('../../../cli/src/hooks/useAgent.ts', import.meta.url), 'utf8');
  // ADR-0092: the CLI no longer builds these fields. The control plane supplies them from persisted metadata, so the
  // parity guard now asserts the opposite: no pinned engagement or client-built configurable block in the CLI.
  expect(cli).not.toContain('RAPTIX_ENGAGEMENT');
  expect(cli).not.toContain('const configurable: Record<string, unknown> = {};');
  expect(context.configurable).toEqual(fixture.configurable);
  expect(context.configurable).toEqual(fixture.hydration.fresh);
  expect(fixture.hydration.existingUpdates).toBeNull();
  expect(context.assistantId).toBe('soundwave'); expect(context.publicView.executionReady).toBe(false);
  expect(JSON.stringify(context.publicView)).not.toContain('/workspace');
});
it('routes a project run to its own sandbox host when per-project sandboxes are enabled (ADR-0086 A)', async () => {
  const { service } = await setup({ perProjectSandbox: true });
  const context = await service.resolve('local', 'owned', { kind: 'planning' });
  expect(context.configurable.sandbox_url).toBe('http://sbx-parity-project:9999');
  expect(context.configurable.workspace_path).toBe('/workspace/parity-project');
});
it('refuses a run whose slug cannot name a per-project sandbox host instead of falling back to a shared sandbox', async () => {
  const { service, project } = await setup({ perProjectSandbox: true });
  project.workspaceSlug = 'a'.repeat(60);
  await expect(service.resolve('local', 'owned', { kind: 'planning' })).rejects.toMatchObject({ statusCode: 409 });
});
it('does not contact runtime for another owner or privileged browser overrides', async () => {
  const { service, control } = await setup();
  await expect(service.resolve('foreign', 'owned', { kind: 'planning' })).rejects.toMatchObject({ statusCode: 404 });
  for (const key of ['workspace_path', 'configurable', 'authorization_confirmed', 'sandbox_url', 'kg_engagement', 'model_override']) await expect(service.resolve('local', 'owned', { kind: 'planning', [key]: 'forged' })).rejects.toMatchObject({ code: 'bad_request' });
  expect(control.calls).toBe(0);
  await expect(service.resolve('local', 'owned', { kind: ['planning'] })).rejects.toMatchObject({ code: 'bad_request' });
});
it('selects only actually discovered allowlisted assistants and refuses implicit assistant switches', async () => {
  const { service, control, bound } = await setup();
  bound.kind = 'execution'; bound.assistantId = 'decepticon';
  expect((await service.resolve('local', 'owned', { kind: 'execution' })).assistantId).toBe('decepticon');
  await expect(service.resolve('local', 'owned', { kind: 'execution', assistantId: 'raptix' })).rejects.toMatchObject({ statusCode: 503 });
  await expect(service.resolve('local', 'owned', { kind: 'execution', assistantId: 'recon' })).rejects.toMatchObject({ statusCode: 503 });
  await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ code: 'conflict' });
  control.graphs = [];
  await expect(service.resolve('local', 'owned', { kind: 'execution' })).rejects.toMatchObject({ statusCode: 503 });
});
it('preserves an explicitly selected orchestrator and validates immutable full runtime context proof', async () => {
  const { service, control, bound } = await setup();
  bound.kind = 'execution'; bound.assistantId = 'vulnresearch';
  const context = await service.resolve('local', 'owned', { kind: 'execution', assistantId: 'vulnresearch' });
  control.proof = context.runtimeConfigHash; control.metadata = context.metadata;
  control.values = context.configurable;
  expect((await service.resolve('local', 'owned', { kind: 'execution', threadId: 'thread' })).assistantId).toBe('vulnresearch');
  await expect(service.resolve('local', 'owned', { kind: 'execution', threadId: 'thread', assistantId: 'decepticon' })).rejects.toMatchObject({ code: 'conflict' });
});
it('rejects remote metadata and every mismatched or partially hydrated engagement field', async () => {
  const { service, control } = await setup();
  const context = await service.resolve('local', 'owned', { kind: 'planning' });
  control.proof = context.runtimeConfigHash; control.metadata = { ...context.metadata };
  expect((await service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).publicView.threadVerified).toBe(true);
  control.metadata.engagement_id = 'different';
  await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ code: 'conflict' });
  control.metadata = context.metadata;
  for (const field of Object.keys(context.configurable)) {
    control.values = { ...context.configurable, [field]: 'wrong' };
    await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ code: 'conflict' });
  }
  control.values = { messages: [] };
  await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ code: 'conflict' });
  control.values = { ...context.configurable, kg_engagement: 'foreign-partition' };
  await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ code: 'conflict' });
  control.values = context.configurable; control.stateGraph = 'decepticon';
  await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ code: 'conflict' });
});
it('requires a new owned thread when topology/language proof changes and refuses the wrong pinned engagement', async () => {
  const { service, control, config } = await setup();
  const context = await service.resolve('local', 'owned', { kind: 'planning' });
  control.proof = context.runtimeConfigHash; control.metadata = context.metadata;
  config.language = 'vi';
  await expect(service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).rejects.toMatchObject({ statusCode: 409 });
  config.pinnedSlug = 'other-project';
  await expect(service.resolve('local', 'owned', { kind: 'planning' })).rejects.toMatchObject({ code: 'conflict' });
  config.pinnedSlug = 'parity-project';
  expect((await service.resolve('local', 'owned', { kind: 'planning' })).configurable.workspace_path).toBe('/workspace/parity-project');
});
it('accepts observed runtime reserved-key filtering and empty optional checkpoint defaults', async () => {
  const { service, control } = await setup();
  const context = await service.resolve('local', 'owned', { kind: 'planning' });
  control.proof = context.runtimeConfigHash;
  control.metadata = { ...context.metadata, ui_assistant_id: 'soundwave', graph_id: 'soundwave' };
  delete control.metadata.assistant_id;
  control.values = { ...context.configurable, kg_engagement: '', language: '' };
  expect((await service.resolve('local', 'owned', { kind: 'planning', threadId: 'thread' })).publicView.threadVerified).toBe(true);
});
it('rejects same-root cross-project workspace junctions before emitting runtime configuration', async () => {
  const { service, root } = await setup();
  await rm(path.join(root, 'parity-project'), { recursive: true });
  await mkdir(path.join(root, 'other-project')); await symlink(path.join(root, 'other-project'), path.join(root, 'parity-project'), 'junction');
  await expect(service.resolve('local', 'owned', { kind: 'planning' })).rejects.toMatchObject({ code: 'conflict' });
});
it('validates explicit runtime configuration and never infers runtime paths from Windows paths', () => {
  expect(loadRuntimeConfig({})).toBeUndefined();
  for (const root of ['C:\\workspace', '/workspace/../other', '/workspace//other', '/workspace/']) expect(() => loadRuntimeConfig({ LANGGRAPH_API_URL: 'http://localhost:2400', RAPTIX_RUNTIME_WORKSPACE_ROOT: root })).toThrow();
  for (const api of ['http://user:password@localhost:2400', 'file:///workspace', 'http://localhost:2400?token=secret']) expect(() => loadRuntimeConfig({ LANGGRAPH_API_URL: api, RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' })).toThrow();
  expect(() => loadRuntimeConfig({ RAPTIX_RUNTIME_WORKSPACE_ROOT: '/workspace' })).toThrow();
});
