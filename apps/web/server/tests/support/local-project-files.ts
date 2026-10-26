import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProjectFileError,
  ProjectFileExistsError,
  projectFilePath,
  projectSlug,
  type ProjectDirEntry,
  type ProjectFileStat,
  type ProjectFiles,
  type ProjectTree,
  type ProjectTreeEntry,
} from '../../src/services/project-files.js';

/**
 * A test double for the project files port. It keeps each project under a temporary root, in the layout
 * `<root>/<slug>/<rel>`, which mirrors the sandbox's /workspace for that project. Production never uses it.
 */
export class LocalProjectFiles implements ProjectFiles {
  public constructor(private readonly root: string) {}

  private at(workspaceSlug: string, rel: string): string {
    return path.join(this.root, projectSlug(workspaceSlug), projectFilePath(rel));
  }

  public async read(workspaceSlug: string, rel: string): Promise<Buffer | null> {
    const target = this.at(workspaceSlug, rel);
    try {
      return await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ProjectFileError();
    }
  }

  public async write(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const target = this.at(workspaceSlug, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  public async writeNew(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const target = this.at(workspaceSlug, rel);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, data, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ProjectFileExistsError();
      throw new ProjectFileError();
    }
  }

  public async append(workspaceSlug: string, rel: string, data: Buffer): Promise<void> {
    const target = this.at(workspaceSlug, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, data);
  }

  public async rename(workspaceSlug: string, from: string, to: string): Promise<void> {
    const target = this.at(workspaceSlug, to);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(this.at(workspaceSlug, from), target);
  }

  public async remove(workspaceSlug: string, rel: string): Promise<void> {
    await rm(this.at(workspaceSlug, rel), { force: true });
  }

  public async tree(workspaceSlug: string, limit: number): Promise<ProjectTree> {
    const root = path.join(this.root, projectSlug(workspaceSlug));
    const entries: ProjectTreeEntry[] = [];
    const pending = [root];
    for (let dir = pending.shift(); dir !== undefined; dir = pending.shift()) {
      let children;
      try {
        children = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new ProjectFileError();
      }
      for (const child of children) {
        if (entries.length === limit) return { entries, truncated: true };
        const full = path.join(dir, child.name);
        const info = await stat(full);
        entries.push({ path: path.relative(root, full).split(path.sep).join('/'), isDirectory: child.isDirectory(), size: info.size, mtime: info.mtime });
        if (child.isDirectory()) pending.push(full);
      }
    }
    return { entries, truncated: false };
  }

  public async list(workspaceSlug: string, rel: string): Promise<ProjectDirEntry[] | null> {
    const dir = rel === '' ? path.join(this.root, projectSlug(workspaceSlug)) : this.at(workspaceSlug, rel);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ProjectFileError();
    }
  }

  public async mkdir(workspaceSlug: string, rel: string): Promise<void> {
    await mkdir(this.at(workspaceSlug, rel), { recursive: true });
  }

  public async stat(workspaceSlug: string, rel: string): Promise<ProjectFileStat | null> {
    const target = this.at(workspaceSlug, rel);
    try {
      const info = await stat(target);
      return { size: info.size, mtime: info.mtime, isFile: info.isFile(), isDirectory: info.isDirectory() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ProjectFileError();
    }
  }

  public async exists(workspaceSlug: string, rel: string): Promise<boolean> {
    const target = this.at(workspaceSlug, rel);
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }
}

