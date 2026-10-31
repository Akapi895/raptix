import type { AiEvent, AiMessage, ProcessDetail } from './service';

export function simplifyWebshellAiError(raw: string): string {
  const message = raw.trim();
  if (/(401|unauthorized)/i.test(message) && /(api key|apikey)/i.test(message)) return 'Authentication failed: API key missing or invalid (401)';
  if (/(timeout|timed out)/i.test(message)) return 'Request timed out; try again later';
  if (/(network|failed to fetch)/i.test(message)) return 'Network error; check service connectivity'
  return message || 'Request failed';
}
export function isLikelyWebshellAiErrorMessage(message: AiMessage): boolean {
  return /^(\u6267\u884c\u5931\u8d25|\u8bf7\u6c42\u5931\u8d25|\u8bf7\u6c42\u5f02\u5e38|error)\s*[:\uff1a]/i.test(message.content.trim()) || /(status code\s*:\s*4\d{2}|unauthorized|forbidden|apikey|api key|invalid api key|noderunerror|tool[-_ ]?error|agent[-_ ]?error|\u6267\u884c\u5931\u8d25)/i.test(message.content) || message.processDetails?.some(detail => detail.eventType.toLowerCase() === 'error') === true;
}
export function coalesceWebshellProcessDetails(details: ProcessDetail[], reasoning?: string): ProcessDetail[] {
  const result: ProcessDetail[] = [];
  const calls = new Map<string, ProcessDetail>();
  const streams = new Map<string, ProcessDetail>();
  for (const detail of details) {
    if (['conversation', 'response_start', 'response_delta', 'response', 'done'].includes(detail.eventType)) continue;
    const data = { ...detail.data };
    const streamId = typeof data.streamId === 'string' ? data.streamId : '';
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    if (streamId && /_stream_(?:start|delta|end)$/.test(detail.eventType)) {
      const type = detail.eventType.replace(/_stream_(?:start|delta|end)$/, '');
      const key = type + ':' + streamId;
      let item = streams.get(key);
      if (!item) { item = { eventType: type, message: '', data }; streams.set(key, item); result.push(item); }
      if (detail.eventType.endsWith('_start')) item.message = '';
      else if (typeof data.accumulated === 'string') item.message = data.accumulated;
      else if (detail.eventType.endsWith('_end')) item.message = detail.message || item.message;
      else item.message += detail.message;
      continue;
    }
    if (detail.eventType === 'tool_result' && toolCallId && calls.has(toolCallId)) {
      const call = calls.get(toolCallId)!; call.data = { ...call.data, _mergedResult: data }; continue;
    }
    const item = { ...detail, data }; result.push(item);
    if (detail.eventType === 'tool_call' && toolCallId) calls.set(toolCallId, item);
  }
  if (reasoning && !result.some(detail => detail.eventType === 'reasoning_chain' && detail.message === reasoning)) result.unshift({ eventType: 'reasoning_chain', message: reasoning });
  return result;
}
export function webshellUsageMessage(data: Record<string, unknown>, t: (key: string, fallback: string) => string): string {
  const fields = [['modelCalls', 'chat.einoUsageModelCalls', 'Model calls'], ['promptTokens', 'chat.einoUsagePromptTokens', 'Prompt tokens'], ['completionTokens', 'chat.einoUsageCompletionTokens', 'Completion tokens'], ['totalTokens', 'chat.einoUsageTotalTokens', 'Total tokens'], ['cachedTokens', 'chat.einoUsageCachedTokens', 'Cached tokens'], ['cacheWriteTokens', 'chat.einoUsageCacheWriteTokens', 'Cache-write tokens'], ['reasoningTokens', 'chat.einoUsageReasoningTokens', 'Reasoning tokens']];
  return fields.filter(([key], index) => index < 4 || Number(data[key!]) > 0).map(([key, label, fallback]) => `${t(label!, fallback!)}: ${Math.max(0, Math.trunc(Number(data[key!]) || 0)).toLocaleString()}`).join('\n');
}
/** Keeps retry/failover context visible instead of losing structured fields. */
export function webshellEventMessage(event: AiEvent): string {
  const data = event.data;
  if (event.type === 'eino_model_retry') return (event.message || 'The model call hit a temporary problem; Eino is retrying natively…') + (data.reason ? '\nReason: ' + String(data.reason) : '') + (data.error ? '\nError detail: ' + String(data.error) : '');
  if (event.type === 'eino_model_failover') return (event.message || 'Primary model retries exhausted; switching to the fallback model.') + (data.channel ? '\nChannel: ' + String(data.channel) : '') + (data.model ? '\nModel: ' + String(data.model) : '');
  return event.message;
}
