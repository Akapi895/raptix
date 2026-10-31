import { describe, expect, it } from 'vitest';
import {
  agentPlanTaskDetail,
  formatCompactInteger,
  formatEinoModelFailoverMessage,
  formatEinoRunRetryMessage,
  formatEinoRunRetryTitle,
  formatEinoUsageSummaryMessage,
  mergeMcpExecutionIdLists,
} from './eino-format';

const t = (key: string) => key;

describe('Eino timeline wording', () => {
  it('merges two lists of execution ids, without blanks or repeats', () => {
    expect(mergeMcpExecutionIdLists([' a ', 'b'], ['b', '', 'c', null])).toEqual(['a', 'b', 'c']);
    expect(mergeMcpExecutionIdLists(undefined, 'x')).toEqual([]);
  });

  it('writes the plan of a run retry, its reason and its error, once each', () => {
    const text = formatEinoRunRetryMessage(t, 'retrying', {
      attempt: 2,
      maxAttempts: 3,
      backoffSec: 5,
      errorKind: 'rate_limit',
      errorSummary: 'too many requests',
    });
    expect(text).toBe([
      'retrying',
      'chat.einoRunRetryPlan',
      'Reason type: Rate limited / too many requests',
      'Error detail: too many requests',
    ].join('\n'));
  });

  it('shows the attempt in the title of a retry, when both counts are known', () => {
    expect(formatEinoRunRetryTitle(t, { attempt: 2, maxAttempts: 3 })).toBe('chat.einoRunRetryTitle (2/3)');
    expect(formatEinoRunRetryTitle(t, {})).toBe('chat.einoRunRetryTitle');
  });

  it('names the channel and the model of a failover', () => {
    expect(formatEinoModelFailoverMessage('switch', { channel: 'c', model: 'm' })).toBe('switch\nChannel: c\nModel: m');
  });

  it('groups the thousands of a count in the reader locale', () => {
    expect(formatCompactInteger(1234567, 'en-US')).toBe('1,234,567');
    expect(formatCompactInteger(-4, 'en-US')).toBe('0');
    expect(formatCompactInteger('x', 'en-US')).toBe('0');
  });

  it('lists the usage of a turn, and leaves out the cache and reasoning counts that are zero', () => {
    const text = formatEinoUsageSummaryMessage(t, { modelCalls: 2, promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0 }, 'en-US');
    expect(text).toBe('Model calls: 2\nPrompt tokens: 10\nCompletion tokens: 5\nTotal tokens: 15');
  });

  it('passes on only the plan-task calls and results, for a conversation that is known', () => {
    expect(agentPlanTaskDetail({ type: 'tool_call', data: { toolName: 'TaskCreate', conversationId: 'c1' } }, '', '')).toEqual({
      eventType: 'tool_call', conversationId: 'c1', data: { toolName: 'TaskCreate', conversationId: 'c1' },
    });
    expect(agentPlanTaskDetail({ type: 'tool_call', data: { toolName: 'nmap' } }, 'c1', '')).toBeNull();
    expect(agentPlanTaskDetail({ type: 'tool_call', data: { toolName: 'TaskGet' } }, '', '')).toBeNull();
  });
});
