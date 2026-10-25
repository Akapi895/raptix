import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ProjectsService, type ProjectRepositoryPort, type ProjectRecord } from '../src/services/projects-service.js';
import { recordingSandboxes } from './support/project-sandboxes.js';
import { LocalProjectFiles } from './support/local-project-files.js';

/**
 * ADR-0085: the planning handoff is refused until the required documents are
 * ready, and a confirmed handoff approves the scope roe.json plans.
 */

const TARGET = '10.129.227.140';
let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function setup(docs: Record<string, unknown> | null) {
  root = await mkdtemp(path.join(tmpdir(), 'raptix-adr0085-'));
  const plan = path.join(root, 'lab', 'plan');
  await mkdir(plan, { recursive: true });
  for (const [name, doc] of Object.entries(docs ?? {})) await writeFile(path.join(plan, `${name}.json`), JSON.stringify(doc));
  const record: ProjectRecord = { id: 'lab', name: 'lab', workspaceSlug: 'lab', displayName: null, targetType: 'ip_range', targetValue: TARGET, authorizationConfirmed: true, status: 'draft', userId: 'local', threadId: null, createdAt: new Date(), updatedAt: new Date() };
  const repository: ProjectRepositoryPort = {
    async list() { return [record]; },
    async findById(owner, id) { return owner === record.userId && id === record.id ? record : null; },
    async allocateWorkspaceSlug() { throw new Error('not used'); },
    async create() { throw new Error('not used'); },
    async update() { return { ...record, handoffConfirmedAt: new Date('2026-10-17T02:00:00.000Z') }; },
  };
  const confirmPlannerScope = vi.fn(async () => null);
  const service = new ProjectsService({ repository, files: new LocalProjectFiles(root), identity: { id: 'local', mode: 'local-single-user' }, sandboxes: recordingSandboxes(), confirmPlannerScope });
  return { service, confirmPlannerScope };
}

const NAME = 'Lab 10.129.227.140';
const READY_DOCS = {
  roe: { engagement_name: NAME, client: 'Authorized lab', start_date: '2026-10-20', end_date: '2026-10-31', engagement_type: 'external', testing_window: 'Mon-Fri 09:00-17:00 UTC', authorization_reference: 'LAB-AUTH', in_scope: [{ target: TARGET, type: 'ip-range', notes: 'lab host' }], escalation_contacts: [{ name: 'Lab SOC', role: 'soc', channel: 'email:soc@example.invalid' }], prohibited_actions: ['Denial of service'] },
  conops: { engagement_name: NAME, executive_summary: 'Assess the lab host.' },
  deconfliction: { engagement_name: NAME },
  'threat-profile': { engagement_name: NAME, actor_name: 'External attacker', tier: 'tier-2', sophistication: 'medium', motivation: 'lab exercise' },
  contact: { engagement_name: NAME, primary_operator: { name: 'Lab operator', role: 'Primary Operator', channel: 'email:op@example.invalid' } },
  'data-handling': { engagement_name: NAME },
  abort: { engagement_name: NAME },
  cleanup: { engagement_name: NAME },
};

describe('ADR-0085 planning handoff', () => {
  it('refuses the handoff while required planning documents are missing and approves nothing', async () => {
    const { service, confirmPlannerScope } = await setup({ roe: READY_DOCS.roe });
    await expect(service.patchProject(undefined, 'lab', { handoffConfirmed: true })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Planning is not ready for handoff') });
    expect(confirmPlannerScope).not.toHaveBeenCalled();
  });

  it('approves the scope roe.json plans when the handoff is confirmed on a ready bundle', async () => {
    const { service, confirmPlannerScope } = await setup(READY_DOCS);
    const view = await service.patchProject(undefined, 'lab', { handoffConfirmed: true });
    expect(view.handoffConfirmedAt).not.toBeNull();
    expect(confirmPlannerScope).toHaveBeenCalledWith('local', 'lab', {
      targets: [TARGET],
      startDate: '2026-10-20',
      endDate: '2026-10-31',
      contacts: ['Lab SOC (email:soc@example.invalid)'],
      restrictions: ['Denial of service'],
    });
  });

  it('refuses the handoff when the database-backed scope approval is not wired', async () => {
    const { service } = await setup(READY_DOCS);
    const unwired = new ProjectsService({ repository: (service as unknown as { repository: ProjectRepositoryPort }).repository, files: new LocalProjectFiles(root), identity: { id: 'local', mode: 'local-single-user' }, sandboxes: recordingSandboxes() });
    await expect(unwired.patchProject(undefined, 'lab', { handoffConfirmed: true })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('without the database') });
  });
});
