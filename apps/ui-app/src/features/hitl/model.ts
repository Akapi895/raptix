import type { AuditBackend, HitlConfig, HitlItem, HitlMode, HitlReviewer, HitlStrategy, JsonObject, WorkflowRun } from './types';

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
export function parsePayload(raw: unknown): JsonObject {
  if (typeof raw !== 'string') return object(raw);
  try { return object(JSON.parse(raw)); } catch { return {}; }
}
export function normalizeMode(value: unknown): HitlMode {
  const mode = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (mode === 'feedback' || mode === 'followup') return 'approval';
  return mode === 'approval' || mode === 'review_edit' ? mode : 'off';
}
export function normalizeReviewer(value: unknown): HitlReviewer {
  return ['audit_agent', 'agent', 'ai'].includes(String(value ?? '').trim().toLowerCase()) ? 'audit_agent' : 'human';
}
export function normalizeTimeout(value: unknown, fallback: unknown = 0): number {
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  const f = Number(fallback);
  return Number.isFinite(f) ? Math.max(0, Math.floor(f)) : 0;
}
export function normalizeBackend(value: unknown): AuditBackend | '' {
  const v = String(value ?? '').trim().toLowerCase();
  if (['typesafe', 'jev', 'type-safe', 'typesafe-ai'].includes(v)) return 'typesafe';
  return ['openai', 'openai_compatible', 'llm'].includes(v) ? 'openai' : '';
}
export function tools(value: unknown): string[] {
  return (Array.isArray(value) ? value : String(value ?? '').split(/[,\n\r]+/))
    .filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
}
export function mergeTools(global: unknown, session: unknown): string {
  const seen = new Set<string>();
  return [...tools(global), ...tools(session)].filter(v => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).join(', ');
}
export function stripGlobalTools(global: unknown, session: unknown): string {
  const keys = new Set(tools(global).map(v => v.toLowerCase()));
  return tools(session).filter(v => !keys.has(v.toLowerCase())).join(', ');
}
export function effectiveEnabled(config: HitlConfig): boolean { return config.enabled === true || normalizeMode(config.mode) !== 'off'; }
export function normalizeConfig(value: unknown): HitlConfig {
  const v = object(value);
  return { enabled: v.enabled === true, mode: normalizeMode(v.mode), reviewer: normalizeReviewer(v.reviewer),
    sensitiveTools: tools(v.sensitiveTools), timeoutSeconds: normalizeTimeout(v.timeoutSeconds) };
}
export function workflowPending(run: WorkflowRun): JsonObject {
  const pending = parsePayload(run.pending_hitl_json || run.pendingHitlJson);
  return pending.pendingHitl ? object(pending.pendingHitl) : pending;
}
export function workflowLabel(run: WorkflowRun): string {
  const pending = workflowPending(run);
  return String(pending.label || pending.nodeId || run.pending_hitl_node_id || run.pendingHitlNodeId || run.workflow_id || run.workflowId || run.id || '-');
}
export function auditEngineFromItem(item: HitlItem): { backend: AuditBackend | ''; model: string } {
  let backend = normalizeBackend(item.auditBackend || item.audit_backend);
  let model = (item.auditModel || item.audit_model || '').trim();
  if (!backend) {
    const approval = object(parsePayload(item.payload).hitlApproval);
    backend = normalizeBackend(approval.auditBackend || approval.audit_backend);
    model ||= String(approval.auditModel || approval.audit_model || '').trim();
  }
  if (!backend) {
    if (/TypeSafe|\u7834\u574f\u5206|choice=|Jev/i.test(item.comment || '')) backend = 'typesafe';
    else if (normalizeReviewer(item.decidedBy || item.decided_by) === 'audit_agent') backend = 'openai';
  }
  if (backend === 'typesafe' && !model) model = 'jev-latest';
  return { backend, model };
}
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

// Decode at the data boundary. Go returns camelCase; historical records and
// workflow mocks also contain the explicitly supported snake_case aliases.
export function decodeItem(value: unknown): HitlItem {
  const v = object(value);
  const item: HitlItem = { id: String(v.id ?? ''), payload: v.payload };
  const keys = ['conversationId', 'messageId', 'toolName', 'toolCallId', 'mode', 'status', 'reviewer',
    'decision', 'comment', 'decidedBy', 'decided_by', 'auditBackend', 'audit_backend', 'auditModel',
    'audit_model', 'createdAt', 'decidedAt'] as const;
  for (const key of keys) if (typeof v[key] === 'string') item[key] = v[key];
  return item;
}
export function decodeWorkflow(value: unknown): WorkflowRun {
  const v = object(value);
  const run: WorkflowRun = { id: String(v.id ?? '') };
  const keys = ['conversation_id', 'conversationId', 'workflow_id', 'workflowId', 'pending_hitl_json',
    'pendingHitlJson', 'pending_hitl_node_id', 'pendingHitlNodeId'] as const;
  for (const key of keys) if (typeof v[key] === 'string') run[key] = v[key];
  return run;
}
export function decodeStrategy(value: unknown): HitlStrategy {
  const v = object(value); const strategy: HitlStrategy = {};
  for (const key of ['auditAgentPrompt', 'auditAgentPromptReviewEdit', 'defaultAuditAgentPrompt', 'defaultAuditAgentPromptReviewEdit'] as const) {
    if (typeof v[key] === 'string') strategy[key] = v[key];
  }
  return strategy;
}
