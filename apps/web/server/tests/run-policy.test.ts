import { expect, it } from 'vitest';
import { parseApprovalDecision, parseResumeCreate, parseRunCreate, parseRunPage, parseThreadCreate } from '../src/security/run-policy.js';
it('accepts only thread kind/assistant selection and a stable client intent ID', () => {
  expect(parseThreadCreate({ requestId: 'request-0001', kind: 'planning' }).intent).toEqual({ kind: 'planning', assistantId: null });
  for (const key of ['threadId', 'workspace_path', 'config', 'authorizationConfirmed', 'metadata', 'sandbox_url']) expect(() => parseThreadCreate({ requestId: 'request-0001', kind: 'planning', [key]: 'forged' })).toThrow();
  expect(() => parseThreadCreate({ requestId: '../escape', kind: 'planning' })).toThrow();
});
it('preserves exact user message intent while rejecting SDK command/options and oversized input', () => {
  expect(parseRunCreate({ requestId: 'request-0001', message: ' hello\n' }).intent.message).toBe(' hello\n');
  for (const input of [{ message: '' }, { message: '  ' }, { message: { role: 'system' } }, { message: 'x'.repeat(16001) }, { message: 'hello', command: { goto: 'unsafe' } }, { message: 'hello', multitaskStrategy: 'interrupt' }]) expect(() => parseRunCreate({ requestId: 'request-0001', ...input })).toThrow();
});
it('bounds owned-run pagination and rejects arbitrary upstream filters', () => {
  expect(parseRunPage({})).toEqual({ offset: 0, limit: 10 });
  expect(parseRunPage({ offset: '12', limit: '25' })).toEqual({ offset: 12, limit: 25 });
  for (const query of [{ offset: '-1' }, { limit: '26' }, { limit: '0' }, { status: 'running' }, { offset: ['1'] }]) expect(() => parseRunPage(query)).toThrow();
});
it('accepts one validated resume answer with an optional targeting question id', () => {
  expect(parseResumeCreate({ requestId: 'request-0001', value: 'Yes (Recommended)' }).value).toBe('Yes (Recommended)');
  expect(parseResumeCreate({ requestId: 'request-0001', value: ['A', 'B'], questionId: 'call-1' }).intent).toEqual({ value: ['A', 'B'], questionId: 'call-1' });
  for (const input of [{ value: '' }, { value: [] }, { value: [42] }, { value: ['ok'], extra: true }, { value: 'x'.repeat(2001) }, { value: ['a'.repeat(2001)] }, { value: 'ok', questionId: 42 }]) expect(() => parseResumeCreate({ requestId: 'request-0001', ...input })).toThrow();
});
it('accepts only allow/deny file-HITL decisions with a bounded note', () => {
  expect(parseApprovalDecision({ requestId: 'req-1', action: 'deny', operatorNote: 'Operator decision' })).toEqual({ requestId: 'req-1', action: 'deny', operatorNote: 'Operator decision' });
  expect(parseApprovalDecision({ requestId: 'req-1', action: 'allow' }).operatorNote).toBe('');
  for (const input of [{ action: 'redirect' }, { action: 'allow', redirect_args: {} }, { requestId: '' }, { action: 'ALLOW' }, { operatorNote: 'x'.repeat(2001) }]) expect(() => parseApprovalDecision({ requestId: 'req-1', ...input })).toThrow();
});
