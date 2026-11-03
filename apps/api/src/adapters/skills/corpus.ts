import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  path: string;
  subdomain?: string;
  updatedAt: Date;
  fileCount: number;
}

export interface SkillDetail extends SkillSummary {
  content: string;
}

/**
 * Port over Raptix's real skill corpus (packages/raptix-skills/raptix_skills/defs/,
 * a Git-authored Markdown/YAML tree -- see skills.routes.ts's module comment
 * for why writes stay stubbed). Read-only: lists/reads SKILL.md and its
 * sibling files directly off disk, never through Skillogy (whose find/load
 * ops require a filter apps/ui-app's unfiltered list view can't supply).
 */
export interface SkillsCorpus {
  list(): Promise<SkillSummary[]>;
  get(name: string): Promise<SkillDetail | null>;
  listFiles(name: string): Promise<string[]>;
  readFile(name: string, relPath: string): Promise<string | null>;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function splitFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const [, frontmatter, body] = match;
  try {
    // A few SKILL.md files repeat a metadata key by hand-authoring slip (e.g. `subdomain:`
    // twice); the corpus is read-only display here, not an authority to reject -- tolerate
    // it the same way a lenient YAML reader would (last value wins) instead of losing the
    // whole skill's metadata to a strict-mode parse error.
    const parsed = parseYaml(frontmatter ?? "", { uniqueKeys: false });
    return { meta: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}, body: body ?? "" };
  } catch {
    return { meta: {}, body: body ?? "" };
  }
}

/** Frontmatter's `tags`/`mitre_attack` are comma-separated scalars (`tags: a, b, c`), not YAML lists. */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function findSkillDirs(rootDir: string): Promise<{ name: string; dir: string; relPath: string }[]> {
  const found: { name: string; dir: string; relPath: string }[] = [];
  async function walk(dir: string, relPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // A directory with its own SKILL.md is itself a skill, but the corpus also nests
    // further skills under some of those same directories (e.g. standard/ad/SKILL.md
    // alongside standard/ad/kerberoasting/SKILL.md) -- always keep descending. A plain
    // package subdirectory (references/, scripts/) simply has no SKILL.md anywhere
    // below it, so it contributes nothing here.
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      found.push({ name: path.basename(dir), dir, relPath });
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relPath ? `${relPath}/${entry.name}` : entry.name);
    }
  }
  await walk(rootDir, "");
  return found;
}

/** A subdirectory holding its own SKILL.md is a nested skill, not this skill's package content -- never descend into one. */
async function isNestedSkillDir(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
}

/** Counts a skill's package files recursively (references/, scripts/, ...), excluding SKILL.md itself and any nested skill. */
async function countFiles(dir: string, relPath = ""): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.name === "SKILL.md" && relPath === "") continue;
    if (entry.isDirectory()) {
      const childDir = path.join(dir, entry.name);
      if (await isNestedSkillDir(childDir)) continue;
      count += await countFiles(childDir, `${relPath}/${entry.name}`);
    } else count += 1;
  }
  return count;
}

async function loadSummary(dirName: string, dir: string, relPath: string): Promise<SkillSummary | null> {
  let raw: string;
  let mtime: Date;
  try {
    [raw, mtime] = await Promise.all([readFile(path.join(dir, "SKILL.md"), "utf8"), stat(path.join(dir, "SKILL.md")).then((s) => s.mtime)]);
  } catch {
    return null;
  }
  const { meta } = splitFrontmatter(raw);
  const metadata = record(meta.metadata);
  const fileCount = await countFiles(dir);
  return {
    id: typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : dirName,
    name: typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : dirName,
    description: typeof meta.description === "string" ? meta.description.trim() : "",
    tags: toStringList(metadata.tags),
    path: relPath,
    ...(typeof metadata.subdomain === "string" && metadata.subdomain.trim() ? { subdomain: metadata.subdomain.trim() } : {}),
    updatedAt: mtime,
    fileCount,
  };
}

export class FilesystemSkillsCorpus implements SkillsCorpus {
  public constructor(private readonly rootDir: string) {}

  private async findByName(name: string): Promise<{ dir: string; relPath: string } | null> {
    const dirs = await findSkillDirs(this.rootDir);
    for (const candidate of dirs) {
      const summary = await loadSummary(candidate.name, candidate.dir, candidate.relPath);
      if (summary && summary.id === name) return { dir: candidate.dir, relPath: candidate.relPath };
    }
    return null;
  }

  public async list(): Promise<SkillSummary[]> {
    const dirs = await findSkillDirs(this.rootDir);
    const summaries = await Promise.all(dirs.map((entry) => loadSummary(entry.name, entry.dir, entry.relPath)));
    return summaries.filter((summary): summary is SkillSummary => summary !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  public async get(name: string): Promise<SkillDetail | null> {
    const found = await this.findByName(name);
    if (!found) return null;
    const raw = await readFile(path.join(found.dir, "SKILL.md"), "utf8").catch(() => null);
    if (raw === null) return null;
    const summary = await loadSummary(path.basename(found.dir), found.dir, found.relPath);
    if (!summary) return null;
    const { body } = splitFrontmatter(raw);
    return { ...summary, content: body.trim() };
  }

  public async listFiles(name: string): Promise<string[]> {
    const found = await this.findByName(name);
    if (!found) return [];
    const files: string[] = [];
    async function walk(dir: string, relPath: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name === "SKILL.md" && relPath === "") continue;
        const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const childDir = path.join(dir, entry.name);
          if (await isNestedSkillDir(childDir)) continue;
          await walk(childDir, entryRel);
        } else files.push(entryRel);
      }
    }
    await walk(found.dir, "");
    return files.sort();
  }

  public async readFile(name: string, relPath: string): Promise<string | null> {
    if (!relPath || relPath.includes("..") || path.isAbsolute(relPath)) return null;
    const found = await this.findByName(name);
    if (!found) return null;
    return readFile(path.join(found.dir, relPath), "utf8").catch(() => null);
  }
}

/** Used when no real corpus directory is reachable -- Skills routes degrade to empty lists, never a crash. */
export class EmptySkillsCorpus implements SkillsCorpus {
  public async list(): Promise<SkillSummary[]> {
    return [];
  }
  public async get(): Promise<SkillDetail | null> {
    return null;
  }
  public async listFiles(): Promise<string[]> {
    return [];
  }
  public async readFile(): Promise<string | null> {
    return null;
  }
}
