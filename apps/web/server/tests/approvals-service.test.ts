import { mkdtemp, readFile, rm, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerApprovalRoutes } from '../src/http/routes/approvals.routes.js';
import { ApprovalsService } from '../src/services/approvals-service.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';

const TIME = 1790925255.367;
const requestLine = (requestId: string, createdAt = TIME): string => JSON.stringify({
  kind: 'approval_request', request_id: requestId, engagement_name: 'w11-approvals', agent_name: 'decepticon',
  tool_name: 'impacket-secretsdump', tool_args_redacted: { user: 'CORP/svc_backup', password: '***REDACTED***' },
  matched_rule: { technique_tag: 'T1003', tool_pattern: null, timeout_seconds: 300, default_on_timeout: 'deny' },
  reason: 'OS Credential Dumping (T1003) requires operator approval.', created_at: createdAt, metadata: { thread_id: 'untrusted-producer-metadata' },
}) + '\n';

interface Harness { app: FastifyInstance; workspaceRoot: string; approvalsDir: string; write: (name: 'requests.jsonl' | 'decisions.jsonl', content: string) => Promise<void> }

async function buildHarness(): Promise<Harness> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'w11-approvals-'));
  await mkdir(path.join(workspaceRoot, 'w11-approvals', 'approvals'), { recursive: true });
  const approvalsDir = path.join(workspaceRoot, 'w11-approvals', 'approvals');
  const db = {
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === 'eng-1' && where.userId === 'local' ? { id: 'eng-1', name: 'w11-approvals', workspaceSlug: 'w11-approvals' } : null,
    },
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerApprovalRoutes(app, new ApprovalsService(db as never, new LocalProjectFiles(workspaceRoot)), { id: 'local', mode: 'local-single-user' });
  await app.ready();
  return {
    app,
    workspaceRoot,
    approvalsDir,
    write: async (name, content) => { await mkdir(approvalsDir, { recursive: true }); await writeFile(path.join(approvalsDir, name), content, 'utf8'); },
  };
}

const harnesses: Harness[] = [];
const withHarness = async (run: (h: Harness) => Promise<void>): Promise<void> => {
  const harness = await buildHarness();
  harnesses.push(harness);
  await run(harness);
  await harness.app.close();
};

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await rm(harness.workspaceRoot, { recursive: true, force: true });
});

describe('W11 file-backed approvals API', () => {
  it('lists pending approval requests newest-first as public views without producer metadata', async () => {
    await withHarness(async (h) => {
      await h.write('requests.jsonl', requestLine('req-old') + requestLine('req-new', TIME + 30) + 'not json\n' + requestLine('decided', TIME + 60));
      await h.write('decisions.jsonl', JSON.stringify({ kind: 'approval_decision', request_id: 'decided', action: 'allow', operator_note: '', redirect_args: null, decided_at: TIME + 61 }) + '\n');
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/approvals' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.source).toBe('workspace');
      expect(body.approvals.map((a: { requestId: string }) => a.requestId)).toEqual(['req-new', 'req-old']);
      const first = body.approvals[0];
      expect(first).toMatchObject({ engagementId: 'eng-1', agentName: 'decepticon', toolName: 'impacket-secretsdump', reason: 'OS Credential Dumping (T1003) requires operator approval.', createdAtSeconds: TIME + 30, source: 'workspace' });
      expect(first.matchedRule).toEqual({ techniqueTag: 'T1003', toolPattern: null, timeoutSeconds: 300, defaultOnTimeout: 'deny' });
      expect(first.toolArgsRedacted.password).toBe('***REDACTED***');
      expect(JSON.stringify(body)).not.toContain('untrusted-producer-metadata');
      expect(JSON.stringify(body)).not.toContain('decided');
    });
  });
  it('appends the exact producer decision record once and returns 409 for duplicate or unknown decisions', async () => {
    await withHarness(async (h) => {
      await h.write('requests.jsonl', requestLine('req-1'));
      const first = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-1', action: 'allow', operatorNote: 'Operator decision' } });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ ok: true, requestId: 'req-1', action: 'allow' });
      const duplicate = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-1', action: 'deny' } });
      expect(duplicate.statusCode).toBe(409);
      const unknown = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-missing', action: 'deny' } });
      expect(unknown.statusCode).toBe(404);
      const lines = (await readFile(path.join(h.approvalsDir, 'decisions.jsonl'), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual({ kind: 'approval_decision', request_id: 'req-1', action: 'allow', operator_note: 'Operator decision', redirect_args: null, decided_at: expect.any(Number) });
    });
  });
  it('serializes concurrent decisions so only one append wins the race', async () => {
    await withHarness(async (h) => {
      await h.write('requests.jsonl', requestLine('req-race'));
      const attempts = await Promise.all([
        h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-race', action: 'allow' } }),
        h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-race', action: 'deny', operatorNote: 'second' } }),
        h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-race', action: 'deny', operatorNote: 'third' } }),
      ]);
      expect(attempts.map(a => a.statusCode).sort()).toEqual([200, 409, 409]);
      const lines = (await readFile(path.join(h.approvalsDir, 'decisions.jsonl'), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
    });
  });
  it('rejects invalid bodies and stays engagement-scoped with slug containment', async () => {
    await withHarness(async (h) => {
      for (const payload of [{ requestId: 'req-1', action: 'redirect' }, { requestId: 'req-1' }, { requestId: 'req-1', action: 'allow', redirect_args: {} }, { action: 'allow' }]) {
        expect((await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload })).statusCode).toBe(400);
      }
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-other/approvals' })).statusCode).toBe(404);
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/approvals' })).json().approvals).toEqual([]);
      await expect((async () => {
        const service = new ApprovalsService({ engagement: { findFirst: async () => ({ id: 'eng-1', name: '../escape', workspaceSlug: '../escape' }) } } as never, new LocalProjectFiles(h.workspaceRoot));
        await service.list('local', 'eng-1');
      })()).rejects.toMatchObject({ code: 'bad_request' });
    });
  });
  it('tolerates oversized or missing files instead of failing the read', async () => {
    await withHarness(async (h) => {
      await appendFile(path.join(h.approvalsDir, 'requests.jsonl'), 'x'.repeat(64 * 1024 + 1) + '\n', 'utf8');
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/approvals' })).json().approvals).toEqual([]);
    });
    await withHarness(async (h) => {
      await rm(path.join(h.approvalsDir), { recursive: true, force: true });
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/approvals' })).json().approvals).toEqual([]);
      await h.write('requests.jsonl', requestLine('req-after-mkdir'));
      const decided = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/approvals', payload: { requestId: 'req-after-mkdir', action: 'deny' } });
      expect(decided.statusCode).toBe(200);
    });
    await withHarness(async (h) => {
      const service = new ApprovalsService({ engagement: { findFirst: async () => null } } as never, new LocalProjectFiles(h.workspaceRoot));
      await expect(service.list('local', 'eng-1')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });
});
