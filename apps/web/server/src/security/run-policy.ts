import { INSTANCE_MESSAGE_MAX_CHARS } from '@raptix/web-contracts';
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
/** P11 operation requests carry only a client request id, so a lost ack replays the same operation. */
export function parseOperationRequest(raw: unknown): { requestId: string } {
  return { requestId: body(raw, ['requestId']).requestId as string };
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
/** Longest operator message the runtime accepts (P10c); the console shows the same limit. */
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const ROLE = /^[a-z][a-z0-9_-]{0,63}$/;
const attemptOf = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
};
/** Keys are checked against the allowed list so an unknown field is refused, never silently dropped. */
function exactKeys(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) throw invalid();
  return raw as Record<string, unknown>;
}
/** P10c: an operator message to one running dispatch instance. The message id is the client's idempotency key; the attempt pins the target. */
export function parseInstanceMessage(raw: unknown): { messageId: string; body: string; expectedAttempt: number } {
  const value = exactKeys(raw, ['messageId', 'body', 'expectedAttempt']);
  if (typeof value.messageId !== 'string' || !INSTANCE_ID.test(value.messageId)) throw invalid();
  if (typeof value.body !== 'string') throw invalid();
  const text = value.body.trim();
  if (text.length === 0 || text.length > INSTANCE_MESSAGE_MAX_CHARS) throw invalid();
  return { messageId: value.messageId, body: text, expectedAttempt: attemptOf(value.expectedAttempt) };
}
/** P10d: cooperative cancel of the attempt the operator is looking at. */
export function parseInstanceCancel(raw: unknown): number {
  return attemptOf(exactKeys(raw, ['expectedAttempt']).expectedAttempt);
}
/** P10d: retry the same dispatch (`retry`) or replace it with another role (`reassign`), once its attempt has ended. */
export function parseInstanceCommand(raw: unknown): { commandId: string; kind: 'retry' | 'reassign'; expectedAttempt: number; role: string | null } {
  const value = exactKeys(raw, ['commandId', 'kind', 'expectedAttempt', 'role']);
  if (typeof value.commandId !== 'string' || !COMMAND_ID.test(value.commandId)) throw invalid();
  if (value.kind !== 'retry' && value.kind !== 'reassign') throw invalid();
  const role = value.role === undefined ? null : value.role;
  if (value.kind === 'retry' && role !== null) throw invalid();
  if (value.kind === 'reassign' && (typeof role !== 'string' || !ROLE.test(role))) throw invalid();
  return { commandId: value.commandId, kind: value.kind, expectedAttempt: attemptOf(value.expectedAttempt), role: role as string | null };
}
/** P10c forward: a new message to the target attempt that names the source message it repeats. Nothing is copied automatically. */
export function parseInstanceForward(raw: unknown): { messageId: string; sourceDispatchId: string; sourceMessageId: string; expectedAttempt: number } {
  const value = exactKeys(raw, ['messageId', 'sourceDispatchId', 'sourceMessageId', 'expectedAttempt']);
  if (typeof value.messageId !== 'string' || !INSTANCE_ID.test(value.messageId)) throw invalid();
  if (typeof value.sourceDispatchId !== 'string' || value.sourceDispatchId.length < 1 || value.sourceDispatchId.length > 256) throw invalid();
  if (typeof value.sourceMessageId !== 'string' || !INSTANCE_ID.test(value.sourceMessageId)) throw invalid();
  return { messageId: value.messageId, sourceDispatchId: value.sourceDispatchId, sourceMessageId: value.sourceMessageId, expectedAttempt: attemptOf(value.expectedAttempt) };
}
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
