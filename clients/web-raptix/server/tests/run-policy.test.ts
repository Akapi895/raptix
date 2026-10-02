import { expect, it } from 'vitest';
import { parseRunCreate, parseRunPage, parseThreadCreate } from '../src/security/run-policy.js';
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
