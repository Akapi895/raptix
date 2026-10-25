import { mkdtemp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isFindingsView, isArtifactsView, isArtifactContentView, isRetainedCaptureView, isRetainedCapturesView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerFindingsRoutes } from '../src/http/routes/findings.routes.js';
import { ArtifactsService } from '../src/services/artifacts-service.js';
import { LocalProjectFiles } from './support/local-project-files.js';
import { FindingsService, parseFindingMarkdown } from '../src/services/findings-service.js';
import { ProjectNotFoundError } from '../src/services/projects-service.js';

const FINDING_MD = `# Exposed .env File with Plaintext Credentials

Severity: critical
CVSS score: 9.1
CVSS vector: AV:N/AC:L/PR:N/UI:N

## Description
The application root exposes a \`.env\` file via HTTP.
Plaintext database credentials are readable.

## Evidence
- GET /.env returned 200 with DB_PASSWORD

## Attack Vector
Unauthenticated HTTP GET.

## Affected Assets
- api.acme.com/.env
- 10.0.1.45:8080

## CWE
CWE-312, CWE-200

## Mitre ATT&CK
T1552.001 T1003

## Remediation
Rotate credentials; block .env access.
`;

interface Harness { app: FastifyInstance; artifacts: ArtifactsService; workspaceRoot: string; slug: string }

async function buildHarness(): Promise<Harness> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'w12-'));
  const slug = `w12-proj-${Date.now().toString(36)}`;
  const captures = new Map<string, Record<string, unknown>>();
  let auditId = 0;
  const db = {
    engagementClosure: { findFirst: async () => null },
    retainedCapture: {
      findFirst: async ({ where }: { where: { id?: string; engagementId: string; path?: string } }) => [...captures.values()].find((row) => row.engagementId === where.engagementId && (where.id === undefined || row.id === where.id) && (where.path === undefined || row.path === where.path)) ?? null,
      findUnique: async ({ where }: { where: { engagementId_requestId?: { engagementId: string; requestId: string } } }) => [...captures.values()].find((row) => row.engagementId === where.engagementId_requestId?.engagementId && row.requestId === where.engagementId_requestId?.requestId) ?? null,
      findMany: async ({ where }: { where: { engagementId: string } }) => [...captures.values()].filter((row) => row.engagementId === where.engagementId).map((row) => ({ ...row })),
      create: async ({ data }: { data: Record<string, unknown> }) => { const row: Record<string, unknown> = { classifiedBy: null, classificationReason: null, producer: null, ...data, createdAt: new Date(), classifiedAt: null }; captures.set(String(row.id), row); return { ...row }; },
      updateMany: async ({ where, data }: { where: { id: string; engagementId: string; classificationVersion: number }; data: Record<string, unknown> }) => {
        const row = captures.get(where.id);
        if (!row || row.engagementId !== where.engagementId || row.classificationVersion !== where.classificationVersion) return { count: 0 };
        const increment = (data.classificationVersion as { increment: number }).increment;
        captures.set(where.id, { ...row, ...data, classificationVersion: Number(row.classificationVersion) + increment });
        return { count: 1 };
      },
    },
    webAuditEntry: { create: async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: `audit-${++auditId}` }) },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId?: string } }) =>
        where.id === 'eng-1' && (where.userId === undefined || where.userId === 'local') ? { id: 'eng-1', name: slug, workspaceSlug: slug, userId: 'local' } : null,
    },
    webMembership: {
      findFirst: async ({ where }: { where: { engagementId: string; userId: string } }) =>
        where.engagementId === 'eng-1' && ['viewer', 'operator', 'reviewer'].includes(where.userId) ? { engagementId: 'eng-1', userId: where.userId, role: where.userId } : null,
    },
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const artifacts = new ArtifactsService(db as never, new LocalProjectFiles(workspaceRoot));
  registerFindingsRoutes(app, new FindingsService(db as never, new LocalProjectFiles(workspaceRoot)), artifacts, { id: 'local', mode: 'local-single-user' });
  await app.ready();
  return { app, artifacts, workspaceRoot, slug };
}

const harnesses: Harness[] = [];
const withHarness = async (run: (h: Harness) => Promise<void>): Promise<void> => {
  const harness = await buildHarness();
  harnesses.push(harness);
  try { await run(harness); } finally { await harness.app.close(); }
};

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await rm(harness.workspaceRoot, { recursive: true, force: true });
});

describe('W12 findings projection', () => {
  it('W01: resolves workspace contents by the global workspace slug, not the owner name', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'w12-slug-'));
    harnesses.push({ app: { close: async () => undefined } as unknown as FastifyInstance, artifacts: new ArtifactsService({} as never, new LocalProjectFiles(workspaceRoot)), workspaceRoot, slug: 'dup-name' });
    const slugDir = `dup-name-${Date.now().toString(36)}`;
    const db = {
      engagement: {
        findFirst: async ({ where }: { where: { id: string; userId?: string } }) =>
          where.id === 'eng-1' ? { id: 'eng-1', name: 'dup-name', workspaceSlug: slugDir, userId: 'local' } : null,
      },
    };
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerFindingsRoutes(app, new FindingsService(db as never, new LocalProjectFiles(workspaceRoot)), new ArtifactsService(db as never, new LocalProjectFiles(workspaceRoot)), { id: 'local', mode: 'local-single-user' });
    await app.ready();
    try {
      await mkdir(path.join(workspaceRoot, slugDir, 'findings'), { recursive: true });
      await writeFile(path.join(workspaceRoot, slugDir, 'findings', 'FIND-2026-009.md'), FINDING_MD, 'utf8');
      await mkdir(path.join(workspaceRoot, 'dup-name', 'findings'), { recursive: true });
      const response = await app.inject({ method: 'GET', url: '/api/engagements/eng-1/findings' });
      expect(response.statusCode).toBe(200);
      const view = response.json();
      expect(view.findings).toHaveLength(1);
      expect(view.findings[0]).toMatchObject({ id: 'FIND-2026-009' });
    } finally { await app.close(); }
  });
  it('parses FIND-*.md into public views with quality flags and bounded raw source', async () => {
    await withHarness(async (h) => {
      const dir = path.join(h.workspaceRoot, h.slug, 'findings');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'FIND-2026-001.md'), FINDING_MD, 'utf8');
      await writeFile(path.join(dir, 'IGNORED.txt'), 'not a finding', 'utf8');
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/findings' });
      expect(response.statusCode).toBe(200);
      const view = response.json();
      expect(isFindingsView(view)).toBe(true);
      expect(view.findings).toHaveLength(1);
      const finding = view.findings[0];
      expect(finding).toMatchObject({ id: 'FIND-2026-001', severity: 'critical', cvssScore: 9.1, cwe: ['CWE-312', 'CWE-200'], mitre: ['T1552.001', 'T1003'] });
      expect(finding.affectedAssets).toEqual(['api.acme.com/.env', '10.0.1.45:8080']);
      expect(finding.quality).toEqual({ defaultSeverity: false, placeholderDescription: false, placeholderEvidence: false, unreadable: false });
      expect(finding.rawSource).toContain('# Exposed .env');
      expect(view.truncated).toBe(false);
    });
  });
  it('flags parser defaults and keeps malformed findings viewable via raw source', () => {
    const bare = parseFindingMarkdown('just some text, no structure', 'FIND-2026-002.md', 'eng-1', 27);
    expect(bare.severity).toBe('medium');
    expect(bare.quality).toMatchObject({ defaultSeverity: true, placeholderDescription: true, placeholderEvidence: true });
    expect(bare.description).toBe('No description available.');
    expect(bare.rawSource).toBe('just some text, no structure');
    const informational = parseFindingMarkdown('severity: informational\n## Description\nLow risk', 'FIND-2026-003.md', 'eng-1', 40);
    expect(informational.severity).toBe('informational');
    expect(informational.quality.defaultSeverity).toBe(false);
  });
  it('is engagement-scoped, tolerant of a missing findings dir, and reports truncation for oversized files', async () => {
    await withHarness(async (h) => {
      const dir = path.join(h.workspaceRoot, h.slug, 'findings');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'FIND-2026-BIG.md'), 'x'.repeat(300 * 1024), 'utf8');
      const view = (await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/findings' })).json();
      expect(view.findings).toHaveLength(0);
      expect(view.truncated).toBe(true);
    });
    await withHarness(async (h) => {
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/findings' })).json().findings).toEqual([]);
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-other/findings' })).statusCode).toBe(404);
      const service = new FindingsService({ engagement: { findFirst: async () => null } } as never, new LocalProjectFiles(h.workspaceRoot));
      await expect(service.list('local', 'eng-1')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });
});

describe('W12 artifact browser', () => {
  it('retains uploads as unclassified, blocks original bytes, then serves classified bytes with a verified digest', async () => {
    await withHarness(async (h) => {
      const bytes = Buffer.from([0x00, 0xff, 0x41, 0x42]);
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/engagements/eng-1/artifacts/captures',
        payload: { requestId: 'upload-1', filename: 'capture.bin', base64: bytes.toString('base64'), mediaType: 'application/octet-stream' },
      });
      expect(response.statusCode).toBe(200);
      const uploaded = response.json();
      expect(uploaded).toMatchObject({ classification: 'unclassified', sizeBytes: bytes.length, filename: 'capture.bin' });
      expect(isRetainedCaptureView(uploaded), JSON.stringify(uploaded)).toBe(true);
      const id = uploaded.id as string;
      const replay = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/artifacts/captures', payload: { requestId: 'upload-1', filename: 'capture.bin', base64: bytes.toString('base64'), mediaType: 'application/octet-stream' } });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().id).toBe(id);
      const reused = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/artifacts/captures', payload: { requestId: 'upload-1', filename: 'other.bin', base64: Buffer.from('different').toString('base64'), mediaType: 'application/octet-stream' } });
      expect(reused.statusCode).toBe(409);

      const listed = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/captures' });
      expect(isRetainedCapturesView(listed.json())).toBe(true);
      expect(listed.json().captures.map((capture: { id: string }) => capture.id)).toEqual([id]);
      const operatorView = await h.artifacts.listCaptures('operator', 'eng-1');
      expect(operatorView.captures[0]).toMatchObject({ classification: 'unclassified', filename: null, canReadOriginal: false, canClassify: false });
      expect((await h.app.inject({ method: 'GET', url: `/api/engagements/eng-1/artifacts/captures/${id}/content` })).statusCode).toBe(409);

      const classified = await h.app.inject({
        method: 'PATCH', url: `/api/engagements/eng-1/artifacts/captures/${id}/classification`,
        payload: { classification: 'standard', expectedVersion: 1, reason: 'Approved lab capture for engagement members.' },
      });
      expect(classified.statusCode).toBe(200);
      expect(classified.json()).toMatchObject({ classification: 'standard', classificationVersion: 2 });
      const downloaded = await h.app.inject({ method: 'GET', url: `/api/engagements/eng-1/artifacts/captures/${id}/content` });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers['x-content-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(Buffer.from(downloaded.rawPayload)).toEqual(bytes);
    });
  });

  it('limits sensitive original bytes and classification decisions to owner/reviewer roles', async () => {
    await withHarness(async (h) => {
      const bytes = Buffer.from('sensitive operator note');
      const uploaded = await h.app.inject({
        method: 'POST', url: '/api/engagements/eng-1/artifacts/captures',
        payload: { requestId: 'upload-sensitive', filename: 'note.txt', base64: bytes.toString('base64'), mediaType: 'text/plain' },
      });
      const id = uploaded.json().id as string;
      await expect(h.artifacts.classifyCapture('operator', 'eng-1', id, { classification: 'sensitive', expectedVersion: 1, reason: 'Operator cannot classify.' })).rejects.toMatchObject({ statusCode: 403 });
      const classified = await h.app.inject({
        method: 'PATCH', url: `/api/engagements/eng-1/artifacts/captures/${id}/classification`,
        payload: { classification: 'sensitive', expectedVersion: 1, reason: 'Contains restricted account data.' },
      });
      expect(classified.statusCode).toBe(200);
      await expect(h.artifacts.downloadCapture('viewer', 'eng-1', id)).rejects.toMatchObject({ statusCode: 404 });
      await expect(h.artifacts.downloadCapture('operator', 'eng-1', id)).rejects.toMatchObject({ statusCode: 404 });
      await expect(h.artifacts.downloadCapture('reviewer', 'eng-1', id)).resolves.toMatchObject({ bytes });
      await expect(h.artifacts.downloadCapture('local', 'eng-1', id)).resolves.toMatchObject({ bytes });
    });
  });

  it('keeps original bytes from viewers whatever the classification, and refuses a tampered capture with a conflict', async () => {
    await withHarness(async (h) => {
      const bytes = Buffer.from('viewer check bytes');
      const uploaded = await h.app.inject({
        method: 'POST', url: '/api/engagements/eng-1/artifacts/captures',
        payload: { requestId: 'upload-viewer', filename: 'viewer.txt', base64: bytes.toString('base64'), mediaType: 'text/plain' },
      });
      const id = uploaded.json().id as string;
      const classified = await h.app.inject({
        method: 'PATCH', url: `/api/engagements/eng-1/artifacts/captures/${id}/classification`,
        payload: { classification: 'standard', expectedVersion: 1, reason: 'Standard lab capture for the viewer check.' },
      });
      expect(classified.statusCode).toBe(200);
      expect((await h.artifacts.listCaptures('viewer', 'eng-1')).captures[0]).toMatchObject({ canReadOriginal: false });
      expect((await h.artifacts.listCaptures('operator', 'eng-1')).captures[0]).toMatchObject({ canReadOriginal: true });
      await expect(h.artifacts.downloadCapture('viewer', 'eng-1', id)).rejects.toMatchObject({ statusCode: 403 });
      expect((await h.app.inject({ method: 'GET', url: `/api/engagements/eng-1/artifacts/captures/${id}/content` })).statusCode).toBe(200);
      await expect(h.artifacts.downloadCapture('operator', 'eng-1', id)).resolves.toMatchObject({ bytes });

      // Overwrite the retained file with same-length different bytes: the recorded digest no longer matches.
      const entries = await readdir(h.workspaceRoot, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(entry.parentPath, entry.name);
        if ((await readFile(file)).equals(bytes)) await writeFile(file, Buffer.from('X'.repeat(bytes.length)));
      }
      await expect(h.artifacts.downloadCapture('operator', 'eng-1', id)).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  it('refuses a retained capture whose file was removed from storage with an explicit conflict', async () => {
    await withHarness(async (h) => {
      const bytes = Buffer.from('removed from storage');
      const uploaded = await h.app.inject({
        method: 'POST', url: '/api/engagements/eng-1/artifacts/captures',
        payload: { requestId: 'upload-missing', filename: 'missing.txt', base64: bytes.toString('base64'), mediaType: 'text/plain' },
      });
      const id = uploaded.json().id as string;
      await h.app.inject({
        method: 'PATCH', url: `/api/engagements/eng-1/artifacts/captures/${id}/classification`,
        payload: { classification: 'standard', expectedVersion: 1, reason: 'Standard lab capture for the missing-file check.' },
      });
      const entries = await readdir(h.workspaceRoot, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(entry.parentPath, entry.name);
        if ((await readFile(file)).equals(bytes)) await rm(file);
      }
      await expect(h.artifacts.downloadCapture('operator', 'eng-1', id)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('missing from storage') });
      const response = await h.app.inject({ method: 'GET', url: `/api/engagements/eng-1/artifacts/captures/${id}/content` });
      expect(response.statusCode).toBe(409);
    });
  });

  it('refuses original bytes to a former member whose membership was removed', async () => {
    await withHarness(async (h) => {
      const bytes = Buffer.from('former member check');
      const uploaded = await h.app.inject({
        method: 'POST', url: '/api/engagements/eng-1/artifacts/captures',
        payload: { requestId: 'upload-former', filename: 'former.txt', base64: bytes.toString('base64'), mediaType: 'text/plain' },
      });
      const id = uploaded.json().id as string;
      await h.app.inject({
        method: 'PATCH', url: `/api/engagements/eng-1/artifacts/captures/${id}/classification`,
        payload: { classification: 'standard', expectedVersion: 1, reason: 'Standard lab capture for the membership check.' },
      });
      await expect(h.artifacts.downloadCapture('operator', 'eng-1', id)).resolves.toMatchObject({ bytes });
      await expect(h.artifacts.downloadCapture('former-member', 'eng-1', id)).rejects.toMatchObject({ statusCode: 404, message: 'Project not found' });
    });
  });

  it('lists allowlisted folders non-recursively with sizes and engagement scoping', async () => {
    await withHarness(async (h) => {
      const root = path.join(h.workspaceRoot, h.slug);
      await mkdir(path.join(root, 'recon', 'nested'), { recursive: true });
      await mkdir(path.join(root, 'report'), { recursive: true });
      await mkdir(path.join(root, 'plan'), { recursive: true });
      await mkdir(path.join(root, 'forbidden'), { recursive: true });
      await writeFile(path.join(root, 'recon', 'nmap.txt'), 'ports', 'utf8');
      await writeFile(path.join(root, 'recon', 'nested', 'deep.txt'), 'hidden', 'utf8');
      await writeFile(path.join(root, 'report', 'out.md'), '# report', 'utf8');
      await writeFile(path.join(root, 'plan', 'roe.json'), '{"engagement_name":"eng"}', 'utf8');
      await writeFile(path.join(root, 'forbidden', 'x.txt'), 'nope', 'utf8');
      const view = (await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts' })).json();
      expect(isArtifactsView(view)).toBe(true);
      // plan is allowlisted (planning documents) and listed first.
      expect(view.folders.map((f: { folder: string }) => f.folder)).toEqual(['plan', 'recon', 'report']);
      expect(view.folders[0].files).toEqual([{ name: 'roe.json', path: 'plan/roe.json', sizeBytes: 25 }]);
      expect(view.folders[1].files).toEqual([{ name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 5 }]);
      const planContent = (await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'plan/roe.json' } })).json();
      expect(isArtifactContentView(planContent)).toBe(true);
      expect(planContent).toMatchObject({ path: 'plan/roe.json', mediaType: 'json', truncated: false });
    });
  });
  it('serves text/JSON content with media type and rejects traversal and binary', async () => {
    await withHarness(async (h) => {
      const root = path.join(h.workspaceRoot, h.slug);
      await mkdir(path.join(root, 'exploit'), { recursive: true });
      await writeFile(path.join(root, 'exploit', 'result.json'), '{"status":"ok"}', 'utf8');
      const content = (await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'exploit/result.json' } })).json();
      expect(isArtifactContentView(content)).toBe(true);
      expect(content).toMatchObject({ path: 'exploit/result.json', mediaType: 'json', sizeBytes: 15, truncated: false });
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'exploit/../../secrets.txt' } })).statusCode).toBe(400);
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'private/keys.txt' } })).statusCode).toBe(400);
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'exploit/missing.txt' } })).statusCode).toBe(404);
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content' })).statusCode).toBe(400);
      await writeFile(path.join(root, 'exploit', 'payload.bin'), Buffer.from([0x00, 0xff, 0xfe]));
      const binary = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'exploit/payload.bin' } });
      // W19: binary stays explicit — an unavailable text view, never a fake decode or a 500.
      expect(binary.statusCode).toBe(503);
      expect(binary.json().error.message).toMatch(/utf-8/i);
    });
  });
  it('truncates oversized content truthfully and scopes content by engagement', async () => {
    await withHarness(async (h) => {
      const root = path.join(h.workspaceRoot, h.slug);
      await mkdir(path.join(root, 'recon'), { recursive: true });
      await writeFile(path.join(root, 'recon', 'big.txt'), 'a'.repeat(300 * 1024), 'utf8');
      const content = (await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'recon/big.txt' } })).json();
      expect(content.truncated).toBe(true);
      expect(content.sizeBytes).toBe(300 * 1024);
      expect(content.content).toHaveLength(256 * 1024);
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-other/artifacts/content', query: { path: 'recon/big.txt' } })).statusCode).toBe(404);
    });
  });
  it('W19: decodes a truncated multibyte tail safely without replacement characters or a 500', async () => {
    await withHarness(async (h) => {
      const root = path.join(h.workspaceRoot, h.slug);
      await mkdir(path.join(root, 'recon'), { recursive: true });
      // '€' is 3 bytes in UTF-8: 262144 % 3 !== 0, so the retained slice splits a codepoint.
      await writeFile(path.join(root, 'recon', 'euro.txt'), '€'.repeat(100_000), 'utf8');
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'recon/euro.txt' } });
      expect(response.statusCode).toBe(200);
      const content = response.json();
      expect(content.mediaType).toBe('text');
      expect(content.truncated).toBe(true);
      expect(content.content.length).toBeGreaterThan(87_000);
      expect(content.content.endsWith('€')).toBe(true);
      expect(content.content.includes('\uFFFD')).toBe(false);
    });
  });
});

describe('workspace evidence import', () => {
  it('imports the evidence an agent wrote as unclassified captures, idempotently, and keeps its bytes locked', async () => {
    await withHarness(async (h) => {
      const evidence = path.join(h.workspaceRoot, h.slug, 'findings', 'evidence');
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, 'FIND-001_rce.txt'), 'uid=0(root)\n', 'utf8');
      await writeFile(path.join(evidence, 'FIND-002_dump.exe'), 'MZ', 'utf8');

      const first = await h.artifacts.importWorkspaceEvidence('local', 'eng-1');
      expect(first.captures).toHaveLength(1);
      expect(first.captures[0]).toMatchObject({ classification: 'unclassified', filename: 'FIND-001_rce.txt', sizeBytes: 12, canReadOriginal: false });
      expect(isRetainedCaptureView(first.captures[0]), JSON.stringify(first.captures[0])).toBe(true);
      expect(first.skipped).toEqual([{ path: 'findings/evidence/FIND-002_dump.exe', reason: 'unsupported file type' }]);

      const replay = await h.artifacts.importWorkspaceEvidence('local', 'eng-1');
      expect(replay.captures.map((capture) => capture.id)).toEqual([first.captures[0]!.id]);

      const viaRoute = await h.app.inject({ method: 'POST', url: '/api/engagements/eng-1/artifacts/workspace-evidence/import' });
      expect(viaRoute.statusCode).toBe(200);
      expect(viaRoute.json().captures.map((capture: { id: string }) => capture.id)).toEqual([first.captures[0]!.id]);

      const blocked = await h.app.inject({ method: 'GET', url: `/api/engagements/eng-1/artifacts/captures/${first.captures[0]!.id}/content` });
      expect(blocked.statusCode).toBe(409);

      await writeFile(path.join(evidence, 'FIND-001_rce.txt'), 'changed\n', 'utf8');
      const changed = await h.artifacts.importWorkspaceEvidence('local', 'eng-1');
      expect(changed.captures).toHaveLength(1);
      expect(changed.captures[0]!.id).not.toBe(first.captures[0]!.id);
      expect(changed.captures[0]!.digest).not.toBe(first.captures[0]!.digest);
      expect(changed.skipped).toEqual([{ path: 'findings/evidence/FIND-002_dump.exe', reason: 'unsupported file type' }]);
      const listed = await h.artifacts.listCaptures('local', 'eng-1');
      expect(listed.captures.filter((capture) => capture.producer === 'workspace:findings/evidence/FIND-001_rce.txt').map((capture) => capture.id).sort())
        .toEqual([first.captures[0]!.id, changed.captures[0]!.id].sort());
    });
  });

  it('imports XML and JSONL evidence as the bytes they were written with, and a download matches that version digest', async () => {
    await withHarness(async (h) => {
      const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
      const evidence = path.join(h.workspaceRoot, h.slug, 'findings', 'evidence');
      await mkdir(evidence, { recursive: true });
      const nmap = '<?xml version="1.0"?>\n<nmaprun scanner="nmap"/>\n';
      const crawl = '{"endpoint":"http://app.example.com:80/"}\n{"endpoint":"http://app.example.com:80/login"}\n';
      await writeFile(path.join(evidence, 'nmap-juice.xml'), nmap, 'utf8');
      await writeFile(path.join(evidence, 'crawl-juice.jsonl'), crawl, 'utf8');

      const imported = await h.artifacts.importWorkspaceEvidence('local', 'eng-1');
      expect(imported.skipped).toEqual([]);
      const byName = new Map(imported.captures.map((capture) => [capture.filename, capture]));
      expect(byName.get('nmap-juice.xml')).toMatchObject({ mediaType: 'application/xml', classification: 'unclassified', digest: sha256(nmap) });
      expect(byName.get('crawl-juice.jsonl')).toMatchObject({ mediaType: 'application/x-ndjson', digest: sha256(crawl) });

      const xml = byName.get('nmap-juice.xml')!;
      await h.artifacts.classifyCapture('local', 'eng-1', xml.id, { classification: 'standard', expectedVersion: 1, reason: 'Lab scan output for the asset map.' });
      const download = await h.artifacts.downloadCapture('local', 'eng-1', xml.id);
      expect(download.bytes.toString('utf8')).toBe(nmap);
      expect(sha256(download.bytes.toString('utf8'))).toBe(xml.digest);
    });
  });

  it('imports only the evidence of the given producer, and refuses viewers', async () => {
    await withHarness(async (h) => {
      const evidence = path.join(h.workspaceRoot, h.slug, 'findings', 'evidence');
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, 'FIND-001_rce.txt'), 'one', 'utf8');
      await writeFile(path.join(evidence, 'FIND-002_other.txt'), 'two', 'utf8');
      const scoped = await h.artifacts.importWorkspaceEvidence('local', 'eng-1', 'FIND-002');
      expect(scoped.captures.map((capture) => capture.filename)).toEqual(['FIND-002_other.txt']);
      await expect(h.artifacts.importWorkspaceEvidence('viewer', 'eng-1')).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  it('does not open evidence files through the generic artifact path, so the capture gate still applies', async () => {
    await withHarness(async (h) => {
      const evidence = path.join(h.workspaceRoot, h.slug, 'findings', 'evidence');
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, 'FIND-001_rce.txt'), 'secret', 'utf8');
      await expect(h.artifacts.content('local', 'eng-1', 'findings/evidence/FIND-001_rce.txt')).rejects.toMatchObject({ message: 'Invalid artifact path' });
    });
  });
});
