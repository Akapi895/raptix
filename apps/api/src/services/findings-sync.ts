import { parse as parseYaml } from "yaml";
import type { SandboxFilesTransport } from "../adapters/sandbox/client.js";
import type { VulnerabilityStore } from "../db/vulnerability-store.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

interface ParsedFinding {
  findingId: string;
  title: string;
  severity: string;
  type: string;
  target: string;
  description: string;
}

function parseFinding(raw: string, fallbackId: string): ParsedFinding | null {
  const match = FRONTMATTER.exec(raw);
  if (!match) return null;
  const [, frontmatter, body] = match;
  let meta: Record<string, unknown>;
  try {
    meta = record(parseYaml(frontmatter ?? "", { uniqueKeys: false }));
  } catch {
    return null;
  }
  const findingId = asString(meta.id) || fallbackId;
  const title = asString(meta.title) || findingId;
  return {
    findingId,
    title,
    severity: asString(meta.severity) || "info",
    type: asString(meta.cwe) || asString(meta.vrt),
    target: asString(meta.location),
    description: (body ?? "").trim(),
  };
}

/**
 * Raptix's real recon/exploit output writes one Markdown finding per file
 * under a project sandbox's workspace/findings/ (FIND-001.md, ...), never
 * directly into apps/api's Vulnerability table -- see
 * vulnerabilities.routes.ts, whose GET route calls this first so the page
 * shows real findings instead of staying empty. Idempotent: each finding's
 * own `id` frontmatter field is kept in `taskTag` as the dedup key, so
 * re-running never creates duplicates and never overwrites an operator's
 * own edits (status, retest notes, ...) to an already-imported row.
 */
export async function syncFindingsForProject(
  sandbox: SandboxFilesTransport,
  vulnerabilityStore: VulnerabilityStore,
  projectId: string,
  workspaceSlug: string,
): Promise<void> {
  const entries = await sandbox.list(workspaceSlug, "findings").catch(() => null);
  if (!entries) return;
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.toLowerCase().endsWith(".md")) continue;
    const raw = await sandbox.read(workspaceSlug, `findings/${entry.name}`).catch(() => null);
    if (!raw) continue;
    const parsed = parseFinding(raw.toString("utf8"), entry.name.replace(/\.md$/i, ""));
    if (!parsed) continue;
    const existing = await vulnerabilityStore.list({ projectId, taskTag: parsed.findingId, limit: 1, offset: 0 });
    if (existing.total > 0) continue;
    await vulnerabilityStore.create({
      projectId,
      taskTag: parsed.findingId,
      title: parsed.title,
      severity: parsed.severity,
      description: parsed.description,
      type: parsed.type,
      target: parsed.target,
      status: "open",
    });
  }
}
