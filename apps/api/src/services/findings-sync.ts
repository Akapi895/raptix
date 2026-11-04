import { createHash } from "node:crypto";
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
  evidence: string;
  reproductionSteps: string;
  pocBlock: Record<string, unknown> | null;
}

/**
 * Splits a finding body into its named `## Heading` sections, per
 * finding-protocol's Description/Evidence/Proof of Concept/Verification/Next
 * structure (packages/raptix-skills/.../shared/finding-protocol/SKILL.md).
 * Keyed by lowercased heading text; a heading absent from the body is simply
 * absent from the result, never fabricated.
 */
function sections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // `(?![\s\S])` (not bare `$`) for "end of string": with the `m` flag, a bare `$`
  // matches at every line end, which would cut each section off after its first line.
  const re = /^##\s+(.+?)\s*\r?\n([\s\S]*?)(?=\r?\n##\s+|(?![\s\S]))/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) out[match[1]!.trim().toLowerCase()] = (match[2] ?? "").trim();
  return out;
}

/**
 * Extracts the sealed PoC block -- the full JSON object, not just one field --
 * from the fenced ```json block under "## Proof of Concept", mirroring
 * finding-protocol's own seal-verification regex
 * (execution/tools/plumbing/candidate_verification.py's POC_BLOCK).
 */
function pocBlock(pocSection: string): Record<string, unknown> | null {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(pocSection);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1] ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The seal over a PoC block: SHA-256 of its canonical JSON (keys sorted, compact
 * separators, non-ASCII left as-is) with `spec_sha256` itself excluded -- the exact
 * recipe candidate_verification.py's seal_of() uses, so a block sealed by the Python
 * side verifies identically here.
 */
function sealOf(block: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(block).filter((k) => k !== "spec_sha256").sort()) body[key] = block[key];
  return createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
}

interface VerificationRecord {
  verdict?: unknown;
  spec_sha256?: unknown;
}

/**
 * Independently re-derives whether a finding is really confirmed, instead of trusting
 * its frontmatter `status:` line -- a generator agent with bash can write `status:
 * confirmed` directly, with no verifier involved (ADR-0103's own "Limits" section flags
 * this as unclosed). Trusted only when: the PoC block's own stored seal still matches a
 * freshly recomputed seal (the block was not edited since it was sealed), AND
 * findings/evidence/{id}_verification.json exists, parses, and was recorded against
 * that exact same seal. Anything else -- no PoC, no verification file, a seal that no
 * longer matches, an unparseable record -- downgrades to "candidate".
 */
async function readVerificationVerdict(
  sandbox: SandboxFilesTransport,
  workspaceSlug: string,
  findingId: string,
  block: Record<string, unknown> | null,
): Promise<string> {
  if (!block) return "candidate";
  const currentSeal = sealOf(block);
  if (block.spec_sha256 !== currentSeal) return "candidate";
  const raw = await sandbox.read(workspaceSlug, `findings/evidence/${findingId}_verification.json`).catch(() => null);
  if (!raw) return "candidate";
  let parsedRecord: VerificationRecord;
  try {
    parsedRecord = JSON.parse(raw.toString("utf8")) as VerificationRecord;
  } catch {
    return "candidate";
  }
  if (parsedRecord.spec_sha256 !== currentSeal) return "candidate"; // record is for a different (stale) seal
  return parsedRecord.verdict === "confirmed" || parsedRecord.verdict === "rejected"
    ? parsedRecord.verdict
    : "candidate";
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
  const parts = sections(body ?? "");
  const poc = parts["proof of concept"] ?? "";
  const block = pocBlock(poc);
  return {
    findingId,
    title,
    severity: asString(meta.severity) || "info",
    type: asString(meta.cwe) || asString(meta.vrt),
    target: asString(meta.location),
    // Legacy/malformed findings with no `## ` headings fall back to the whole body,
    // same as before this change -- never worse than the previous behavior.
    description: parts["description"] ?? (body ?? "").trim(),
    evidence: [parts["evidence"], poc].filter(Boolean).join("\n\n"),
    reproductionSteps: typeof block?.command === "string" ? block.command : "",
    pocBlock: block,
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
    const verificationVerdict = await readVerificationVerdict(sandbox, workspaceSlug, parsed.findingId, parsed.pocBlock);
    await vulnerabilityStore.create({
      projectId,
      taskTag: parsed.findingId,
      title: parsed.title,
      severity: parsed.severity,
      description: parsed.description,
      type: parsed.type,
      target: parsed.target,
      status: "open",
      evidence: parsed.evidence,
      reproductionSteps: parsed.reproductionSteps,
      verificationVerdict,
    });
  }
}
