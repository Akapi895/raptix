import { describe, expect, it } from 'vitest';
import { filterBatchConversations, projectLabelOf, selectAllState, titleWithCount, type BatchConversation } from './manage';

const names = { p1: 'Lab', p2: 'Client' };
const texts = { noProject: 'No project', unknownProject: 'Unknown project' };
const conversations: BatchConversation[] = [
  { id: 'c1', title: 'Scan the lab', projectId: 'p1' },
  { id: 'c2', title: 'Notes', project_id: 'p2' },
  { id: 'c3', title: 'Loose ideas' },
  { id: 'c4', title: 'Client report', projectId: 'p2' },
];
const label = (c: BatchConversation) => projectLabelOf(c, names, texts);

describe('batch narrowing', () => {
  it('keeps every conversation when nothing is chosen', () => {
    expect(filterBatchConversations(conversations, '', '', label).map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('narrows to a project, or to the conversations outside every project', () => {
    expect(filterBatchConversations(conversations, '', 'p2', label).map(c => c.id)).toEqual(['c2', 'c4']);
    expect(filterBatchConversations(conversations, '', '__none__', label).map(c => c.id)).toEqual(['c3']);
  });

  it('searches the title and the project name, case-insensitively', () => {
    expect(filterBatchConversations(conversations, 'SCAN', '', label).map(c => c.id)).toEqual(['c1']);
    expect(filterBatchConversations(conversations, 'client', '', label).map(c => c.id)).toEqual(['c2', 'c4']);
  });

  it('combines the project and the search', () => {
    expect(filterBatchConversations(conversations, 'report', 'p2', label).map(c => c.id)).toEqual(['c4']);
    expect(filterBatchConversations(conversations, 'report', 'p1', label)).toEqual([]);
  });
});

describe('batch labels and state', () => {
  it('labels a conversation with its project name, the no-project text, or the unknown-project text', () => {
    expect(label({ id: 'x', projectId: 'p1' })).toBe('Lab');
    expect(label({ id: 'x', projectId: 'gone' })).toBe('Unknown project');
    expect(label({ id: 'x' })).toBe('No project');
  });

  it('puts the count into the title template', () => {
    expect(titleWithCount('Batch manage (__C__)', 3)).toBe('Batch manage (<span id="batch-manage-count">3</span>)');
  });

  it('reports the select-all box as checked, indeterminate or cleared', () => {
    expect(selectAllState(3, 3)).toEqual({ checked: true, indeterminate: false });
    expect(selectAllState(3, 1)).toEqual({ checked: false, indeterminate: true });
    expect(selectAllState(3, 0)).toEqual({ checked: false, indeterminate: false });
    expect(selectAllState(0, 0)).toEqual({ checked: false, indeterminate: false });
  });
});
