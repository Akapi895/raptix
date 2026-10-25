import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { SandboxProvisionError } from '../src/integrations/sandboxes/sandbox-controller-client.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { ProjectsService, type CreateProjectData, type ProjectRecord, type ProjectRepositoryPort } from '../src/services/projects-service.js';

/**
 * ADR-0086 A: a project exists only with its own sandbox. The sandbox is started before the row is persisted, so a
 * failed start leaves no project behind and returns 503.
 */

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const PAYLOAD = { name: 'acme-external-assessment', targetType: 'web_url', targetValue: 'http://authorized-local-target:3010', authorizationConfirmed: true, brief: 'Authorized local target; assess the web surface within scope.' };

function recordOf(data: CreateProjectData): ProjectRecord {
  return { id: data.workspaceSlug, name: data.name, workspaceSlug: data.workspaceSlug, displayName: null, targetType: data.targetType, targetValue: data.targetValue, authorizationConfirmed: data.authorizationConfirmed, status: 'draft', userId: 'local', threadId: null, createdAt: new Date(), updatedAt: new Date() };
}

function makeRepository(events: string[]) {
  const created: CreateProjectData[] = [];
  const repository: ProjectRepositoryPort = {
    async list() { return []; },
    async findById() { return null; },
    async allocateWorkspaceSlug(name) { return name; },
    async create(_userId, data) { events.push('row'); created.push(data); return recordOf(data); },
    async update() { return null; },
  };
  return { repository, created };
}

async function workspaceRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'raptix-sandbox-create-'));
  roots.push(root);
  return root;
}

it('starts the project sandbox for its own slug before the project row is persisted', async () => {
  const events: string[] = [];
  const { repository, created } = makeRepository(events);
  const service = new ProjectsService({
    repository,
    files: new LocalProjectFiles(await workspaceRoot()),
    identity: { id: 'local', mode: 'local-single-user' },
    sandboxes: { async ensure(slug) { events.push(`sandbox:${slug}`); } },
  });
  const project = await service.createProject('local', PAYLOAD);
  expect(events).toEqual(['sandbox:acme-external-assessment', 'row']);
  expect(created).toHaveLength(1);
  expect(project.workspaceSlug).toBe('acme-external-assessment');
});

it('returns 503 and persists no project when the sandbox cannot be started', async () => {
  const events: string[] = [];
  const { repository, created } = makeRepository(events);
  const service = new ProjectsService({
    repository,
    files: new LocalProjectFiles(await workspaceRoot()),
    identity: { id: 'local', mode: 'local-single-user' },
    sandboxes: { async ensure() { throw new SandboxProvisionError(); } },
  });
  await expect(service.createProject('local', PAYLOAD)).rejects.toMatchObject({ statusCode: 503 });
  expect(created).toHaveLength(0);
  expect(events).toEqual([]);
});

it('never creates a project directory on the API side; the sandbox owns its workspace', async () => {
  const root = await workspaceRoot();
  const { repository } = makeRepository([]);
  const service = new ProjectsService({
    repository,
    files: new LocalProjectFiles(root),
    identity: { id: 'local', mode: 'local-single-user' },
    sandboxes: recordingSandboxes(),
  });
  await service.createProject('local', PAYLOAD);
  await expect(stat(path.join(root, 'acme-external-assessment'))).rejects.toMatchObject({ code: 'ENOENT' });
});
