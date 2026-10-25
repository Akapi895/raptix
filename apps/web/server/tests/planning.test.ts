import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildApp } from '../src/app.js';
import { ProjectsService, type ProjectRepositoryPort, type ProjectRecord } from '../src/services/projects-service.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { isPlanningView } from '@raptix/web-contracts';

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function setup() {
  root = await mkdtemp(path.join(tmpdir(), 'raptix-w04-'));
  await mkdir(path.join(root, 'test-project', 'plan'), { recursive: true });
  const record: ProjectRecord = { id: 'owned', name: 'test-project', workspaceSlug: 'test-project', displayName: null, targetType: 'web_url', targetValue: 'http://authorized.invalid', authorizationConfirmed: true, status: 'draft', userId: 'local', threadId: null, createdAt: new Date(), updatedAt: new Date() };
  const repository: ProjectRepositoryPort = {
    async list() { return [record]; },
    async findById(owner, id) { return owner === record.userId && id === record.id ? record : null; },
    async allocateWorkspaceSlug() { throw new Error('Read-only test'); },
    async create() { throw new Error('Read-only test'); }, async update() { throw new Error('Read-only test'); },
  };
  const app = await buildApp({ projectsService: new ProjectsService({ repository, files: new LocalProjectFiles(root), identity: { id: 'local', mode: 'local-single-user' }, sandboxes: recordingSandboxes() }) });
  return { app, record, plan: path.join(root, 'test-project', 'plan') };
}

it('serves all missing planning states through the owned new API and hides other owners', async () => {
  const { app, record } = await setup();
  try {
    const response = await app.inject('/api/engagements/owned/plan-docs');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(isPlanningView(response.json())).toBe(true);
    expect(response.json().documents.roe).toEqual({ state: 'missing' });
    expect(response.json().readiness.state).toBe('blocked');
    expect((await app.inject('/api/engagements/other/plan-docs')).statusCode).toBe(404);
    expect((await app.inject('/api/engagements/owned/opplan')).json()).toEqual({ state: 'missing' });
    Object.assign(record, { userId: 'other-owner' });
    expect((await app.inject('/api/engagements/owned/plan-docs')).statusCode).toBe(404);
  } finally { await app.close(); }
});

it('distinguishes malformed, schema-invalid and valid docs without returning unknown keys or deconfliction secrets', async () => {
  const { app, plan } = await setup();
  await writeFile(path.join(plan, 'roe.json'), '{');
  await writeFile(path.join(plan, 'conops.json'), JSON.stringify({ engagement_name: 'Test', executive_summary: 42 }));
  await writeFile(path.join(plan, 'deconfliction.json'), JSON.stringify({ engagement_name: 'Test', deconfliction_code: 'SECRET', userId: 'private', identifiers: [{ type: 'source-ip', value: '192.0.2.1' }] }));
  try {
    const response = await app.inject('/api/engagements/owned/plan-docs');
    expect(response.statusCode).toBe(200);
    expect(isPlanningView(response.json())).toBe(true);
    expect(response.json().documents.roe.state).toBe('invalid');
    expect(response.json().documents.conops.state).toBe('invalid');
    expect(response.json().documents.deconfliction.state).toBe('ready');
    expect(response.body).not.toContain('SECRET'); expect(response.body).not.toContain('private');
    expect(response.body).not.toContain(root);
  } finally { await app.close(); }
});

it('matches the eight-document handoff policy without requiring OPPLAN and blocks wrong target, name or authorization', async () => {
  const { app, plan, record } = await setup();
  const roe = { engagement_name: 'Test', client: 'Client', start_date: '2026-10-01', end_date: '2026-10-31', engagement_type: 'external', testing_window: '09:00-17:00 UTC', authorization_reference: 'test-contract', in_scope: [{ target: record.targetValue, type: 'web-url' }] };
  const bundle = { roe, conops: { engagement_name: 'Test', executive_summary: 'Authorized test' }, deconfliction: { engagement_name: 'Test' }, 'threat-profile': { engagement_name: 'Test', actor_name: 'Test', tier: 'tier-1', sophistication: 'low', motivation: 'testing' }, contact: { engagement_name: 'Test', primary_operator: { name: 'Operator', role: 'Owner', channel: 'local' } }, 'data-handling': { engagement_name: 'Test' }, abort: { engagement_name: 'Test' }, cleanup: { engagement_name: 'Test' } };
  for (const [name, doc] of Object.entries(bundle)) await writeFile(path.join(plan, `${name}.json`), JSON.stringify(doc));
  try {
    const response = await app.inject('/api/engagements/owned/plan-docs');
    expect(response.statusCode).toBe(200); expect(response.json().readiness.state).toBe('ready');
    expect(response.json().bundle.opplan).toBe('missing');
    expect(await readFile(path.join(plan, 'roe.json'), 'utf8')).toBe(JSON.stringify(roe));
    const { in_scope: omittedScope, ...withoutScope } = roe;
    expect(omittedScope).toHaveLength(1);
    await writeFile(path.join(plan, 'roe.json'), JSON.stringify(withoutScope));
    const noScope = await app.inject('/api/engagements/owned/plan-docs');
    expect(noScope.statusCode).toBe(200);
    expect(noScope.json().readiness.reasons).toContain('target_not_in_scope');
    await writeFile(path.join(plan, 'roe.json'), JSON.stringify({ ...roe, in_scope: [] }));
    expect((await app.inject('/api/engagements/owned/plan-docs')).json().readiness.reasons).toContain('target_not_in_scope');
    await writeFile(path.join(plan, 'roe.json'), JSON.stringify({ ...roe, engagement_name: 'Other' }));
    expect((await app.inject('/api/engagements/owned/plan-docs')).json().readiness.reasons).toContain('engagement_name_mismatch');
    await writeFile(path.join(plan, 'roe.json'), JSON.stringify(roe));
    Object.assign(record, { authorizationConfirmed: false });
    expect((await app.inject('/api/engagements/owned/plan-docs')).json().readiness.reasons).toContain('authorization_not_confirmed');
    await writeFile(path.join(plan, 'abort.json'), JSON.stringify({ engagement_name: 'Test', hallucination_threshold: 0 }));
    expect((await app.inject('/api/engagements/owned/plan-docs')).json().bundle.abort).toBe('invalid');
  } finally { await app.close(); }
});

it('bounds oversized and non-regular documents without modifying them', async () => {
  const { app, plan } = await setup();
  try {
    await rm(plan, { recursive: true }); await mkdir(plan);
    await writeFile(path.join(plan, 'roe.json'), ' '.repeat(1024 * 1024 + 1));
    await mkdir(path.join(plan, 'conops.json'));
    const bounded = (await app.inject('/api/engagements/owned/plan-docs')).json();
    expect(bounded.bundle.roe).toBe('invalid'); expect(bounded.bundle.conops).toBe('unavailable');
    expect(await readFile(path.join(plan, 'roe.json'), 'utf8')).toHaveLength(1024 * 1024 + 1);
  } finally { await app.close(); }
});
