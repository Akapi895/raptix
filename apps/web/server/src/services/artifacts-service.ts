import { realpath, readFile, readdir, stat, open, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { ArtifactContentView, ArtifactsView, CaptureClassification, ClassifyCaptureInput, RetainCaptureInput, RetainedCaptureView, RetainedCapturesView, WorkspaceEvidenceImportView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectPolicyError } from '../security/project-policy.js';
import { resolveEngagementWorkspaceDir } from '../security/workspace-policy.js';
import { ProjectNotFoundError } from './projects-service.js';
import { ProjectApiError } from './projects-service.js';
import { requireEngagementAccess, type MemberRole } from '../auth/membership-policy.js';
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

export interface RetainedArtifactView { engagementId: string; path: string; digest: string; sizeBytes: number; producer: string | null }

const CAPTURE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/octet-stream': 'bin',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'text/plain': 'txt',
  'application/xml': 'xml',
  'application/x-ndjson': 'jsonl',
}

type RetainedCaptureRow = {
  id: string; engagementId: string; requestId: string; requestFingerprint: string; path: string
  filename: string; mediaType: string; sizeBytes: number; digest: string; producer: string | null
  uploadedBy: string; classification: string; classificationVersion: number; classifiedBy: string | null
  classificationReason: string | null; classifiedAt: Date | null; createdAt: Date
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function privilegedCaptureRole(role: MemberRole): boolean {
  return role === 'owner' || role === 'reviewer'
}

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

  private toCaptureView(row: RetainedCaptureRow, role: MemberRole): RetainedCaptureView {
    const privileged = privilegedCaptureRole(role);
    return {
      id: row.id,
      engagementId: row.engagementId,
      filename: row.classification === 'standard' || privileged ? row.filename : null,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      digest: row.digest,
      producer: row.producer,
      classification: row.classification as CaptureClassification,
      classificationVersion: row.classificationVersion,
      uploadedBy: row.uploadedBy,
      classifiedBy: privileged ? row.classifiedBy : null,
      classificationReason: privileged ? row.classificationReason : null,
      classifiedAt: row.classifiedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      canReadOriginal: row.classification === 'standard' && role !== 'viewer' || row.classification === 'sensitive' && privileged,
      canClassify: privileged,
    };
  }

  private async retainedCapture(engagementId: string, captureId: string): Promise<RetainedCaptureRow> {
    const row = await this.db.retainedCapture.findFirst({ where: { id: captureId, engagementId } });
    if (row === null) throw new ProjectApiError(404, 'Capture not found.');
    return row as RetainedCaptureRow;
  }

  private async assertCaptureReadable(row: RetainedCaptureRow, role: MemberRole): Promise<void> {
    if (row.classification === 'unclassified') throw new ProjectApiError(409, 'Capture original bytes are unavailable until an owner or reviewer classifies them.');
    if (row.classification === 'sensitive' && !privilegedCaptureRole(role)) throw new ProjectApiError(404, 'Capture not found.');
    // ADR-0087: viewers see the capture record but never its original bytes, whatever the classification.
    if (role === 'viewer') throw new ProjectApiError(403, 'The viewer role cannot read original capture bytes.');
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
        if (folder === 'findings' && entry.name.startsWith('capture-')) continue;
        if (folder === 'findings' && entry.name.startsWith('capture-')) continue;
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
    if (rawPath.startsWith('findings/capture-')) {
      const row = await this.db.retainedCapture.findFirst({ where: { engagementId, path: rawPath } });
      if (row === null) throw new ProjectPolicyError('not_found', 'Artifact not found');
      const { bytes } = await this.downloadCapture(userId, engagementId, row.id);
      const truncated = bytes.length > MAX_CONTENT_BYTES;
      const content = decodeRetainedText(bytes.subarray(0, MAX_CONTENT_BYTES), truncated);
      return { engagementId, path: rawPath, content, mediaType: row.mediaType === 'application/json' ? 'json' : 'text', sizeBytes: row.sizeBytes, truncated, source: 'workspace' };
    }
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

  /**
   * Workspace evidence files an agent wrote: `findings/evidence/*`, or only `findings/evidence/<FIND-id>_*` when a
   * producer id is given. Only regular files are listed; a missing folder is an empty list.
   */
  public async workspaceEvidenceFiles(userId: string, engagementId: string, producerId?: string): Promise<string[]> {
    if (producerId !== undefined && !/^FIND-[A-Za-z0-9_-]{1,64}$/.test(producerId)) return [];
    await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    const dir = await this.workspaceDir(userId, engagementId);
    const folder = path.join(dir, 'findings', 'evidence');
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ProjectApiError(503, 'The workspace evidence listing is unavailable.');
    }
    return entries
      .filter((entry) => entry.isFile() && (producerId === undefined || entry.name.startsWith(`${producerId}_`)))
      .map((entry) => `findings/evidence/${entry.name}`)
      .sort()
      .slice(0, 50);
  }

  /**
   * Imports the evidence files an agent wrote under `findings/evidence/` as retained captures, so they appear in the
   * evidence inventory and can be attached to findings. Each file becomes an unclassified capture (ADR-0087): its bytes
   * stay locked until an owner or reviewer classifies it. Re-running is idempotent per version. A rewritten file
   * imports as a new capture; the version imported earlier stays as it was.
   */
  public async importWorkspaceEvidence(userId: string, engagementId: string, producerId?: string): Promise<WorkspaceEvidenceImportView> {
    const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const captures: RetainedCaptureView[] = [];
    const skipped: { path: string; reason: string }[] = [];
    const paths = await this.workspaceEvidenceFiles(userId, engagementId, producerId);
    if (paths.length === 0) return { engagementId, captures, skipped };
    const workspace = await this.workspaceDir(userId, engagementId);
    const root = await realpath(workspace);
    const realFindings = await realpath(path.join(workspace, 'findings'));
    if (!realFindings.startsWith(root + path.sep)) throw new ProjectPolicyError('bad_request', 'Invalid capture folder');
    const realEvidence = await realpath(path.join(realFindings, 'evidence'));
    for (const artifactPath of paths) {
      const filename = path.basename(artifactPath);
      const extension = path.extname(filename).slice(1).toLowerCase();
      const mediaType = Object.keys(CAPTURE_MEDIA_TYPES).find((type) => CAPTURE_MEDIA_TYPES[type] === extension);
      if (mediaType === undefined) {
        skipped.push({ path: artifactPath, reason: 'unsupported file type' });
        continue;
      }
      const source = await realpath(path.join(realEvidence, filename)).catch(() => null);
      if (source === null || !source.startsWith(realEvidence + path.sep)) {
        skipped.push({ path: artifactPath, reason: 'not a readable workspace file' });
        continue;
      }
      const info = await stat(source);
      if (info.size > MAX_CONTENT_BYTES) {
        skipped.push({ path: artifactPath, reason: 'exceeds the 256 KiB bound' });
        continue;
      }
      const bytes = await readFile(source);
      if (!bytes.length) {
        skipped.push({ path: artifactPath, reason: 'empty file' });
        continue;
      }
      const digest = createHash('sha256').update(bytes).digest('hex');
      // One capture per version: the path and the digest of the bytes imported. A rewritten file is a new version.
      const requestId = `ws-${createHash('sha256').update(`${artifactPath}\n${digest}`).digest('hex').slice(0, 40)}`;
      const requestFingerprint = createHash('sha256').update(JSON.stringify({ filename, mediaType, digest })).digest('hex');
      const existing = await this.findWorkspaceCapture(engagementId, artifactPath, requestId, requestFingerprint);
      if (existing !== null) {
        captures.push(this.toCaptureView(existing, access.role));
        continue;
      }
      const id = randomUUID();
      const relativePath = `findings/capture-${id}.${extension}`;
      const storedPath = path.join(realFindings, path.basename(relativePath));
      await writeFile(storedPath, bytes, { flag: 'wx' });
      try {
        const row = await this.db.$transaction(async (tx) => {
          const created = await tx.retainedCapture.create({ data: {
            id, engagementId, requestId, requestFingerprint, path: relativePath, filename, mediaType,
            sizeBytes: bytes.length, digest, producer: `workspace:${artifactPath}`, uploadedBy: userId,
            classification: 'unclassified', classificationVersion: 1,
          } });
          await tx.webAuditEntry.create({ data: { engagementId, actorId: userId, action: 'evidence.workspace_imported', targetType: 'retained_capture', targetId: id, reason: `${artifactPath} unclassified ${digest}` } });
          return created;
        });
        captures.push(this.toCaptureView(row as RetainedCaptureRow, access.role));
      } catch (error) {
        await unlink(storedPath).catch((cleanupError: NodeJS.ErrnoException) => {
          if (cleanupError.code !== 'ENOENT') throw new ProjectApiError(503, 'Capture metadata was not committed and temporary-file cleanup failed; reconcile the engagement workspace before retrying.');
        });
        if (!isUniqueConstraintError(error)) throw error;
        // A concurrent import of the same file won the race; keep its row and report the same outcome.
        const raced = await this.db.retainedCapture.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
        if (raced === null) throw error;
        captures.push(this.toCaptureView(raced as RetainedCaptureRow, access.role));
      }
    }
    return { engagementId, captures, skipped };
  }

  /**
   * The capture of this exact version of a workspace file, if it was already imported. A capture imported before
   * versions were keyed by digest carries the path alone; it is the same version only when its fingerprint matches.
   */
  private async findWorkspaceCapture(engagementId: string, artifactPath: string, requestId: string, requestFingerprint: string): Promise<RetainedCaptureRow | null> {
    const current = await this.db.retainedCapture.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
    if (current !== null) return current as RetainedCaptureRow;
    const legacyRequestId = `ws-${createHash('sha256').update(artifactPath).digest('hex').slice(0, 40)}`;
    const legacy = await this.db.retainedCapture.findUnique({ where: { engagementId_requestId: { engagementId, requestId: legacyRequestId } } });
    return legacy !== null && legacy.requestFingerprint === requestFingerprint ? (legacy as RetainedCaptureRow) : null;
  }

  public async capture(userId: string, engagementId: string, artifactPath: string): Promise<RetainedArtifactView> {
    if (artifactPath.startsWith('findings/capture-')) {
      const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
      const row = await this.db.retainedCapture.findFirst({ where: { engagementId, path: artifactPath } });
      if (row === null) throw new ProjectApiError(404, 'Artifact not found');
      await this.assertCaptureReadable(row as RetainedCaptureRow, access.role);
    }
    const file = await this.artifactFile(userId, engagementId, artifactPath);
    const info = await stat(file);
    if (info.size > MAX_CONTENT_BYTES) throw new ProjectApiError(400, 'Evidence capture exceeds the 256 KiB bound.');
    const bytes = await readFile(file);
    if (bytes.length > MAX_CONTENT_BYTES) throw new ProjectApiError(400, 'Evidence capture exceeds the 256 KiB bound.');
    return { engagementId, path: artifactPath, digest: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, producer: null };
  }

  /**
   * Resolves a retained capture for a finding link. Attach passes requireReadable=false: an unclassified
   * capture can be linked (ADR-0087) and its digest is checked here, but no bytes leave the server.
   * Retest and any read keep the readability gate.
   */
  public async captureById(userId: string, engagementId: string, captureId: string, options: { requireReadable?: boolean } = {}): Promise<RetainedArtifactView & { captureId: string; classification: CaptureClassification }> {
    const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    const row = await this.retainedCapture(engagementId, captureId);
    if (options.requireReadable !== false) await this.assertCaptureReadable(row, access.role);
    const file = await this.artifactFile(userId, engagementId, row.path);
    const bytes = await readFile(file);
    if (bytes.length !== row.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== row.digest) throw new ProjectApiError(409, 'The retained capture failed its recorded integrity check.');
    return { captureId, classification: row.classification as CaptureClassification, engagementId, path: row.path, digest: row.digest, sizeBytes: row.sizeBytes, producer: row.producer };
  }

  public async listCaptures(userId: string, engagementId: string): Promise<RetainedCapturesView> {
    const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    const rows = await this.db.retainedCapture.findMany({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    return { engagementId, captures: rows.map((row) => this.toCaptureView(row as RetainedCaptureRow, access.role)), source: 'db' };
  }

  public async upload(userId: string, engagementId: string, input: unknown): Promise<RetainedCaptureView> {
    const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'operator');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as Partial<RetainCaptureInput>;
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    const mediaType = typeof body.mediaType === 'string' ? body.mediaType : '';
    const base64 = typeof body.base64 === 'string' ? body.base64 : '';
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) throw new ProjectApiError(400, 'requestId (1-128 safe characters) is required.');
    if (!filename || filename.length > 255 || filename === '.' || filename === '..' || /[\\/\x00-\x1f]/.test(filename)) throw new ProjectApiError(400, 'filename must be a single safe file name of at most 255 characters.');
    const extension = CAPTURE_MEDIA_TYPES[mediaType];
    if (extension === undefined) throw new ProjectApiError(400, 'Unsupported capture media type.');
    if (!base64 || base64.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new ProjectApiError(400, 'A base64 capture of 1-262144 bytes is required.');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_CONTENT_BYTES) throw new ProjectApiError(400, 'A capture of 1-262144 bytes is required.');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const requestFingerprint = createHash('sha256').update(JSON.stringify({ filename, mediaType, digest })).digest('hex');
    const existing = await this.db.retainedCapture.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
    if (existing !== null) {
      if (existing.requestFingerprint !== requestFingerprint) throw new ProjectApiError(409, 'This capture request id was already used with different file content.');
      return this.toCaptureView(existing as RetainedCaptureRow, access.role);
    }

    const workspace = await this.workspaceDir(userId, engagementId);
    const folder = path.join(workspace, 'findings');
    await mkdir(folder, { recursive: true });
    const root = await realpath(workspace);
    const realFolder = await realpath(folder);
    if (!realFolder.startsWith(root + path.sep)) throw new ProjectPolicyError('bad_request', 'Invalid capture folder');
    const id = randomUUID();
    const relativePath = `findings/capture-${id}.${extension}`;
    const storedPath = path.join(realFolder, path.basename(relativePath));
    await writeFile(storedPath, bytes, { flag: 'wx' });
    try {
      const row = await this.db.$transaction(async (tx) => {
        const created = await tx.retainedCapture.create({ data: {
          id, engagementId, requestId, requestFingerprint, path: relativePath, filename, mediaType,
          sizeBytes: bytes.length, digest, producer: `web-user:${userId}`, uploadedBy: userId,
          classification: 'unclassified', classificationVersion: 1,
        } });
        await tx.webAuditEntry.create({ data: { engagementId, actorId: userId, action: 'evidence.capture_uploaded', targetType: 'retained_capture', targetId: id, reason: `unclassified ${digest}` } });
        return created;
      });
      return this.toCaptureView(row as RetainedCaptureRow, access.role);
    } catch (error) {
      await unlink(storedPath).catch((cleanupError: NodeJS.ErrnoException) => {
        if (cleanupError.code !== 'ENOENT') throw new ProjectApiError(503, 'Capture metadata was not committed and temporary-file cleanup failed; reconcile the engagement workspace before retrying.');
      });
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.db.retainedCapture.findUnique({ where: { engagementId_requestId: { engagementId, requestId } } });
      if (raced === null) throw error;
      if (raced.requestFingerprint !== requestFingerprint) throw new ProjectApiError(409, 'This capture request id was already used with different file content.');
      return this.toCaptureView(raced as RetainedCaptureRow, access.role);
    }
  }

  public async classifyCapture(userId: string, engagementId: string, captureId: string, input: unknown): Promise<RetainedCaptureView> {
    const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    if (!privilegedCaptureRole(access.role)) throw new ProjectApiError(403, 'Capture classification requires the owner or reviewer role.');
    await assertEngagementOpen(this.db, engagementId);
    const body = (input ?? {}) as Partial<ClassifyCaptureInput>;
    if (body.classification !== 'standard' && body.classification !== 'sensitive') throw new ProjectApiError(400, "classification must be 'standard' or 'sensitive'.");
    if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new ProjectApiError(400, 'expectedVersion must be a positive integer.');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 1000) throw new ProjectApiError(400, 'A classification reason (1-1000 characters) is required.');
    const updated = await this.db.$transaction(async (tx) => {
      const current = await tx.retainedCapture.findFirst({ where: { id: captureId, engagementId } });
      if (current === null) throw new ProjectApiError(404, 'Capture not found.');
      if (current.classificationVersion !== body.expectedVersion) throw new ProjectApiError(409, 'The capture classification changed; reload before deciding.');
      const result = await tx.retainedCapture.updateMany({
        where: { id: captureId, engagementId, classificationVersion: body.expectedVersion },
        data: { classification: body.classification, classificationVersion: { increment: 1 }, classifiedBy: userId, classificationReason: reason, classifiedAt: new Date() },
      });
      if (result.count !== 1) throw new ProjectApiError(409, 'The capture classification changed; reload before deciding.');
      await tx.webAuditEntry.create({ data: { engagementId, actorId: userId, action: 'evidence.capture_classified', targetType: 'retained_capture', targetId: captureId, reason: `${body.classification}: ${reason}` } });
      return tx.retainedCapture.findFirst({ where: { id: captureId, engagementId } });
    });
    if (updated === null) throw new ProjectApiError(404, 'Capture not found.');
    return this.toCaptureView(updated as RetainedCaptureRow, access.role);
  }

  public async downloadCapture(userId: string, engagementId: string, captureId: string): Promise<{ capture: RetainedCaptureView; bytes: Buffer }> {
    const access = await requireEngagementAccess({ db: this.db, actorId: userId, multiUser: true }, engagementId, 'viewer');
    const row = await this.retainedCapture(engagementId, captureId);
    await this.assertCaptureReadable(row, access.role);
    const missing = (): never => { throw new ProjectApiError(409, 'The retained capture file is missing from storage, so its integrity cannot be verified.'); };
    // A recorded capture whose bytes were removed from storage is an explicit conflict, not a generic artifact 404 or a 500.
    const file = await this.artifactFile(userId, engagementId, row.path).catch((error: unknown) => (error instanceof ProjectPolicyError && error.code === 'not_found' ? missing() : Promise.reject(error)));
    const bytes = await readFile(file).catch((error: unknown) => ((error as NodeJS.ErrnoException).code === 'ENOENT' ? missing() : Promise.reject(error)));
    if (bytes.length !== row.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== row.digest) {
      throw new ProjectApiError(409, 'The retained capture failed its recorded integrity check.');
    }
    return { capture: this.toCaptureView(row, access.role), bytes };
  }
}
