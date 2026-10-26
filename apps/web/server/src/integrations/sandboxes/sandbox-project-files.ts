import { randomUUID } from 'node:crypto';
import { ProjectApiError } from '../../services/projects-service.js';
import {
  ProjectFileError,
  ProjectFileExistsError,
  projectFilePath,
  projectParentDir,
  projectSlug,
  type ProjectDirEntry,
  type ProjectFileStat,
  type ProjectFiles,
  type ProjectTree,
} from '../../services/project-files.js';
import { sandboxTokenFor, sandboxUrlFor } from '../../services/runtime/sandbox-routing.js';

/** The sandbox's view of a project's workspace root. Every project's sandbox mounts its volume there (ADR-0102). */
const WORKSPACE = '/workspace';
const MAX_READ_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

/** Single-quotes a path for `sh`. Paths here are validated by projectFilePath, so no character needs escaping. */
function quote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

interface DaemonFileResult { path: string; data_b64?: string | null; error?: string | null }

/**
 * The project files, reached through the project's own sandbox daemon with that project's token (ADR-0102). The API
 * holds the sandbox key and derives each token; it never mounts a project volume.
 */
export class SandboxProjectFiles implements ProjectFiles {
  public constructor(
    private readonly sandboxKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  private async call(workspaceSlug: string, endpoint: string, body: unknown): Promise<Record<string, unknown>> {
    const url = `${sandboxUrlFor(projectSlug(workspaceSlug))}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${sandboxTokenFor(this.sandboxKey, workspaceSlug)}` },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) throw new ProjectFileError();
      const value = (await response.json()) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProjectFileError();
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ProjectApiError) throw error;
      throw new ProjectFileError();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs one command in the project's container and returns its output and exit code. */
  private async execute(workspaceSlug: string, command: string): Promise<{ output: string; exitCode: number | null }> {
    const value = await this.call(workspaceSlug, '/execute', { command, timeout: 60 });
    if (typeof value.output !== 'string') throw new ProjectFileError();
    const exitCode = typeof value.exit_code === 'number' ? value.exit_code : null;
    return { output: value.output, exitCode };
  }

  private async upload(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const value = await this.call(workspaceSlug, '/upload_files', {
      files: [{ path: `${WORKSPACE}/${rel}`, data_b64: data.toString('base64') }],
    });
    const files = Array.isArray(value.files) ? (value.files as DaemonFileResult[]) : [];
    if (files.length !== 1 || files[0]?.error) throw new ProjectFileError();
  }

  public async read(workspaceSlug: string, rel: string): Promise<Buffer | null> {
    const path = projectFilePath(rel);
    // The daemon refuses a server-side bound above its 256 kB download cap, so the bound is applied here instead.
    const value = await this.call(workspaceSlug, '/download_files', { paths: [`${WORKSPACE}/${path}`] });
    const files = Array.isArray(value.files) ? (value.files as DaemonFileResult[]) : [];
    const first = files[0];
    if (files.length !== 1 || first === undefined) throw new ProjectFileError();
    if (first.error === 'file_not_found') return null;
    if (first.error || typeof first.data_b64 !== 'string') throw new ProjectFileError();
    const data = Buffer.from(first.data_b64, 'base64');
    if (data.length > MAX_READ_BYTES) throw new ProjectFileError();
    return data;
  }

  public async write(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    await this.upload(workspaceSlug, projectFilePath(rel), data);
  }

  /**
   * A create-only write. The bytes go to a temporary file in the same directory, and a hard link to the final name
   * then fails when that name exists. The link is the atomic step, so two writers never both succeed.
   */
  public async writeNew(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const path = projectFilePath(rel);
    const dir = projectParentDir(path);
    const temporary = `${dir === '' ? '' : `${dir}/`}.incoming-${randomUUID()}`;
    await this.upload(workspaceSlug, temporary, data);
    const mkdir = dir === '' ? '' : `mkdir -p ${quote(`${WORKSPACE}/${dir}`)} && `;
    const result = await this.execute(
      workspaceSlug,
      `${mkdir}ln ${quote(`${WORKSPACE}/${temporary}`)} ${quote(`${WORKSPACE}/${path}`)}; status=$?; rm -f ${quote(`${WORKSPACE}/${temporary}`)}; exit $status`,
    );
    if (result.exitCode === 0) return;
    if (/File exists/i.test(result.output)) throw new ProjectFileExistsError();
    throw new ProjectFileError();
  }

  public async append(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const path = projectFilePath(rel);
    const dir = projectParentDir(path);
    const mkdir = dir === '' ? '' : `mkdir -p ${quote(`${WORKSPACE}/${dir}`)} && `;
    const result = await this.execute(
      workspaceSlug,
      `${mkdir}printf '%s' '${data.toString('base64')}' | base64 -d >> ${quote(`${WORKSPACE}/${path}`)}`,
    );
    if (result.exitCode !== 0) throw new ProjectFileError();
  }

  public async rename(workspaceSlug: string, from: string, to: string): Promise<void> {
    const result = await this.execute(workspaceSlug, `mv -f -- ${quote(`${WORKSPACE}/${projectFilePath(from)}`)} ${quote(`${WORKSPACE}/${projectFilePath(to)}`)}`);
    if (result.exitCode !== 0) throw new ProjectFileError();
  }

  public async remove(workspaceSlug: string, rel: string): Promise<void> {
    const result = await this.execute(workspaceSlug, `rm -f -- ${quote(`${WORKSPACE}/${projectFilePath(rel)}`)}`);
    if (result.exitCode !== 0) throw new ProjectFileError();
  }

  public async list(workspaceSlug: string, rel: string): Promise<ProjectDirEntry[] | null> {
    const dir = rel === '' ? WORKSPACE : `${WORKSPACE}/${projectFilePath(rel)}`;
    const result = await this.execute(workspaceSlug, `find ${quote(dir)} -mindepth 1 -maxdepth 1 -printf '%y %f\\n'`);
    if (result.exitCode !== 0) {
      if (/No such file or directory/i.test(result.output)) return null;
      throw new ProjectFileError();
    }
    return result.output
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => ({ name: line.slice(2), isDirectory: line.startsWith('d ') }));
  }

  /** One find over the whole workspace; the head bound keeps the output to the requested size. */
  public async tree(workspaceSlug: string, limit: number): Promise<ProjectTree> {
    const result = await this.execute(
      workspaceSlug,
      `find ${quote(WORKSPACE)} -mindepth 1 -printf '%y\\t%s\\t%T@\\t%P\\n' | head -n ${limit + 1}`,
    );
    if (result.exitCode !== 0) throw new ProjectFileError();
    const lines = result.output.split('\n').filter(line => line.length > 0);
    const entries = lines.slice(0, limit).map(line => {
      const [kind = '', size = '0', mtime = '0', ...path] = line.split('\t');
      return { path: path.join('\t'), isDirectory: kind === 'd', size: Number(size), mtime: new Date(Number(mtime) * 1000) };
    });
    return { entries, truncated: lines.length > limit };
  }

  public async mkdir(workspaceSlug: string, rel: string): Promise<void> {
    await this.call(workspaceSlug, '/workspace/ensure', { path: `${WORKSPACE}/${projectFilePath(rel)}` });
  }

  public async stat(workspaceSlug: string, rel: string): Promise<ProjectFileStat | null> {
    const result = await this.execute(workspaceSlug, `stat -c '%s %Y %F' -- ${quote(`${WORKSPACE}/${projectFilePath(rel)}`)}`);
    if (result.exitCode !== 0) {
      if (/No such file or directory/i.test(result.output)) return null;
      throw new ProjectFileError();
    }
    const match = /^(\d+) (\d+) (.+)$/m.exec(result.output.trim());
    if (match === null) throw new ProjectFileError();
    const type = match[3] ?? '';
    return {
      size: Number(match[1]),
      mtime: new Date(Number(match[2]) * 1000),
      isFile: type === 'regular file' || type === 'regular empty file',
      isDirectory: type === 'directory',
    };
  }

  public async exists(workspaceSlug: string, rel: string): Promise<boolean> {
    const result = await this.execute(workspaceSlug, `test -e ${quote(`${WORKSPACE}/${projectFilePath(rel)}`)}`);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw new ProjectFileError();
  }
}
