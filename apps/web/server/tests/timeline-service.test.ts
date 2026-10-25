import { describe, expect, it } from 'vitest';
import { TimelineService } from '../src/services/timeline-service.js';
import { LocalProjectFiles } from './support/local-project-files.js';
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
  return new TimelineService(db, runs as never, artifacts as never, new LocalProjectFiles('/nonexistent-workspace-root'));
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

describe('TimelineService pages', () => {
  const FOUR_RUNS = {
    runs: [1, 2, 3, 4].map((hour) => ({ runId: `run-${hour}`, createdAt: `2026-10-17T0${hour}:00:00.000Z`, rawStatus: 'success' })),
    offset: 0,
    nextOffset: null,
  };
  const onlyGood = (thread: string) => (thread === 'good' ? FOUR_RUNS : { runs: [], offset: 0, nextOffset: null });

  it('returns the newest page of the window and says whether older entries remain', async () => {
    const page = await service({ listRuns: async (thread) => onlyGood(thread), snapshot: async () => EMPTY_SNAPSHOT }).timeline('local', 'eng-1', { limit: 2 });
    expect(page.entries.map((entry) => entry.runId)).toEqual(['run-4', 'run-3']);
    expect(page.hasMore).toBe(true);
  });

  it('leaves out a checkpoint with no recorded time and counts it, instead of dating it to the moment it was read', async () => {
    const snapshot = {
      transcripts: [
        { key: 'no-time-here', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'tool_call', name: 'ls' } },
        { key: 'step@2026-10-17T02:00:00Z', runId: null, source: 'checkpoint', truncated: false, payload: { type: 'tool_call', name: 'load_skill' } },
      ],
      transcriptsTruncated: false,
    };
    const page = await service({ listRuns: async (thread) => onlyGood(thread), snapshot: async () => snapshot }).timeline('local', 'eng-1', { limit: 50 });
    // One untimed event per bound thread that the snapshot was read for; the dated ones stay, at their recorded time.
    expect(page.untimedCheckpoints).toBe(THREADS.threads.length);
    const checkpoints = page.entries.filter((entry) => entry.source === 'checkpoint');
    expect(checkpoints.every((entry) => entry.at === '2026-10-17T02:00:00.000Z')).toBe(true);
  });

  it('reads the runtime once for a page and the poll after it, and answers both from the same window', async () => {
    let listed = 0;
    const timeline = service({ listRuns: async (thread) => { listed += 1; return onlyGood(thread) }, snapshot: async () => EMPTY_SNAPSHOT });
    const first = await timeline.timeline('local', 'eng-1', { limit: 2 });
    const second = await timeline.timeline('local', 'eng-1', { limit: 4 });
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(4);
    // One gather lists each bound thread once; the second request is answered from the window it left.
    expect(listed).toBe(THREADS.threads.length);
  });

  it('answers the whole window when the limit reaches it, with nothing more to load', async () => {
    const page = await service({ listRuns: async (thread) => onlyGood(thread), snapshot: async () => EMPTY_SNAPSHOT }).timeline('local', 'eng-1', { limit: 4 });
    expect(page.entries).toHaveLength(4);
    expect(page.hasMore).toBe(false);
  });
});
