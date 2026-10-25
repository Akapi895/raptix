import type { TimelineEntryView, TimelineView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectPolicyError } from '../security/project-policy.js';
import type { ProjectFiles } from './project-files.js';
import type { ArtifactsService } from './artifacts-service.js';
import { ARTIFACT_FOLDERS } from './artifacts-service.js';
import type { RunService } from './runtime/run-service.js';
import { ProjectNotFoundError } from './projects-service.js';

/**
 * W14 operations timeline: three explicitly-labeled, deduplicated sources —
 * runtime run states (one entry per owned run, no transcript replay
 * duplication), durable checkpoint transcripts (thread-level, runId stays
 * null by contract) and workspace artifact-mtime markers. An artifact mtime is
 * a presence marker only; it is never presented as exact tool execution time.
 * Output is bounded and newest-first; `truncated` is truthful.
 */

type RunPage = Awaited<ReturnType<RunService['listRuns']>>;
type ThreadSnapshot = Awaited<ReturnType<RunService['snapshot']>>;

const MAX_ENTRIES = 250;
/** The page a caller gets when it names no limit; the source window never exceeds MAX_ENTRIES. */
export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = MAX_ENTRIES;
const MAX_RUNS_PER_THREAD = 25;
const MAX_TRANSCRIPTS_PER_THREAD = 50;
const MAX_ARTIFACTS = 100;
/**
 * The gathered window is reused this long, so a page request and the poll that follows it share one read of the runtime
 * and the workspace. Access is still checked on every request before the window is used.
 */
const WINDOW_TTL_MS = 10_000;

interface TimelineWindow {
  entries: TimelineEntryView[];
  truncated: boolean;
  unavailableThreads: number;
  untimedCheckpoints: number;
}

export class TimelineService {
  private readonly windows = new Map<string, { expiresAt: number; window: Promise<TimelineWindow> }>();

  public constructor(
    private readonly db: PrismaClient,
    private readonly runs: RunService,
    private readonly artifacts: ArtifactsService,
    private readonly files: ProjectFiles,
  ) {}

  public async timeline(userId: string, engagementId: string, options: { limit?: number } = {}): Promise<TimelineView> {
    const project = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!project) throw new ProjectNotFoundError();
    const window = await this.windowFor(userId, engagementId, project.workspaceSlug);
    // A page is a prefix of the window, so a larger limit returns the same entries first.
    const limit = Math.min(Math.max(options.limit ?? TIMELINE_DEFAULT_LIMIT, 1), TIMELINE_MAX_LIMIT);
    return {
      engagementId,
      entries: window.entries.slice(0, limit),
      truncated: window.truncated,
      hasMore: window.entries.length > limit,
      unavailableThreads: window.unavailableThreads,
      untimedCheckpoints: window.untimedCheckpoints,
      source: 'mixed',
    };
  }

  /** The gathered window for an engagement, reused for WINDOW_TTL_MS; concurrent callers share one gather. */
  private windowFor(userId: string, engagementId: string, slug: string): Promise<TimelineWindow> {
    const now = Date.now();
    const cached = this.windows.get(engagementId);
    if (cached !== undefined && cached.expiresAt > now) return cached.window;
    const window = this.gather(userId, engagementId, slug);
    this.windows.set(engagementId, { expiresAt: now + WINDOW_TTL_MS, window });
    // A failed gather is not reused: the next request reads the sources again.
    window.catch(() => {
      if (this.windows.get(engagementId)?.window === window) this.windows.delete(engagementId);
    });
    return window;
  }

  private async gather(userId: string, engagementId: string, slug: string): Promise<TimelineWindow> {
    const entries: TimelineEntryView[] = [];
    let truncated = false;

    // Runtime: one merged entry per owned run per bound thread. The threads are read together, not one after another.
    const threads = await this.runs.listThreads(userId, engagementId);
    if (threads.threads.length > 5) truncated = true;
    const reads = await Promise.all(threads.threads.slice(0, 5).map(async (thread) => ({ thread, read: await this.readThread(userId, engagementId, thread.threadId) })));
    let unavailableThreads = 0;
    let untimedCheckpoints = 0;
    for (const { thread, read } of reads) {
      if (read === null) { unavailableThreads += 1; continue; }
      const { page, snapshot } = read;
      if (page.nextOffset !== null || snapshot.transcriptsTruncated === true) truncated = true;
      for (const run of page.runs) {
        entries.push({
          id: `run:${run.runId}`,
          at: run.createdAt,
          source: 'runtime',
          kind: 'run',
          label: `Run ${run.rawStatus}`,
          agent: thread.assistantId,
          runId: run.runId,
          status: run.rawStatus,
        });
      }
      // Checkpoint transcripts: thread-level durable history, runId null by contract.
      const transcripts = snapshot.transcripts ?? [];
      for (const transcript of transcripts.slice(0, MAX_TRANSCRIPTS_PER_THREAD)) {
        const at = extractTranscriptTime(transcript.key);
        // A checkpoint with no recorded time cannot be ordered. It is counted, never given the time it was read.
        if (at === null) { untimedCheckpoints += 1; continue; }
        entries.push({
          id: `checkpoint:${transcript.key ?? entries.length}`,
          at,
          source: 'checkpoint',
          kind: transcript.payload.type,
          label: transcript.payload.type.replace(/_/g, ' '),
          ...('agent' in transcript.payload ? { agent: transcript.payload.agent } : {}),
          ...('name' in transcript.payload ? { tool: transcript.payload.name } : {}),
        });
      }
    }

    // Workspace artifact mtimes: presence markers across allowlisted folders. The workspace is resolved once for all of them.
    const artifacts = await this.artifacts.list(userId, engagementId);
    const files: { folder: string; path: string }[] = [];
    for (const folder of artifacts.folders) {
      for (const file of folder.files) {
        if (files.length >= MAX_ARTIFACTS) { truncated = true; break; }
        files.push({ folder: folder.folder, path: file.path });
      }
      if (files.length >= MAX_ARTIFACTS) break;
    }
    const stamps = await Promise.all(files.map((file) => this.artifactMtime(slug, file.path)));
    stamps.forEach((at, index) => {
      if (at === null) return;
      const file = files[index]!;
      entries.push({
        id: `workspace:${file.path}`,
        at,
        source: 'workspace',
        kind: 'artifact',
        label: `Artifact present: ${file.path}`,
        tool: file.folder,
      });
    });

    entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (entries.length > MAX_ENTRIES) { entries.length = MAX_ENTRIES; truncated = true; }
    return { entries, truncated, unavailableThreads, untimedCheckpoints };
  }

  /**
   * A thread whose binding no longer matches persisted state answers 409. It is
   * left out and counted, so one stale thread cannot blank the whole timeline.
   */
  private async readThread(userId: string, engagementId: string, threadId: string): Promise<{ page: RunPage; snapshot: ThreadSnapshot } | null> {
    try {
      // The scoped run page parser only accepts string query values (limit ≤ 25).
      const page = await this.runs.listRuns(userId, engagementId, threadId, { limit: String(MAX_RUNS_PER_THREAD), offset: '0' });
      const snapshot = await this.runs.snapshot(userId, engagementId, threadId);
      return { page, snapshot };
    } catch (error) {
      if (error instanceof ProjectPolicyError && error.code === 'conflict') return null;
      throw error;
    }
  }


  private async artifactMtime(slug: string, relativePath: string): Promise<string | null> {
    const segments = relativePath.split('/');
    if (segments.length !== 2 || !(ARTIFACT_FOLDERS as readonly string[]).includes(segments[0]!)) return null;
    try {
      const info = await this.files.stat(slug, relativePath);
      return info === null ? null : info.mtime.toISOString();
    } catch {
      return null;
    }
  }
}

function extractTranscriptTime(key: string | null): string | null {
  if (!key) return null;
  const match = key.match(/@(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
  if (!match) return null;
  const parsed = new Date(match[1]!);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
