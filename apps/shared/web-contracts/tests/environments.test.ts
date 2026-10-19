import { expect, it } from 'vitest';
import { isEnvironmentCommandRequest, isEnvironmentCommandResult } from '../src/environments.js';

const request = { requestId: 'activate-0001', action: 'activate', expectedVersion: 0 };

it('accepts a bounded activate or stop command with a non-negative slot version', () => {
  expect(isEnvironmentCommandRequest(request)).toBe(true);
  expect(isEnvironmentCommandRequest({ ...request, action: 'stop', expectedVersion: 7 })).toBe(true);
});

it('refuses unbounded identifiers, unknown actions and invalid versions', () => {
  expect(isEnvironmentCommandRequest({ ...request, requestId: 'short' })).toBe(false);
  expect(isEnvironmentCommandRequest({ ...request, requestId: 'has spaces here' })).toBe(false);
  expect(isEnvironmentCommandRequest({ ...request, requestId: 'x'.repeat(129) })).toBe(false);
  expect(isEnvironmentCommandRequest({ ...request, action: 'delete' })).toBe(false);
  expect(isEnvironmentCommandRequest({ ...request, expectedVersion: -1 })).toBe(false);
  expect(isEnvironmentCommandRequest({ ...request, expectedVersion: 1.5 })).toBe(false);
  expect(isEnvironmentCommandRequest({ ...request, expectedVersion: '0' })).toBe(false);
});

it('accepts an accepted result that names the caller own active project', () => {
  const result = { status: 'accepted', phase: 'starting', version: 1, commandId: 'cmd-1', activeEngagementId: 'eng-a' };
  expect(isEnvironmentCommandResult(result)).toBe(true);
});

it('refuses a busy result that names the active project or reports an idle slot', () => {
  expect(isEnvironmentCommandResult({ status: 'busy', phase: 'ready', version: 2, commandId: 'cmd-1', activeEngagementId: 'eng-a' })).toBe(false);
  expect(isEnvironmentCommandResult({ status: 'busy', phase: 'idle', version: 2, commandId: null })).toBe(false);
  expect(isEnvironmentCommandResult({ status: 'busy', phase: 'ready', version: 2, commandId: 'cmd-1' })).toBe(true);
});

it('refuses results with unknown phases, negative versions or non-string reasons', () => {
  expect(isEnvironmentCommandResult({ status: 'stale', phase: 'running', version: 2, commandId: null })).toBe(false);
  expect(isEnvironmentCommandResult({ status: 'stale', phase: 'idle', version: -1, commandId: null })).toBe(false);
  expect(isEnvironmentCommandResult({ status: 'refused', phase: 'idle', version: 0, commandId: null, reason: 42 })).toBe(false);
});
