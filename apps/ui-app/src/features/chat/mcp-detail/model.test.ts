import { describe, expect, it } from 'vitest';
import { executionDetailView, isExecutionActive, requestJson, resultJson, resultText, tabsFor, type DetailTexts } from './model';

const texts: DetailTexts = {
  unknown: 'Unknown',
  statusText: status => `status:${status}`,
  blockedStatusText: 'blocked-text',
  emptySuccess: 'empty',
  running: 'still running',
  noResponse: 'no response',
};

describe('result text', () => {
  it('reads a string, a list of text parts, or a single text part', () => {
    expect(resultText({ content: 'plain' })).toBe('plain');
    expect(resultText({ content: [{ text: 'a' }, { image: 'x' }, { text: 'b' }] })).toBe('a\n\nb');
    expect(resultText({ content: { text: 'one' } })).toBe('one');
    expect(resultText(null)).toBe('');
  });

  it('writes the raw result as JSON, with the blocked flag only when it is set', () => {
    expect(JSON.parse(resultJson({ content: 'x', isError: true, blocked: true }))).toEqual({ content: 'x', isError: true, blocked: true });
    expect(JSON.parse(resultJson({ content: 'x' }))).toEqual({ content: 'x', isError: false });
    expect(resultJson(null)).toBe('{}');
  });

  it('shows the request as the tool and its arguments', () => {
    expect(JSON.parse(requestJson({ toolName: 'nmap', arguments: { target: 'x' } }))).toEqual({ tool: 'nmap', arguments: { target: 'x' } });
  });
});

describe('result tabs', () => {
  it('opens the success tab only when there is success content and it was asked for', () => {
    expect(tabsFor('success', true)).toEqual({ successEnabled: true, active: 'success' });
    expect(tabsFor('raw', true)).toEqual({ successEnabled: true, active: 'raw' });
    expect(tabsFor('success', false)).toEqual({ successEnabled: false, active: 'raw' });
  });
});

describe('execution detail view', () => {
  it('only a running execution can be stopped', () => {
    expect(isExecutionActive('running')).toBe(true);
    expect(isExecutionActive('background_running')).toBe(true);
    expect(isExecutionActive('completed')).toBe(false);
  });

  it('shows a successful result on the success tab, and the raw result on the raw tab', () => {
    const view = executionDetailView({ id: 'e1', toolName: 'nmap', result: { content: 'open 22' } }, 'completed', texts);
    expect(view.success).toEqual({ className: 'code-block', text: 'open 22' });
    expect(view.response.className).toBe('code-block');
    expect(view.tabs).toEqual({ successEnabled: true, active: 'success' });
    expect(view.successLabelKey).toBe('mcpDetailModal.correctInfo');
    expect(view.abort.visible).toBe(false);
  });

  it('shows a blocked call with its reason and the blocked label', () => {
    const view = executionDetailView({ id: 'e2', result: { content: '', blocked: true } }, 'blocked', texts);
    expect(view.response.className).toBe('code-block blocked');
    expect(view.success.text).toBe('blocked-text');
    expect(view.successLabelKey).toBe('mcpDetailModal.blockReason');
  });

  it('shows an error result on the raw tab, with the error message', () => {
    const view = executionDetailView({ id: 'e3', error: 'timeout', result: { isError: true } }, 'failed', texts);
    expect(view.response.className).toBe('code-block error');
    expect(view.error).toBe('timeout');
    expect(view.tabs.active).toBe('raw');
  });

  it('explains a running execution that has no result yet, and offers to stop it', () => {
    const view = executionDetailView({ id: 'e4', toolName: 'nmap' }, 'running', texts);
    expect(view.response.text).toBe('still running');
    expect(view.abort).toEqual({ visible: true, executionId: 'e4' });
    expect(view.statusClass).toBe('running');
  });

  it('marks a background run as running and the others with their own status', () => {
    expect(executionDetailView({ id: 'e5' }, 'background_running', texts).statusClass).toBe('running');
    const done = executionDetailView({ id: 'e6' }, 'completed', texts);
    expect(done.response.text).toBe('no response');
    expect(done.statusText).toBe('status:completed');
  });

  it('names an unknown tool and an execution without an id', () => {
    const view = executionDetailView({}, 'completed', texts);
    expect(view.toolName).toBe('Unknown');
    expect(view.executionId).toBe('N/A');
  });
});
