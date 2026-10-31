import { describe, expect, it } from 'vitest';
import {
  compactWorkflowProcessDetails, dedupeConsecutiveProcessDetailRows, filterNoiseProcessDetails, isAnonymousTaskFragmentToolCallDetail,
  isEinoAgentHeartbeatProgress, isInternalEinoDiagnosticDetail, isModelOutputRecoveryToolCallDetail, processDetailRowFingerprint,
} from './details';
import {
  extractTokenUsage, formatTokenCount, formatTurnDuration, mergeTokenUsage, normalizeTokenUsage, terminalState, tokenUsageLabel, turnSummaryText, turnTimestamp,
} from './turn';

const t = (_key: string, fallback: string, values?: Record<string, unknown>) => {
  let text = fallback;
  Object.entries(values ?? {}).forEach(([name, value]) => { text = text.replace(`{${name}}`, String(value)); });
  return text;
};

describe('process detail filters', () => {
  it('recognises the Eino heartbeat, but not a progress row that merely mentions Eino', () => {
    expect(isEinoAgentHeartbeatProgress({ eventType: 'progress', message: '[Eino] thinking' })).toBe(true);
    expect(isEinoAgentHeartbeatProgress({ eventType: 'progress', message: 'Eino started' })).toBe(false);
    expect(isEinoAgentHeartbeatProgress({ eventType: 'tool_call', message: '[Eino] x' })).toBe(false);
  });

  it('recognises a tool call that carries a model-output recovery marker', () => {
    const marked = { eventType: 'tool_call', data: { arguments: '{"_raptix_model_output_recovery": true}' } };
    expect(isModelOutputRecoveryToolCallDetail(marked)).toBe(true);
    expect(isModelOutputRecoveryToolCallDetail({ eventType: 'tool_call', data: { arguments: '{}' } })).toBe(false);
  });

  it('recognises a task call whose arguments are a text fragment, not an object', () => {
    expect(isAnonymousTaskFragmentToolCallDetail({ eventType: 'tool_call', data: { toolName: 'task', arguments: 'scan the' } })).toBe(true);
    expect(isAnonymousTaskFragmentToolCallDetail({ eventType: 'tool_call', data: { toolName: 'task', arguments: '{"a":1}' } })).toBe(false);
    expect(isAnonymousTaskFragmentToolCallDetail({ eventType: 'tool_call', data: { toolName: 'nmap', arguments: 'x' } })).toBe(false);
  });

  it('hides the runtime bookkeeping rows', () => {
    expect(isInternalEinoDiagnosticDetail({ eventType: 'model_output_rejected' })).toBe(true);
    expect(isInternalEinoDiagnosticDetail({ eventType: 'progress', message: 'The Eino TurnLoop switched to the next round (after the user follow-up) at a safe point.' })).toBe(true);
    expect(isInternalEinoDiagnosticDetail({ eventType: 'progress', data: { kind: 'turn_loop_preempted' } })).toBe(true);
    expect(isInternalEinoDiagnosticDetail({ eventType: 'progress', message: 'scanning' })).toBe(false);
  });

  it('drops the noise and the tool_calls_detected rows, and keeps the rest in order', () => {
    const kept = filterNoiseProcessDetails([
      { eventType: 'progress', message: '[Eino] tick' },
      { eventType: 'tool_calls_detected' },
      { eventType: 'tool_call', data: { toolName: 'nmap' } },
      { eventType: 'response' },
    ]);
    expect(kept.map(item => item.eventType)).toEqual(['tool_call', 'response']);
  });

  it('keeps one of each run of identical rows, but not a repeat after something else', () => {
    const row = { eventType: 'progress', message: 'same', data: { a: 1 } };
    expect(dedupeConsecutiveProcessDetailRows([row, { ...row }, { eventType: 'x' }, row])).toHaveLength(3);
    expect(processDetailRowFingerprint(row)).toBe(processDetailRowFingerprint({ ...row }));
  });

  it('removes the workflow agent-start rows', () => {
    expect(compactWorkflowProcessDetails([{ eventType: 'workflow_agent_start' }, { eventType: 'workflow_node_start' }]).map(item => item.eventType))
      .toEqual(['workflow_node_start']);
  });
});

describe('turn usage', () => {
  it('reads the counts, derives the total when it is missing, and drops an empty record', () => {
    expect(normalizeTokenUsage({ promptTokens: '1200', completionTokens: 300 })).toMatchObject({ totalTokens: 1500, promptTokens: 1200 });
    expect(normalizeTokenUsage({ promptTokens: 0, completionTokens: 0 })).toBeNull();
  });

  it('sums the usage summaries of a turn, and reads the model from the first one that names it', () => {
    const total = extractTokenUsage([
      { eventType: 'eino_usage_summary', data: { totalTokens: 100, model: 'm1', modelCalls: 2 } },
      { eventType: 'tool_call' },
      { eventType: 'eino_usage_summary', data: { totalTokens: 50, model: 'm2', modelCalls: 1 } },
    ]);
    expect(total).toMatchObject({ totalTokens: 150, modelCalls: 3, model: 'm1' });
    expect(extractTokenUsage(null)).toBeNull();
    expect(mergeTokenUsage(null, null)).toBeNull();
  });

  it('formats counts compactly and labels the usage', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1500)).toBe('1.5K');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
    expect(tokenUsageLabel({ totalTokens: 3400 } as never, t)).toBe('3.4K tokens');
  });
});

describe('turn time and state', () => {
  it('formats a duration in hours, minutes or seconds', () => {
    expect(formatTurnDuration(3_725_000, t)).toBe('1 h 2 min');
    expect(formatTurnDuration(65_000, t)).toBe('1 min 5 s');
    expect(formatTurnDuration(7_000, t)).toBe('7 s');
    expect(formatTurnDuration(-5, t)).toBe('0 s');
  });

  it('reads a timestamp, or NaN when there is none', () => {
    expect(turnTimestamp('2026-10-29T00:00:00Z')).toBe(Date.parse('2026-10-29T00:00:00Z'));
    expect(turnTimestamp('')).toBeNaN();
    expect(turnTimestamp('not a date')).toBeNaN();
  });

  it('reports how a turn ended from its last terminal row', () => {
    expect(terminalState([{ eventType: 'error', createdAt: 'x' }])).toMatchObject({ status: 'failed', completedAt: 'x' });
    expect(terminalState([{ eventType: 'timeout' }, { eventType: 'response' }])).toMatchObject({ status: 'timeout' });
    expect(terminalState([{ eventType: 'response' }])).toBeNull();
  });

  it('words the summary line for each status', () => {
    expect(turnSummaryText('running', '5 s', t)).toBe('Processed for 5 s');
    expect(turnSummaryText('cancelled', '5 s', t)).toBe('Interrupted · took 5 s');
    expect(turnSummaryText('completed', '5 s', t)).toBe('Took 5 s');
  });
});
