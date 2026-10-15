import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { TimelineEntryView, TimelineView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { resolveEngagementWorkspaceDir } from '../security/workspace-policy.js';
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

const MAX_ENTRIES = 250;
const MAX_RUNS_PER_THREAD = 25;
const MAX_TRANSCRIPTS_PER_THREAD = 50;
const MAX_ARTIFACTS = 100;

export class TimelineService {
  public constructor(
    private readonly db: PrismaClient,
    private readonly runs: RunService,
    private readonly artifacts: ArtifactsService,
    private readonly workspaceRoot: string,
  ) {}

  public async timeline(userId: string, engagementId: string): Promise<TimelineView> {
    const project = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!project) throw new ProjectNotFoundError();
    const entries: TimelineEntryView[] = [];
    let truncated = false;

    // Runtime: one merged entry per owned run per bound thread.
    const threads = await this.runs.listThreads(userId, engagementId);
    if (threads.threads.length > 5) truncated = true;
    for (const thread of threads.threads.slice(0, 5)) {
      // The scoped run page parser only accepts string query values (limit ≤ 25).
      const page = await this.runs.listRuns(userId, engagementId, thread.threadId, { limit: String(MAX_RUNS_PER_THREAD), offset: '0' });
      if (page.nextOffset !== null) truncated = true;
      for (const run of page.runs) {
        entries.push({
          id: `run:${run.runId}`,
          at: run.createdAt,
          source: 'runtime',
          kind: 'run',
          label: `Planning run ${run.rawStatus}`,
          runId: run.runId,
          status: run.rawStatus,
        });
      }
    }

    // Checkpoint transcripts: thread-level durable history, runId null by contract.
    for (const thread of threads.threads.slice(0, 5)) {
      const snapshot = await this.runs.snapshot(userId, engagementId, thread.threadId);
      if (snapshot.transcriptsTruncated === true) truncated = true;
      const transcripts = snapshot.transcripts ?? [];
      for (const transcript of transcripts.slice(0, MAX_TRANSCRIPTS_PER_THREAD)) {
        entries.push({
          id: `checkpoint:${transcript.key ?? entries.length}`,
          at: extractTranscriptTime(transcript.key) ?? new Date().toISOString(),
          source: 'checkpoint',
          kind: transcript.payload.type,
          label: transcript.payload.type.replace(/_/g, ' '),
          ...(transcript.payload.agent !== undefined && transcript.payload.agent !== null ? { agent: String(transcript.payload.agent) } : {}),
        });
      }
    }

    // Workspace artifact mtimes: presence markers across allowlisted folders.
    const artifacts = await this.artifacts.list(userId, engagementId);
    let artifactCount = 0;
    for (const folder of artifacts.folders) {
      for (const file of folder.files) {
        if (artifactCount >= MAX_ARTIFACTS) { truncated = true; break; }
        const at = await this.artifactMtime(project.workspaceSlug, file.path);
        if (at === null) continue;
        artifactCount += 1;
        entries.push({
          id: `workspace:${file.path}`,
          at,
          source: 'workspace',
          kind: 'artifact',
          label: `Artifact updated: ${file.path}`,
          tool: folder.folder,
        });
      }
      if (artifactCount >= MAX_ARTIFACTS) break;
    }

    entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (entries.length > MAX_ENTRIES) { entries.length = MAX_ENTRIES; truncated = true; }
    return { engagementId, entries, truncated, source: 'mixed' };
  }

  private async artifactMtime(slug: string, relativePath: string): Promise<string | null> {
    const segments = relativePath.split('/');
    if (segments.length !== 2 || !(ARTIFACT_FOLDERS as readonly string[]).includes(segments[0]!)) return null;
    try {
      const dir = await resolveEngagementWorkspaceDir(this.workspaceRoot, slug);
      const info = await stat(path.join(dir, segments[0]!, segments[1]!));
      return info.mtime.toISOString();
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
