import { realpath, readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { ArtifactContentView, ArtifactsView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectPolicyError } from '../security/project-policy.js';
import { resolveEngagementWorkspaceDir } from '../security/workspace-policy.js';
import { ProjectNotFoundError } from './projects-service.js';

/**
 * W12 artifact browser: engagement-scoped, allowlisted, non-recursive file
 * listing and UTF-8 text/JSON content with a tightened boundary the legacy API
 * lacked — realpath/symlink containment on every folder and file, a read size
 * cap, and strict UTF-8 decoding (binary content is rejected, never guessed).
 * Paths are addressed as `<folder>/<file>` relative to the engagement
 * workspace; the engagement is identified by its owned API id, not by name.
 */

export const ARTIFACT_FOLDERS = ['recon', 'exploit', 'post-exploit', 'findings', 'report'] as const;
const MAX_FILES_PER_FOLDER = 200;
const MAX_CONTENT_BYTES = 256 * 1024;

export class ArtifactsService {
  public constructor(private readonly db: PrismaClient, private readonly workspaceRoot: string) {}

  private async workspaceDir(userId: string, engagementId: string): Promise<string> {
    const project = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!project) throw new ProjectNotFoundError();
    return resolveEngagementWorkspaceDir(this.workspaceRoot, project.name);
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
      try { entries = await readdir(realFolder, { withFileTypes: true }); } catch { continue; }
      const files: ArtifactsView['folders'][number]['files'] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile()) continue;
        const info = await stat(path.join(realFolder, entry.name)).catch(() => null);
        if (!info || !info.isFile()) continue;
        files.push({ name: entry.name.slice(0, 200), path: `${folder}/${entry.name}`, sizeBytes: info.size });
        if (files.length >= MAX_FILES_PER_FOLDER) break;
      }
      if (files.length) folders.push({ folder, files });
    }
    return { engagementId, folders, source: 'workspace' };
  }

  public async content(userId: string, engagementId: string, rawPath: string): Promise<ArtifactContentView> {
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
    const truncated = info.size > MAX_CONTENT_BYTES;
    const buffer = await readFile(realTarget);
    const slice = truncated ? buffer.subarray(0, MAX_CONTENT_BYTES) : buffer;
    const content = new TextDecoder('utf-8', { fatal: true }).decode(slice);
    const isJson = realTarget.toLowerCase().endsWith('.json');
    return {
      engagementId,
      path: `${segments[0]}/${segments[1]}`,
      content: content.slice(0, MAX_CONTENT_BYTES),
      mediaType: isJson ? 'json' : 'text',
      sizeBytes: info.size,
      truncated,
      source: 'workspace',
    };
  }
}
