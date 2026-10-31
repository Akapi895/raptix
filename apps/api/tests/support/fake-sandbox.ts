import type { SandboxDirEntry, SandboxFileStat, SandboxFilesTransport } from "../../src/adapters/sandbox/client.js";
import { SandboxUnavailableError } from "../../src/adapters/sandbox/errors.js";

/** In-memory per-slug filesystem for files.routes.ts / hitl tests -- no network, no Docker. */
export class FakeSandbox implements SandboxFilesTransport {
  private readonly files = new Map<string, Map<string, Buffer>>();
  public unavailableSlugs = new Set<string>();

  private tree(slug: string): Map<string, Buffer> {
    let tree = this.files.get(slug);
    if (!tree) {
      tree = new Map();
      this.files.set(slug, tree);
    }
    return tree;
  }

  private guard(slug: string): void {
    if (this.unavailableSlugs.has(slug)) throw new SandboxUnavailableError();
  }

  public async read(slug: string, rel: string): Promise<Buffer | null> {
    this.guard(slug);
    return this.tree(slug).get(rel) ?? null;
  }

  public async write(slug: string, rel: string, data: Buffer): Promise<void> {
    this.guard(slug);
    this.tree(slug).set(rel, data);
  }

  public async append(slug: string, rel: string, data: Buffer): Promise<void> {
    this.guard(slug);
    const tree = this.tree(slug);
    const existing = tree.get(rel);
    tree.set(rel, existing ? Buffer.concat([existing, data]) : data);
  }

  public async rename(slug: string, from: string, to: string): Promise<void> {
    this.guard(slug);
    const tree = this.tree(slug);
    const data = tree.get(from);
    if (data === undefined) throw new SandboxUnavailableError();
    tree.delete(from);
    tree.set(to, data);
  }

  public async remove(slug: string, rel: string): Promise<void> {
    this.guard(slug);
    this.tree(slug).delete(rel);
  }

  public async list(slug: string, rel: string): Promise<SandboxDirEntry[] | null> {
    this.guard(slug);
    const prefix = rel ? `${rel}/` : "";
    const names = new Set<string>();
    const entries: SandboxDirEntry[] = [];
    for (const path of this.tree(slug).keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [name, ...more] = rest.split("/");
      if (!name || names.has(name)) continue;
      names.add(name);
      entries.push({ name, isDirectory: more.length > 0 });
    }
    return entries;
  }

  public async mkdir(slug: string, _rel: string): Promise<void> {
    this.guard(slug);
  }

  public async stat(slug: string, rel: string): Promise<SandboxFileStat | null> {
    this.guard(slug);
    const data = this.tree(slug).get(rel);
    if (data === undefined) return null;
    return { size: data.length, mtime: new Date(), isFile: true, isDirectory: false };
  }
}
