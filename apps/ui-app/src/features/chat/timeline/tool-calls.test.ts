import { describe, expect, it } from 'vitest';
import {
  autoCancelledExecutionIdsFromData,
  buildWorkflowBranchDetailHtml,
  buildWorkflowConditionResultHtml,
  coalesceProcessDetailsToolPairs,
  normalizeExecutionIdList,
  toolCallStatusPresentation,
  type ProcessDetailRecord,
} from './tool-calls';

const t = (key: string) => key;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

describe('tool call status', () => {
  it('shows a status with its classes, its label and its icon', () => {
    expect(toolCallStatusPresentation('Completed', t)).toEqual({
      status: 'completed', itemClass: 'tool-call-completed', badgeClass: 'tool-status-completed', label: 'Completed', icon: '✅ ',
    });
    expect(toolCallStatusPresentation('canceled', t)?.status).toBe('cancelled');
    expect(toolCallStatusPresentation('background_running', t)?.label).toBe('Running in background');
    expect(toolCallStatusPresentation('something-else', t)).toBeNull();
  });
});

describe('process history of tool calls', () => {
  it('folds a result into the call it answers, by its call id', () => {
    const details: ProcessDetailRecord[] = [
      { id: 'c1', eventType: 'tool_call', data: { toolCallId: 'x', toolName: 'nmap', argumentsObj: {} } },
      { id: 'r1', eventType: 'tool_result', data: { toolCallId: 'x', toolName: 'nmap', result: 'open 80' } },
    ];
    const out = coalesceProcessDetailsToolPairs(details);
    expect(out).toHaveLength(1);
    const merged = out[0]?.data as Record<string, unknown>;
    expect(merged._mergedResult).toEqual({ toolCallId: 'x', toolName: 'nmap', result: 'open 80' });
    expect(merged._mergedResultDetailId).toBe('r1');
  });

  it('matches a result without an id by the tool name, and keeps a result nothing answers', () => {
    const details: ProcessDetailRecord[] = [
      { id: 'c1', eventType: 'tool_call', data: { toolName: 'curl' } },
      { id: 'c2', eventType: 'tool_call', data: { toolName: 'nmap' } },
      { id: 'r1', eventType: 'tool_result', data: { toolName: 'nmap', result: 'ok' } },
      { id: 'r2', eventType: 'tool_result', data: { toolName: 'ghost', result: 'alone' } },
    ];
    const out = coalesceProcessDetailsToolPairs(details);
    expect((out[1]?.data as Record<string, unknown>)._mergedResultDetailId).toBe('r1');
    expect(out.map(d => d.id)).toEqual(['c1', 'c2', 'r2']);
  });

  it('does not let an older result replace an agent-facing one', () => {
    const details: ProcessDetailRecord[] = [
      { id: 'c1', eventType: 'tool_call', data: { toolCallId: 'x' } },
      { id: 'r1', eventType: 'tool_result', data: { toolCallId: 'x', result: 'full', agentFacing: true } },
      { id: 'r2', eventType: 'tool_result', data: { toolCallId: 'x', result: 'older' } },
    ];
    const out = coalesceProcessDetailsToolPairs(details);
    const merged = out[0]?.data as Record<string, unknown>;
    expect((merged._mergedResult as Record<string, unknown>).result).toBe('full');
    expect(out.map(d => d.id)).toEqual(['c1', 'r2']);
  });
});

describe('execution ids', () => {
  it('keeps each id once, trimmed and in order', () => {
    expect(normalizeExecutionIdList([' a ', '', 'b', 'a', null])).toEqual(['a', 'b']);
    expect(normalizeExecutionIdList('single')).toEqual(['single']);
    expect(autoCancelledExecutionIdsFromData({ autoCancelledExecutionIds: ['e1', 'e1'] })).toEqual(['e1']);
  });
});

describe('workflow node html', () => {
  it('shows the condition of a node and whether it matched, escaped', () => {
    const html = buildWorkflowConditionResultHtml({ expression: 'a<b', matched: 'true' }, escape);
    expect(html).toContain('a&lt;b');
    expect(html).toContain('is-true');
    expect(buildWorkflowConditionResultHtml({ output: { matched: false } }, escape)).toContain('is-false');
  });

  it('shows the condition of an edge only when it has one', () => {
    expect(buildWorkflowBranchDetailHtml({}, escape)).toBe('');
    expect(buildWorkflowBranchDetailHtml({ edgeCondition: 'x>1' }, escape)).toContain('<code>x>1</code>');
  });
});
