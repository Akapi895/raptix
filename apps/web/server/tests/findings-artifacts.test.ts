import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isFindingsView, isArtifactsView, isArtifactContentView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerFindingsRoutes } from '../src/http/routes/findings.routes.js';
import { ArtifactsService } from '../src/services/artifacts-service.js';
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

interface Harness { app: FastifyInstance; workspaceRoot: string; slug: string }

async function buildHarness(): Promise<Harness> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'w12-'));
  const slug = `w12-proj-${Date.now().toString(36)}`;
  const db = {
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === 'eng-1' && where.userId === 'local' ? { id: 'eng-1', name: slug } : null,
    },
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerFindingsRoutes(app, new FindingsService(db as never, workspaceRoot), new ArtifactsService(db as never, workspaceRoot), { id: 'local', mode: 'local-single-user' });
  await app.ready();
  return { app, workspaceRoot, slug };
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
      const service = new FindingsService({ engagement: { findFirst: async () => null } } as never, h.workspaceRoot);
      await expect(service.list('local', 'eng-1')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });
});

describe('W12 artifact browser', () => {
  it('lists allowlisted folders non-recursively with sizes and engagement scoping', async () => {
    await withHarness(async (h) => {
      const root = path.join(h.workspaceRoot, h.slug);
      await mkdir(path.join(root, 'recon', 'nested'), { recursive: true });
      await mkdir(path.join(root, 'report'), { recursive: true });
      await mkdir(path.join(root, 'forbidden'), { recursive: true });
      await writeFile(path.join(root, 'recon', 'nmap.txt'), 'ports', 'utf8');
      await writeFile(path.join(root, 'recon', 'nested', 'deep.txt'), 'hidden', 'utf8');
      await writeFile(path.join(root, 'report', 'out.md'), '# report', 'utf8');
      await writeFile(path.join(root, 'forbidden', 'x.txt'), 'nope', 'utf8');
      const view = (await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts' })).json();
      expect(isArtifactsView(view)).toBe(true);
      expect(view.folders.map((f: { folder: string }) => f.folder)).toEqual(['recon', 'report']);
      expect(view.folders[0].files).toEqual([{ name: 'nmap.txt', path: 'recon/nmap.txt', sizeBytes: 5 }]);
    });
  });
  it('serves text/JSON content with media type and rejects traversal, symlinks and binary', async () => {
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
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'exploit/payload.bin' } })).statusCode).toBe(500);
      await writeFile(path.join(h.workspaceRoot, 'outside.txt'), 'outside', 'utf8');
      const linked = await symlink(path.join(h.workspaceRoot, 'outside.txt'), path.join(root, 'recon', 'leak.txt'), 'file').then(() => true, () => false);
      if (linked) expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/artifacts/content', query: { path: 'recon/leak.txt' } })).statusCode).toBe(400);
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
});
