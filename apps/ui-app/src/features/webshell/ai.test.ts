import { describe, expect, it } from 'vitest';
import { coalesceWebshellProcessDetails, isLikelyWebshellAiErrorMessage, simplifyWebshellAiError, webshellEventMessage, webshellUsageMessage } from './ai';

describe('WebShell AI process presentation', () => {
  it('merges tool output into its call while retaining distinct unmatched results', () => {
    const details = coalesceWebshellProcessDetails([
      { eventType: 'tool_call', message: 'run', data: { toolCallId: 'call1', argumentsObj: { command: 'id' } } },
      { eventType: 'tool_result', message: 'done', data: { toolCallId: 'call1', result: 'uid=0', executionId: 'exec1' } },
      { eventType: 'tool_result', message: 'other', data: { toolCallId: 'missing', result: 'other result' } },
    ]);
    expect(details).toHaveLength(2); expect(details[0]?.data?._mergedResult).toMatchObject({ result: 'uid=0', executionId: 'exec1' }); expect(details[1]?.message).toBe('other');
  });
  it('reconstructs interleaved reasoning and subagent streams into separate cards', () => {
    const result = coalesceWebshellProcessDetails([
      { eventType: 'reasoning_chain_stream_start', message: '', data: { streamId: 'r' } },
      { eventType: 'eino_agent_reply_stream_start', message: '', data: { streamId: 's', einoAgent: 'worker' } },
      { eventType: 'reasoning_chain_stream_delta', message: 'think ', data: { streamId: 'r' } },
      { eventType: 'eino_agent_reply_stream_delta', message: 'reply', data: { streamId: 's' } },
      { eventType: 'reasoning_chain_stream_end', message: 'full thinking', data: { streamId: 'r' } },
      { eventType: 'done', message: '' },
    ]);
    expect(result.map(detail => [detail.eventType, detail.message])).toEqual([['reasoning_chain', 'full thinking'], ['eino_agent_reply', 'reply']]);
    expect(result[1]?.data?.einoAgent).toBe('worker');
  });
  it('keeps persisted reasoning when the server saved it separately from process details', () => {
    const result = coalesceWebshellProcessDetails([{ eventType: 'progress', message: 'checking' }], 'saved reasoning');
    expect(result[0]).toEqual({ eventType: 'reasoning_chain', message: 'saved reasoning' });
  });
  it('shows concise errors without hiding detailed diagnostics and recognizes historical process errors', () => {
    expect(simplifyWebshellAiError('HTTP 401 Unauthorized API Key invalid')).toContain('Authentication failed');
    expect(isLikelyWebshellAiErrorMessage({ role: 'assistant', content: 'failed details', processDetails: [{ eventType: 'error', message: 'failure' }] })).toBe(true);
    expect(webshellEventMessage({ type: 'eino_model_retry', message: '', data: { reason: 'rate limit', error: '429' } })).toContain('429');
    expect(webshellEventMessage({ type: 'eino_model_failover', message: '', data: { channel: 'backup', model: 'fallback' } })).toContain('backup');
  });
  it('includes cached and reasoning token usage when supplied', () => {
    const message = webshellUsageMessage({ modelCalls: 2, totalTokens: 1000, cachedTokens: 20, reasoningTokens: 5 }, (_key, fallback) => fallback);
    expect(message).toContain('Model calls: 2'); expect(message).toContain('Cached tokens: 20'); expect(message).toContain('Reasoning tokens: 5');
  });
});
