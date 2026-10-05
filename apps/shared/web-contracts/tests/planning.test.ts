import { expect, it } from 'vitest';
import { isPlanningView, PLANNING_DOCUMENTS } from '../src/planning.js';

function missingView() {
  return { version: 1, engagementId: 'project', documents: Object.fromEntries(['roe', 'conops', 'deconfliction', 'opplan'].map(n => [n, { state: 'missing' }])), bundle: Object.fromEntries(PLANNING_DOCUMENTS.map(n => [n, 'missing'])), readiness: { state: 'blocked', reasons: ['roe:missing'], runtimeSignal: 'not_observed' } };
}
it('rejects fabricated ready handoff while required bundle documents are missing', () => {
  const view = missingView();
  expect(isPlanningView(view)).toBe(true);
  view.readiness = { state: 'ready', reasons: [], runtimeSignal: 'not_observed' };
  expect(isPlanningView(view)).toBe(false);
});
it('rejects typed nested projection mismatches and content on unreadable documents', () => {
  const view = missingView();
  Object.assign(view.documents.roe!, { content: { in_scope: 'not-an-array' } });
  expect(isPlanningView(view)).toBe(false);
});
