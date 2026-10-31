import { SandboxInvalidPathError, SandboxUnavailableError } from "./errors.js";
import { sandboxTokenFor, sandboxUrlFor } from "./routing.js";

const WORKSPACE = "/workspace";
const MAX_READ_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_DEPTH = 8;
const MAX_PATH_LENGTH = 512;

/** Validates a path relative to a project's /workspace: plain segments only, no absolute path, no traversal. */
export function sandboxFilePath(rel: string): string {
  if (rel.length === 0 || rel.length > MAX_PATH_LENGTH) throw new SandboxInvalidPathError();
  const segments = rel.split("/");
  if (segments.length > MAX_DEPTH || segments.some((segment) => !SEGMENT.test(segment))) {
    throw new SandboxInvalidPathError();
  }
  return segments.join("/");
}

function parentDir(rel: string): string {
  const cut = rel.lastIndexOf("/");
  return cut < 0 ? "" : rel.slice(0, cut);
}

/** Single-quotes a path for `sh`. Paths here are validated by sandboxFilePath, so no character needs escaping. */
function quote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export interface SandboxDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface SandboxFileStat {
  readonly size: number;
  readonly mtime: Date;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

interface DaemonFileResult {
  path: string;
  data_b64?: string | null;
  error?: string | null;
}

/**
 * Port for project-sandbox file access (ADR-0102). Routes are never given
 * this directly -- they go through conversation/project resolution first
 * (see files.routes.ts). Ported from the retired apps/web/server's
 * SandboxProjectFiles (recoverable from git history prior to the ADR-0106
 * deletion commit): same sandbox daemon protocol (`/execute`,
 * `/upload_files`, `/download_files`, `/workspace/ensure`), same auth
 * (Bearer `sandboxTokenFor(key, slug)`).
 */
export interface SandboxFilesTransport {
  read(workspaceSlug: string, rel: string): Promise<Buffer | null>;
  write(workspaceSlug: string, rel: string, data: Buffer): Promise<void>;
  rename(workspaceSlug: string, from: string, to: string): Promise<void>;
  remove(workspaceSlug: string, rel: string): Promise<void>;
  list(workspaceSlug: string, rel: string): Promise<SandboxDirEntry[] | null>;
  mkdir(workspaceSlug: string, rel: string): Promise<void>;
  stat(workspaceSlug: string, rel: string): Promise<SandboxFileStat | null>;
  /** Appends bytes, creating the file and its parent directories when needed. Used by hitl.routes.ts's decisions log. */
  append(workspaceSlug: string, rel: string, data: Buffer): Promise<void>;
}

export class SandboxFilesClient implements SandboxFilesTransport {
  public constructor(
    private readonly sandboxKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  private async call(workspaceSlug: string, endpoint: string, body: unknown): Promise<Record<string, unknown>> {
    const url = `${sandboxUrlFor(workspaceSlug)}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sandboxTokenFor(this.sandboxKey, workspaceSlug)}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new SandboxUnavailableError();
      const value = (await response.json()) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SandboxUnavailableError();
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SandboxUnavailableError || error instanceof SandboxInvalidPathError) throw error;
      throw new SandboxUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }

  private async execute(workspaceSlug: string, command: string): Promise<{ output: string; exitCode: number | null }> {
    const value = await this.call(workspaceSlug, "/execute", { command, timeout: 60 });
    if (typeof value.output !== "string") throw new SandboxUnavailableError();
    const exitCode = typeof value.exit_code === "number" ? value.exit_code : null;
    return { output: value.output, exitCode };
  }

  private async upload(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const value = await this.call(workspaceSlug, "/upload_files", {
      files: [{ path: `${WORKSPACE}/${rel}`, data_b64: data.toString("base64") }],
    });
    const files = Array.isArray(value.files) ? (value.files as DaemonFileResult[]) : [];
    if (files.length !== 1 || files[0]?.error) throw new SandboxUnavailableError();
  }

  public async read(workspaceSlug: string, rel: string): Promise<Buffer | null> {
    const path = sandboxFilePath(rel);
    const value = await this.call(workspaceSlug, "/download_files", { paths: [`${WORKSPACE}/${path}`] });
    const files = Array.isArray(value.files) ? (value.files as DaemonFileResult[]) : [];
    const first = files[0];
    if (files.length !== 1 || first === undefined) throw new SandboxUnavailableError();
    if (first.error === "file_not_found") return null;
    if (first.error || typeof first.data_b64 !== "string") throw new SandboxUnavailableError();
    const data = Buffer.from(first.data_b64, "base64");
    if (data.length > MAX_READ_BYTES) throw new SandboxUnavailableError();
    return data;
  }

  public async write(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    await this.upload(workspaceSlug, sandboxFilePath(rel), data);
  }

  public async append(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const path = sandboxFilePath(rel);
    const dir = parentDir(path);
    const mkdir = dir === "" ? "" : `mkdir -p ${quote(`${WORKSPACE}/${dir}`)} && `;
    const result = await this.execute(
      workspaceSlug,
      `${mkdir}printf '%s' '${data.toString("base64")}' | base64 -d >> ${quote(`${WORKSPACE}/${path}`)}`,
    );
    if (result.exitCode !== 0) throw new SandboxUnavailableError();
  }

  public async rename(workspaceSlug: string, from: string, to: string): Promise<void> {
    const result = await this.execute(
      workspaceSlug,
      `mv -f -- ${quote(`${WORKSPACE}/${sandboxFilePath(from)}`)} ${quote(`${WORKSPACE}/${sandboxFilePath(to)}`)}`,
    );
    if (result.exitCode !== 0) throw new SandboxUnavailableError();
  }

  public async remove(workspaceSlug: string, rel: string): Promise<void> {
    const result = await this.execute(workspaceSlug, `rm -f -- ${quote(`${WORKSPACE}/${sandboxFilePath(rel)}`)}`);
    if (result.exitCode !== 0) throw new SandboxUnavailableError();
  }

  public async list(workspaceSlug: string, rel: string): Promise<SandboxDirEntry[] | null> {
    const dir = rel === "" ? WORKSPACE : `${WORKSPACE}/${sandboxFilePath(rel)}`;
    const result = await this.execute(workspaceSlug, `find ${quote(dir)} -mindepth 1 -maxdepth 1 -printf '%y %f\\n'`);
    if (result.exitCode !== 0) {
      if (/No such file or directory/i.test(result.output)) return null;
      throw new SandboxUnavailableError();
    }
    return result.output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => ({ name: line.slice(2), isDirectory: line.startsWith("d ") }));
  }

  public async mkdir(workspaceSlug: string, rel: string): Promise<void> {
    await this.call(workspaceSlug, "/workspace/ensure", { path: `${WORKSPACE}/${sandboxFilePath(rel)}` });
  }

  public async stat(workspaceSlug: string, rel: string): Promise<SandboxFileStat | null> {
    const result = await this.execute(workspaceSlug, `stat -c '%s %Y %F' -- ${quote(`${WORKSPACE}/${sandboxFilePath(rel)}`)}`);
    if (result.exitCode !== 0) {
      if (/No such file or directory/i.test(result.output)) return null;
      throw new SandboxUnavailableError();
    }
    const match = /^(\d+) (\d+) (.+)$/m.exec(result.output.trim());
    if (match === null) throw new SandboxUnavailableError();
    const type = match[3] ?? "";
    return {
      size: Number(match[1]),
      mtime: new Date(Number(match[2]) * 1000),
      isFile: type === "regular file" || type === "regular empty file",
      isDirectory: type === "directory",
    };
  }
}

/** Used when RAPTIX_SANDBOX_KEY_FILE is not configured -- Files/Storage routes fail 503 instead of crashing startup. */
export class UnconfiguredSandboxFilesClient implements SandboxFilesTransport {
  private fail(): never {
    throw new SandboxUnavailableError("RAPTIX_SANDBOX_KEY_FILE is not configured for this deployment.");
  }
  public read = (): Promise<Buffer | null> => this.fail();
  public write = (): Promise<void> => this.fail();
  public rename = (): Promise<void> => this.fail();
  public remove = (): Promise<void> => this.fail();
  public list = (): Promise<SandboxDirEntry[] | null> => this.fail();
  public mkdir = (): Promise<void> => this.fail();
  public stat = (): Promise<SandboxFileStat | null> => this.fail();
  public append = (): Promise<void> => this.fail();
}
