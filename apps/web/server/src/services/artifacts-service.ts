import { realpath, readFile, readdir, stat, mkdir, writeFile, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { ArtifactContentView, ArtifactsView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectPolicyError } from '../security/project-policy.js';
import { resolveEngagementWorkspaceDir } from '../security/workspace-policy.js';
import { ProjectNotFoundError } from './projects-service.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';

/**
 * W12 artifact browser: engagement-scoped, allowlisted, non-recursive file
 * listing and UTF-8 text/JSON content with a tightened boundary the legacy API
 * lacked — realpath/symlink containment on every folder and file, a read size
 * cap, and strict UTF-8 decoding (binary content is rejected, never guessed).
 * Paths are addressed as `<folder>/<file>` relative to the engagement
 * workspace; the engagement is identified by its owned API id, not by name.
 * ``plan`` is included so operators can inspect the planning documents
 * (roe/conops/…) the planning panel validates.
 */

export const ARTIFACT_FOLDERS = ['plan', 'recon', 'exploit', 'post-exploit', 'findings', 'report'] as const;
const MAX_FILES_PER_FOLDER = 200;
const MAX_CONTENT_BYTES = 256 * 1024;

/**
 * W19: strict UTF-8 decoding of retained bytes. A bounded read can split the
 * trailing multibyte codepoint — only then (and only then) dropping that
 * partial tail (at most 3 bytes) keeps truncation truthful; any other decode
 * failure is binary and must stay explicit.
 */
function decodeRetainedText(bytes: Buffer, truncated: boolean): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // Full-decode first: truncation is only a problem when the cut lands inside a codepoint.
  try {
    return decoder.decode(bytes);
  } catch { /* fall through to the tail-drop attempt below */ }
  if (truncated) {
    for (let drop = 1; drop <= 3; drop++) {
      try {
        return decoder.decode(bytes.subarray(0, bytes.length - drop));
      } catch { /* the split point can sit further in a multibyte tail */ }
    }
  }
  throw new ProjectApiError(503, 'The retained artifact is not valid UTF-8 text; binary inspection is not supported.');
}

export interface RetainedCaptureView { engagementId: string; path: string; digest: string; sizeBytes: number; producer: string | null }

export class ArtifactsService {
  public constructor(private readonly db: PrismaClient, private readonly workspaceRoot: string) {}

  private async workspaceDir(userId: string, engagementId: string): Promise<string> {
    // Ownership-scoped first; a non-owner member resolves through the persisted
    // membership gate before the workspace path is disclosed at all.
    let project = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (project === null) {
      await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
      project = await this.db.engagement.findFirst({ where: { id: engagementId } });
      if (project === null) throw new ProjectNotFoundError();
    }
    return resolveEngagementWorkspaceDir(this.workspaceRoot, project.workspaceSlug);
  }

  private async safeRealPath(target: string): Promise<string | null> {
    try { return await realpath(target); } catch { return null; }
  }

  public async list(userId: string, engagementId: string): Promise<ArtifactsView> {
    const dir = await this.workspaceDir(userId, engagementId);
    const realDir = (await this.safeRealPath(dir)) ?? dir;
    const folders: ArtifactsView['folders'] = [];
    for (const folder of ARTIFACT_FOLDERS) {
      const folderDir = path.join(dir, folder);
      const realFolder = await this.safeRealPath(folderDir);
      if (realFolder === null || realFolder !== realDir && !realFolder.startsWith(realDir + path.sep)) continue;
      let entries;
      try {
        entries = await readdir(realFolder, { withFileTypes: true });
      } catch (error) {
        // W19: a missing folder is an allowed empty outcome; any other
        // filesystem failure must surface instead of faking an empty list.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new ProjectApiError(503, 'The workspace artifact listing is unavailable.');
      }
      const files: ArtifactsView['folders'][number]['files'] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile()) continue;
        const info = await stat(path.join(realFolder, entry.name)).catch((statError) => {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw new ProjectApiError(503, 'The workspace artifact listing is unavailable.');
        });
        if (!info || !info.isFile()) continue;
        files.push({ name: entry.name.slice(0, 200), path: `${folder}/${entry.name}`, sizeBytes: info.size });
        if (files.length >= MAX_FILES_PER_FOLDER) break;
      }
      if (files.length) folders.push({ folder, files });
    }
    return { engagementId, folders, source: 'workspace' };
  }

  private async artifactFile(userId: string, engagementId: string, rawPath: string): Promise<string> {
    const rawSegments = rawPath.split('/');
    if (rawSegments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
      throw new ProjectPolicyError('bad_request', 'Invalid artifact path');
    }
    const segments = rawSegments;
    if (segments.length !== 2 || !(ARTIFACT_FOLDERS as readonly string[]).includes(segments[0]!)) {
      throw new ProjectPolicyError('bad_request', 'Invalid artifact path');
    }
    const dir = await this.workspaceDir(userId, engagementId);
    const realDir = (await this.safeRealPath(dir)) ?? dir;
    const target = path.resolve(dir, ...segments);
    if (target !== dir && !target.startsWith(dir + path.sep)) throw new ProjectPolicyError('bad_request', 'Invalid artifact path');
    const realTarget = await this.safeRealPath(target);
    if (realTarget === null) throw new ProjectPolicyError('not_found', 'Artifact not found');
    if (!realTarget.startsWith(realDir + path.sep)) throw new ProjectPolicyError('bad_request', 'Invalid artifact path');
    const info = await stat(realTarget).catch(() => null);
    if (!info || !info.isFile()) throw new ProjectPolicyError('not_found', 'Artifact not found');
    return realTarget;
  }

  public async content(userId: string, engagementId: string, rawPath: string): Promise<ArtifactContentView> {
    const realTarget = await this.artifactFile(userId, engagementId, rawPath);
    const info = await stat(realTarget);
    const truncated = info.size > MAX_CONTENT_BYTES;
    const file = await open(realTarget, 'r');
    let content: string;
    try {
      const buffer = Buffer.alloc(Math.min(info.size, MAX_CONTENT_BYTES));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      content = decodeRetainedText(buffer.subarray(0, bytesRead), truncated);
    } finally { await file.close(); }
    const isJson = realTarget.toLowerCase().endsWith('.json');
    return {
      engagementId,
      path: rawPath,
      content: content.slice(0, MAX_CONTENT_BYTES),
      mediaType: isJson ? 'json' : 'text',
      sizeBytes: info.size,
      truncated,
      source: 'workspace',
    };
  }

  public async capture(userId: string, engagementId: string, artifactPath: string): Promise<RetainedCaptureView> {
    const file = await this.artifactFile(userId, engagementId, artifactPath);
    const info = await stat(file);
    if (info.size > MAX_CONTENT_BYTES) throw new ProjectApiError(400, 'Evidence capture exceeds the 256 KiB bound.');
    const bytes = await readFile(file);
    if (bytes.length > MAX_CONTENT_BYTES) throw new ProjectApiError(400, 'Evidence capture exceeds the 256 KiB bound.');
    return { engagementId, path: artifactPath, digest: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, producer: null };
  }

  public async upload(userId: string, engagementId: string, input: unknown): Promise<RetainedCaptureView> {
    await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as { base64?: unknown; mediaType?: unknown };
    if (typeof body.base64 !== 'string' || !body.base64.length || body.base64.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) throw new ProjectApiError(400, 'A base64 capture of 1-262144 bytes is required.');
    const bytes = Buffer.from(body.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_CONTENT_BYTES) throw new ProjectApiError(400, 'A capture of 1-262144 bytes is required.');
    const dir = await this.workspaceDir(userId, engagementId);
    const folder = path.join(dir, 'findings');
    await mkdir(folder, { recursive: true });
    const root = await realpath(dir);
    const realFolder = await realpath(folder);
    if (!realFolder.startsWith(root + path.sep)) throw new ProjectPolicyError('bad_request', 'Invalid capture folder');
    const name = `capture-${randomUUID()}.${body.mediaType === 'application/json' ? 'json' : body.mediaType === 'text/plain' ? 'txt' : 'bin'}`;
    await writeFile(path.join(realFolder, name), bytes, { flag: 'wx' });
    return { engagementId, path: `findings/${name}`, digest: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, producer: `web-user:${userId}` };
  }
}
