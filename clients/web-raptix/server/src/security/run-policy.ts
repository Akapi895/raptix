import { ProjectPolicyError } from './project-policy.js';
import { parseContextSelection, type ContextSelection } from '../services/runtime/runtime-context.js';

const invalid = (): ProjectPolicyError => new ProjectPolicyError('bad_request', 'Invalid scoped runtime request');
function body(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) throw invalid();
  const value = raw as Record<string, unknown>;
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value.requestId)) throw invalid();
  return value;
}
export function parseThreadCreate(raw: unknown): { requestId: string; selection: ContextSelection; intent: { kind: string; assistantId: string | null } } {
  const value = body(raw, ['requestId', 'kind', 'assistantId']);
  const selection = parseContextSelection({ kind: value.kind, ...(value.assistantId === undefined ? {} : { assistantId: value.assistantId }) });
  return { requestId: value.requestId as string, selection, intent: { kind: selection.kind, assistantId: selection.assistantId ?? null } };
}
export function parseRunCreate(raw: unknown): { requestId: string; message: string; intent: { message: string } } {
  const value = body(raw, ['requestId', 'message']);
  if (typeof value.message !== 'string' || !value.message.trim() || Buffer.byteLength(value.message) > 16000) throw invalid();
  return { requestId: value.requestId as string, message: value.message, intent: { message: value.message } };
}
export function parseRunPage(raw: unknown): { offset: number; limit: number } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).some(k => !['offset', 'limit'].includes(k))) throw invalid();
  const query = raw as Record<string, unknown>;
  const parse = (v: unknown, fallback: number, max: number): number => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^\d{1,5}$/.test(v) || Number(v) > max) throw invalid();
    return Number(v);
  };
  const page = { offset: parse(query.offset, 0, 10000), limit: parse(query.limit, 10, 25) };
  if (!page.limit) throw invalid();
  return page;
}
