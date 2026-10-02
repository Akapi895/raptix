import { expect, it } from 'vitest';
import { isRuntimeContextView } from '../src/runtime-context.js';
it('does not confuse connected planning context with execution readiness', () => {
  const view = { engagementId: 'owned', workspaceSlug: 'test-project', assistantId: 'soundwave', kind: 'planning', authorizationConfirmed: true, planningState: 'blocked', executionReady: false, threadVerified: false, source: 'runtime' };
  expect(isRuntimeContextView(view)).toBe(true);
  expect(isRuntimeContextView({ ...view, executionReady: true })).toBe(false);
  expect(isRuntimeContextView({ ...view, planningState: 'ready', executionReady: true, authorizationConfirmed: false })).toBe(false);
  expect(isRuntimeContextView({ ...view, source: 'fixture' })).toBe(false);
});
