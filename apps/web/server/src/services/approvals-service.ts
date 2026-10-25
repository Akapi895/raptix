import type { ApprovalsView } from '@raptix/web-contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectPolicyError } from '../security/project-policy.js';
import { parseApprovalDecision } from '../security/run-policy.js';
import type { ProjectFiles } from './project-files.js';
import { ProjectNotFoundError } from './projects-service.js';

/**
 * W11 file-backed tool HITL: read pending `approval_request` records from the
 * project sandbox's `approvals/requests.jsonl` (producer contract in
 * `raptix/middleware/hitl.py`) and append `approval_decision` records to
 * `decisions.jsonl` (ADR-0102: both files live in the project's own sandbox).
 * Engagement-scoped only: metadata is never projected, so a
 * pending approval is never assigned to a run by name coincidence. Decisions
 * are serialized per engagement behind an in-process async mutex and re-checked
 * inside the lock, so two concurrent decisions cannot both append; cross-process
 * appends remain a documented producer limitation (single-server deployment).
 */

const MAX_LINE_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_RECORDS = 500;
const REQUESTS = 'approvals/requests.jsonl';
const DECISIONS = 'approvals/decisions.jsonl';

interface ApprovalRecord {
  requestId: string;
  engagementName: string;
  agentName: string;
  toolName: string;
  toolArgsRedacted: Record<string, unknown>;
  matchedRule: { techniqueTag: string | null; toolPattern: string | null; timeoutSeconds: number; defaultOnTimeout: string };
  reason: string;
  createdAtSeconds: number;
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function toRecord(line: string): ApprovalRecord | null {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || (parsed as Record<string, unknown>).kind !== 'approval_request') return null;
  const row = parsed as Record<string, unknown>;
  const requestId = str(row.request_id, 128);
  const agentName = str(row.agent_name, 200);
  const toolName = str(row.tool_name, 200);
  if (!requestId || agentName === null || toolName === null) return null;
  if (typeof row.tool_args_redacted !== 'object' || row.tool_args_redacted === null || Array.isArray(row.tool_args_redacted)) return null;
  const args = row.tool_args_redacted as Record<string, unknown>;
  const serialized = JSON.stringify(args);
  if (serialized.length > 4000) return null;
  const rule = row.matched_rule;
  if (typeof rule !== 'object' || rule === null) return null;
  const matched = rule as Record<string, unknown>;
  const techniqueTag = matched.technique_tag === null ? null : str(matched.technique_tag, 32);
  const toolPattern = matched.tool_pattern === null ? null : str(matched.tool_pattern, 200);
  if (techniqueTag === null && matched.technique_tag !== null) return null;
  if (toolPattern === null && matched.tool_pattern !== null) return null;
  if (typeof matched.timeout_seconds !== 'number' || !Number.isFinite(matched.timeout_seconds) || typeof matched.default_on_timeout !== 'string' || !matched.default_on_timeout) return null;
  const reason = str(row.reason, 500);
  const createdAtSeconds = typeof row.created_at === 'number' && Number.isFinite(row.created_at) ? row.created_at : null;
  if (reason === null || createdAtSeconds === null) return null;
  return {
    requestId,
    engagementName: str(row.engagement_name, 200) ?? '',
    agentName,
    toolName,
    toolArgsRedacted: args,
    matchedRule: { techniqueTag, toolPattern, timeoutSeconds: matched.timeout_seconds, defaultOnTimeout: matched.default_on_timeout },
    reason,
    createdAtSeconds,
  };
}

export class ApprovalsService {
  private readonly locks = new Map<string, Promise<unknown>>();
  public constructor(private readonly db: PrismaClient, private readonly files: ProjectFiles) {}

  private async project(userId: string, engagementId: string): Promise<string> {
    const project = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!project) throw new ProjectNotFoundError();
    return project.workspaceSlug;
  }

  /** A missing or oversized ledger reads as empty; a sandbox failure propagates as an explicit unavailable answer. */
  private async readJsonl(slug: string, rel: string): Promise<string[]> {
    const data = await this.files.read(slug, rel);
    if (data === null || data.length > MAX_FILE_BYTES) return [];
    return data.toString('utf8').split('\n').filter(line => line.trim().length > 0 && Buffer.byteLength(line) <= MAX_LINE_BYTES);
  }

  public async list(userId: string, engagementId: string): Promise<ApprovalsView> {
    const slug = await this.project(userId, engagementId);
    const decided = new Set<string>();
    for (const line of await this.readJsonl(slug, DECISIONS)) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.kind === 'approval_decision' && typeof parsed.request_id === 'string') decided.add(parsed.request_id);
      } catch { /* malformed producer lines stay invisible */ }
    }
    const pending: ApprovalRecord[] = [];
    for (const line of await this.readJsonl(slug, REQUESTS)) {
      const record = toRecord(line);
      if (!record) continue;
      if (decided.has(record.requestId)) continue;
      pending.push(record);
      if (pending.length >= MAX_RECORDS) break;
    }
    pending.sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
    return { engagementId, approvals: pending.map(record => ({ ...record, engagementId, source: 'workspace' as const })), source: 'workspace' };
  }

  public async decide(userId: string, engagementId: string, raw: unknown): Promise<{ ok: true; requestId: string; action: 'allow' | 'deny'; decidedAtSeconds: number }> {
    const decision = parseApprovalDecision(raw);
    const chained = (this.locks.get(engagementId) ?? Promise.resolve()).catch(() => undefined);
    const gate = chained.then(() => this.decideLocked(userId, engagementId, decision));
    this.locks.set(engagementId, gate);
    try { return await gate; }
    finally {
      if (this.locks.get(engagementId) === gate) this.locks.delete(engagementId);
    }
  }

  private async decideLocked(userId: string, engagementId: string, decision: { requestId: string; action: 'allow' | 'deny'; operatorNote: string }): Promise<{ ok: true; requestId: string; action: 'allow' | 'deny'; decidedAtSeconds: number }> {
    const slug = await this.project(userId, engagementId);
    const known = (await this.readJsonl(slug, REQUESTS)).some(line => {
      try { return (JSON.parse(line) as Record<string, unknown>).kind === 'approval_request' && (JSON.parse(line) as Record<string, unknown>).request_id === decision.requestId; }
      catch { return false; }
    });
    if (!known) throw new ProjectNotFoundError();
    const already = (await this.readJsonl(slug, DECISIONS)).some(line => {
      try { return (JSON.parse(line) as Record<string, unknown>).kind === 'approval_decision' && (JSON.parse(line) as Record<string, unknown>).request_id === decision.requestId; }
      catch { return false; }
    });
    if (already) throw new ProjectPolicyError('conflict', 'Approval request already decided');
    const decidedAtSeconds = Date.now() / 1000;
    const line = JSON.stringify({ kind: 'approval_decision', request_id: decision.requestId, action: decision.action, operator_note: decision.operatorNote, redirect_args: null, decided_at: decidedAtSeconds }) + '\n';
    await this.files.append(slug, DECISIONS, Buffer.from(line, 'utf8'));
    return { ok: true, requestId: decision.requestId, action: decision.action, decidedAtSeconds };
  }
}
