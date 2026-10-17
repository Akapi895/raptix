import { describe, expect, it } from 'vitest';
import { TimelineService } from '../src/services/timeline-service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { ProjectPolicyError } from '../src/security/project-policy.js';

const THREADS = { engagementId: 'eng-1', source: 'runtime' as const, threads: [{ threadId: 'good' }, { threadId: 'stale' }] };

function conflict(): Error {
  return new ProjectPolicyError('conflict', 'Runtime ownership or request intent conflicts with persisted state');
}

function service(opts: { listRuns: (thread: string) => Promise<unknown>; snapshot: (thread: string) => Promise<unknown> }): TimelineService {
  const db = { engagement: { findFirst: async () => ({ workspaceSlug: 'popup-lab-lbvq' }) } } as unknown as PrismaClient;
  const runs = {
    listThreads: async () => THREADS,
    listRuns: async (_user: string, _eng: string, thread: string) => opts.listRuns(thread),
    snapshot: async (_user: string, _eng: string, thread: string) => opts.snapshot(thread),
  };
  const artifacts = { list: async () => ({ folders: [] }) };
  return new TimelineService(db, runs as never, artifacts as never, '/nonexistent-workspace-root');
}

const GOOD_RUNS = { runs: [{ runId: 'run-good', createdAt: '2026-10-17T01:00:00.000Z', rawStatus: 'success' }], offset: 0, nextOffset: null };
const EMPTY_SNAPSHOT = { transcripts: [], transcriptsTruncated: false };

describe('TimelineService thread conflicts', () => {
  it('keeps the readable threads and counts a thread whose binding conflicts instead of failing the whole timeline', async () => {
    const timeline = await service({
      listRuns: async (thread) => { if (thread === 'stale') throw conflict(); return GOOD_RUNS; },
      snapshot: async () => EMPTY_SNAPSHOT,
    }).timeline('local', 'eng-1');
    expect(timeline.entries.map((e) => e.runId)).toEqual(['run-good']);
    expect(timeline.unavailableThreads).toBe(1);
  });

  it('drops a conflicting thread entirely, including runs it returned before its snapshot conflicted', async () => {
    const timeline = await service({
      listRuns: async () => GOOD_RUNS,
      snapshot: async (thread) => { if (thread === 'stale') throw conflict(); return EMPTY_SNAPSHOT; },
    }).timeline('local', 'eng-1');
    expect(timeline.entries.map((e) => e.runId)).toEqual(['run-good']);
    expect(timeline.unavailableThreads).toBe(1);
  });

  it('reports no unavailable threads when every binding reads cleanly', async () => {
    const timeline = await service({
      listRuns: async () => GOOD_RUNS,
      snapshot: async () => EMPTY_SNAPSHOT,
    }).timeline('local', 'eng-1');
    expect(timeline.unavailableThreads).toBe(0);
  });

  it('still fails for errors that are not binding conflicts', async () => {
    await expect(service({
      listRuns: async (thread) => { if (thread === 'stale') throw new Error('runtime unreachable'); return GOOD_RUNS; },
      snapshot: async () => EMPTY_SNAPSHOT,
    }).timeline('local', 'eng-1')).rejects.toThrow('runtime unreachable');
  });
});

describe('TimelineService contract', () => {
  it('marks the timeline as having no unavailable threads when there are none to count', async () => {
    const timeline = await service({ listRuns: async () => GOOD_RUNS, snapshot: async () => EMPTY_SNAPSHOT }).timeline('local', 'eng-1');
    expect(timeline).toMatchObject({ engagementId: 'eng-1', truncated: false, source: 'mixed', unavailableThreads: 0 });
  });
});
