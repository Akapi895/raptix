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
const isResumeValue = (answer: unknown): boolean =>
  (typeof answer === 'string' && answer.trim().length > 0 && Buffer.byteLength(answer) <= 2000) ||
  (Array.isArray(answer) && answer.length > 0 && answer.length <= 10 && answer.every(part => typeof part === 'string' && part.length > 0 && Buffer.byteLength(part) <= 2000));
/** One pending-question answer within a multi-interrupt resume. */
export interface ResumeAnswer { questionId: string; value: string | string[] }
/** W11 scoped graph-interrupt resume: one validated value, optional targeting question id, or every pending answer at once. */
export function parseResumeCreate(raw: unknown): { requestId: string; value: string | string[]; questionId: string | null; answers?: ResumeAnswer[]; intent: { value: string | string[]; questionId: string | null; answers?: ResumeAnswer[] } } {
  const value = body(raw, ['requestId', 'value', 'questionId', 'answers']);
  const parseAnswer = (entry: unknown): ResumeAnswer | null => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.questionId !== 'string' || !item.questionId || item.questionId.length > 256 || !isResumeValue(item.value)) return null;
    return { questionId: item.questionId, value: item.value as string | string[] };
  };
  const answers = value.answers === undefined ? undefined : Array.isArray(value.answers) && value.answers.length > 0 && value.answers.length <= 8 ? value.answers.map(parseAnswer) : undefined;
  if (answers !== undefined && answers.some(a => a === null)) throw invalid();
  const validatedAnswers = answers === undefined ? undefined : answers as ResumeAnswer[];
  if (validatedAnswers !== undefined && validatedAnswers.length === 0) throw invalid();
  const answer = value.value;
  const questionId = value.questionId === undefined ? null : value.questionId;
  if (questionId !== null && (typeof questionId !== 'string' || questionId.length > 256)) throw invalid();
  if (validatedAnswers === undefined && !isResumeValue(answer)) throw invalid();
  const normalized = validatedAnswers === undefined ? (answer as string | string[]) : [];
  return { requestId: value.requestId as string, value: normalized, questionId, ...(validatedAnswers ? { answers: validatedAnswers } : {}), intent: { value: normalized, questionId, ...(validatedAnswers ? { answers: validatedAnswers } : {}) } };
}
/** W11 file-backed HITL decision: allow/deny only (redirect needs a validated args editor — W17+). */
export function parseApprovalDecision(raw: unknown): { requestId: string; action: 'allow' | 'deny'; operatorNote: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).some(k => !['requestId', 'action', 'operatorNote'].includes(k))) throw invalid();
  const value = raw as Record<string, unknown>;
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.requestId)) throw invalid();
  if (value.action !== 'allow' && value.action !== 'deny') throw invalid();
  const note = value.operatorNote === undefined ? '' : value.operatorNote;
  if (typeof note !== 'string' || Buffer.byteLength(note) > 2000) throw invalid();
  return { requestId: value.requestId, action: value.action, operatorNote: note };
}
