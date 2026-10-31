import { describe, expect, it } from 'vitest';
import {
  collectExecutionIdsFromProcessDetails, displayToolName, formatToolsToggleLabel, normalizeExecutionIds, normalizeToolSummaryForButton,
  selectSummariesForButtons, toolStatusLabel,
} from './mcp-calls';

const t = (_key: string, fallback: string, values?: Record<string, unknown>) => {
  let text = fallback;
  Object.entries(values ?? {}).forEach(([name, value]) => { text = text.replace(`{${name}}`, String(value)); });
  return text;
};

describe('tool call ids and summaries', () => {
  it('trims and de-duplicates execution ids, keeping their order', () => {
    expect(normalizeExecutionIds([' a ', 'b', 'a', null, '', 3])).toEqual(['a', 'b', '3']);
    expect(normalizeExecutionIds('a')).toEqual([]);
  });

  it('collects the execution ids of a turn, including those of merged results', () => {
    const ids = collectExecutionIdsFromProcessDetails([
      { data: { executionId: 'e1' } },
      { data: { executionId: 'e2', _mergedResult: { executionId: 'e3' } } },
      { data: { executionId: 'e1' } },
      null,
    ]);
    expect(ids).toEqual(['e1', 'e2', 'e3']);
  });

  it('fills a summary with empty strings, so it can be stored as data', () => {
    expect(normalizeToolSummaryForButton({ name: 'nmap', executionId: 7 })).toEqual({
      toolName: 'nmap', status: '', executionId: '7', toolCallId: '', processDetailId: '', resultDetailId: '',
    });
  });

  it('draws the given summaries, or a bare button per execution id when there are none', () => {
    expect(selectSummariesForButtons([{ toolName: 'x', executionId: 'e1' }], ['e9']).map(item => item.executionId)).toEqual(['e1']);
    expect(selectSummariesForButtons([], ['e9', 'e8']).map(item => item.executionId)).toEqual(['e9', 'e8']);
  });
});

describe('tool call labels', () => {
  it('words the status of an execution, and leaves an unknown one blank', () => {
    expect(toolStatusLabel('Completed', t)).toBe('Success');
    expect(toolStatusLabel('result_missing', t)).toBe('Result record missing');
    expect(toolStatusLabel('weird', t)).toBe('');
  });

  it('labels the toggle with the count, or with the collapse wording while it is open', () => {
    expect(formatToolsToggleLabel(3, false, t)).toBe('3 tool executions');
    expect(formatToolsToggleLabel(3, true, t)).toBe('Collapse tool runs');
  });

  it('shows an external tool by the part after its server name', () => {
    expect(displayToolName('lab::lookup')).toBe('lookup');
    expect(displayToolName('nmap')).toBe('nmap');
  });
});
