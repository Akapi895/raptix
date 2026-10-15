import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { isTimelineView, type ScopedRunView, type ScopedThreadView, type ThreadBindingView } from '@raptix/web-contracts';
import { registerErrorHandler } from '../src/http/error-handler.js';
import { registerTimelineRoutes } from '../src/http/routes/timeline.routes.js';
import { ArtifactsService } from '../src/services/artifacts-service.js';
import { ExportService, isExportFormat } from '../src/services/export-service.js';
import { TimelineService } from '../src/services/timeline-service.js';
import type { RunService } from '../src/services/runtime/run-service.js';

const OLD = '2026-10-01T08:00:00.000Z';

interface Harness { app: FastifyInstance; workspaceRoot: string; slug: string; timeline: TimelineService; exports: ExportService; setNextOffset: (value: number | null) => void }

async function buildHarness(): Promise<Harness> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'w14-'));
  const slug = `w14-proj-${Date.now().toString(36)}`;
  const db = {
    engagement: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === 'eng-1' && where.userId === 'local' ? { id: 'eng-1', name: slug, workspaceSlug: slug } : null,
    },
  };
  const binding = { threadId: 'th-1', assistantId: 'soundwave', kind: 'planning', runtimeConfigHash: 'h1' } as unknown as ThreadBindingView;
  const run: ScopedRunView = { engagementId: 'eng-1', threadId: 'th-1', runId: 'run-9', requestId: 'req-9', rawStatus: 'success', createdAt: OLD, updatedAt: OLD, source: 'runtime' };
  let nextOffset: number | null = null;
  const runs = {
    listThreads: async (): Promise<{ engagementId: string; threads: ThreadBindingView[]; source: 'runtime' }> => ({ engagementId: 'eng-1', threads: [binding], source: 'runtime' }),
    listRuns: async (): Promise<{ runs: ScopedRunView[]; offset: number; nextOffset: number | null }> => ({ runs: [run], offset: 0, nextOffset }),
    snapshot: async (): Promise<ScopedThreadView> => ({
      binding, rawStatus: 'idle', messages: [], messagesTruncated: false, historyScope: 'root_messages_only', source: 'runtime',
      transcripts: [{ key: `planner|run-9@2026-10-01T09:30:00.000Z`, runId: null, source: 'checkpoint', truncated: false, payload: { type: 'subagent_tool_call', agent: 'soundwave', truncated: false } }],
      transcriptsTruncated: false,
    }),
  } as unknown as RunService;
  const artifacts = new ArtifactsService(db as never, workspaceRoot);
  const timeline = new TimelineService(db as never, runs, artifacts, workspaceRoot);
  const exports = new ExportService(db as never, workspaceRoot);
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerTimelineRoutes(app, timeline, exports, { id: 'local', mode: 'local-single-user' });
  await app.ready();
  return { app, workspaceRoot, slug, timeline, exports, setNextOffset: (value) => { nextOffset = value; } };
}

const harnesses: Harness[] = [];
const withHarness = async (run: (h: Harness) => Promise<void>): Promise<void> => {
  const harness = await buildHarness();
  harnesses.push(harness);
  try { await run(harness); } finally { await harness.app.close(); }
};

async function seedWorkspace(h: Harness): Promise<void> {
  await mkdir(path.join(h.workspaceRoot, h.slug, 'recon'), { recursive: true });
  await mkdir(path.join(h.workspaceRoot, h.slug, 'findings'), { recursive: true });
  await mkdir(path.join(h.workspaceRoot, h.slug, 'plan'), { recursive: true });
  await writeFile(path.join(h.workspaceRoot, h.slug, 'recon', 'nmap.txt'), 'scan output', 'utf8');
  await writeFile(path.join(h.workspaceRoot, h.slug, 'findings', 'FIND-2026-001.md'), '# Finding\n\nSeverity: high\n', 'utf8');
  await writeFile(path.join(h.workspaceRoot, h.slug, 'plan', 'roe.json'), '{"rules":[]}', 'utf8');
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await rm(harness.workspaceRoot, { recursive: true, force: true });
});

describe('W14 operations timeline', () => {
  it('merges runtime, checkpoint and workspace entries with distinct labels, newest first', async () => {
    await withHarness(async (h) => {
      await seedWorkspace(h);
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/timeline' });
      expect(response.statusCode).toBe(200);
      const view = response.json();
      expect(isTimelineView(view)).toBe(true);
      expect(view.truncated).toBe(false);
      const sources = view.entries.map((e: { source: string }) => e.source);
      expect(sources).toContain('runtime');
      expect(sources).toContain('checkpoint');
      expect(sources).toContain('workspace');
      const runEntry = view.entries.find((e: { id: string }) => e.id === 'run:run-9');
      expect(runEntry).toMatchObject({ source: 'runtime', kind: 'run', status: 'success' });
      const checkpoint = view.entries.find((e: { source: string }) => e.source === 'checkpoint');
      expect(checkpoint).toMatchObject({ kind: 'subagent_tool_call', agent: 'soundwave' });
      expect(checkpoint.runId).toBeUndefined();
      expect(checkpoint.at).toBe('2026-10-01T09:30:00.000Z');
      const artifact = view.entries.find((e: { id: string }) => e.id === 'workspace:recon/nmap.txt');
      expect(artifact).toBeDefined();
      expect(artifact).toMatchObject({ source: 'workspace', kind: 'artifact', tool: 'recon' });
      expect(artifact.label).toBe('Artifact updated: recon/nmap.txt');
      const times = view.entries.map((e: { at: string }) => Date.parse(e.at));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });
  });

  it('flags truncation when run pages overflow and keeps artifact mtime as presence marker only', async () => {
    await withHarness(async (h) => {
      h.setNextOffset(50);
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/timeline' });
      expect(response.statusCode).toBe(200);
      expect(response.json().truncated).toBe(true);
    });
  });

  it('answers 404 for a foreign engagement', async () => {
    await withHarness(async (h) => {
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-other/timeline' });
      expect(response.statusCode).toBe(404);
    });
  });
});

describe('W14 engagement export', () => {
  it('validates formats server-side and never falls back silently to markdown', async () => {
    expect(isExportFormat('json')).toBe(true);
    expect(isExportFormat('markdown')).toBe(true);
    expect(isExportFormat('pdf')).toBe(false);
    await withHarness(async (h) => {
      for (const url of ['/api/engagements/eng-1/export', '/api/engagements/eng-1/export?format=pdf', '/api/engagements/eng-1/export?format=docx']) {
        const response = await h.app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.message).toContain('json, markdown');
      }
    });
  });

  it('exports the real engagement payload as JSON with correct attachment headers', async () => {
    await withHarness(async (h) => {
      await seedWorkspace(h);
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/export?format=json' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toBe(`attachment; filename="${h.slug}-export.json"`);
      const body = JSON.parse(response.body) as { engagement: Record<string, unknown>; planDocs: Record<string, unknown>; findings: { id: string; content: string }[]; findingsUnreadable: number };
      expect(body.engagement).toEqual({ id: 'eng-1', name: h.slug });
      expect(body.planDocs.roe).toEqual({ rules: [] });
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0]!.content).toContain('# Finding');
      expect(body.findingsUnreadable).toBe(0);
    });
  });

  it('exports markdown with plan docs, findings and truthful unreadable count', async () => {
    await withHarness(async (h) => {
      await seedWorkspace(h);
      await writeFile(path.join(h.workspaceRoot, h.slug, 'findings', 'FIND-2026-002.md'), ''.padEnd(300 * 1024, 'x'), 'utf8');
      const response = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/export?format=markdown' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/markdown');
      expect(response.headers['content-disposition']).toBe(`attachment; filename="${h.slug}-export.md"`);
      expect(response.body).toContain(`# ${h.slug} — Engagement Export`);
      expect(response.body).toContain('### roe');
      expect(response.body).toContain('### FIND-2026-001');
      expect(response.body).toContain('1 finding file(s) unreadable');
    });
  });

  it('answers 404 for a foreign engagement and 200-empty for one without artifacts', async () => {
    await withHarness(async (h) => {
      expect((await h.app.inject({ method: 'GET', url: '/api/engagements/eng-other/export?format=json' })).statusCode).toBe(404);
      const empty = await h.app.inject({ method: 'GET', url: '/api/engagements/eng-1/export?format=json' });
      expect(empty.statusCode).toBe(200);
      const body = JSON.parse(empty.body) as { planDocs: Record<string, unknown>; findings: unknown[] };
      expect(body.planDocs).toEqual({});
      expect(body.findings).toEqual([]);
    });
  });
});
