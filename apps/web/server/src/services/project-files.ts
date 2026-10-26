import { isProjectSlug, ProjectPolicyError } from '../security/project-policy.js';
import { ProjectApiError } from './projects-service.js';

/**
 * The files of one project (ADR-0102). A project's files exist only in its own sandbox, under /workspace. The API
 * reaches them through this port and never mounts a project volume, so a path here is always relative to the
 * project's /workspace and never names the project.
 */
export interface ProjectDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/** One entry under a project's /workspace: its path relative to /workspace, '/'-separated. */
export interface ProjectTreeEntry {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly mtime: Date;
}

/** The project's /workspace listing: at most the requested number of entries, shallowest first. */
export interface ProjectTree {
  readonly entries: ProjectTreeEntry[];
  /** True when the workspace holds more entries than were returned. */
  readonly truncated: boolean;
}

export interface ProjectFileStat {
  readonly size: number;
  readonly mtime: Date;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export interface ProjectFiles {
  /** The entry's size and modification time, or null when nothing exists at the path. */
  stat(workspaceSlug: string, rel: string): Promise<ProjectFileStat | null>;
  /** The file's bytes, or null when no file exists at the path. */
  read(workspaceSlug: string, rel: string): Promise<Buffer | null>;
  /** Creates or replaces the file, and creates its parent directories. */
  write(workspaceSlug: string, rel: string, data: Buffer): Promise<void>;
  /** Appends bytes to the file, creating it and its parent directories when needed. */
  append(workspaceSlug: string, rel: string, data: Buffer): Promise<void>;
  /** Creates the file only when nothing exists at the path. */
  writeNew(workspaceSlug: string, rel: string, data: Buffer): Promise<void>;
  rename(workspaceSlug: string, from: string, to: string): Promise<void>;
  remove(workspaceSlug: string, rel: string): Promise<void>;
  /** The directory's entries, or null when the directory does not exist. */
  list(workspaceSlug: string, rel: string): Promise<ProjectDirEntry[] | null>;
  /** Every entry under /workspace, shallowest first, at most `limit` of them. */
  tree(workspaceSlug: string, limit: number): Promise<ProjectTree>;
  mkdir(workspaceSlug: string, rel: string): Promise<void>;
  exists(workspaceSlug: string, rel: string): Promise<boolean>;
}

/** The sandbox could not complete the file operation. The reason stays server-side; the caller gets this only. */
export class ProjectFileError extends ProjectApiError {
  public constructor() { super(503, 'The project sandbox could not complete the file operation. Retry when the project sandbox is running.'); }
}

/** A file already exists at the path of a create-only write. */
export class ProjectFileExistsError extends ProjectApiError {
  public constructor() { super(409, 'A file already exists at this path.'); }
}

/**
 * The slug names the project's sandbox host and token, so it is checked before any file operation touches either.
 */
export function projectSlug(workspaceSlug: string): string {
  if (!isProjectSlug(workspaceSlug)) throw new ProjectPolicyError('bad_request', 'The project slug is invalid.');
  return workspaceSlug;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_DEPTH = 8;
const MAX_PATH_LENGTH = 512;

/**
 * Validates a path relative to a project's /workspace. Segments are plain names, so there is no absolute path, no
 * traversal, and no character that needs shell quoting beyond the single quotes the sandbox commands add.
 */
export function projectFilePath(rel: string): string {
  if (rel.length === 0 || rel.length > MAX_PATH_LENGTH) throw new ProjectApiError(400, 'Invalid project file path.');
  const segments = rel.split('/');
  if (segments.length > MAX_DEPTH || segments.some(segment => !SEGMENT.test(segment))) throw new ProjectApiError(400, 'Invalid project file path.');
  return segments.join('/');
}

/** The directory part of a relative path, or '' for a file at the root of /workspace. */
export function projectParentDir(rel: string): string {
  const cut = rel.lastIndexOf('/');
  return cut < 0 ? '' : rel.slice(0, cut);
}
