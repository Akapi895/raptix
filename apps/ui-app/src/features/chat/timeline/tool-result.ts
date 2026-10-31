// The tool calls of the timeline: the arguments a call carries, the title it shows, and what its result means: a success,
// an error, a block by the tool guard, a cancel, or work that is still running in the background. Pure: the wording comes
// in through `t`.

export type TimelineTranslate = (key: string, values?: Record<string, unknown>) => string;

export interface ToolCallData {
  argumentsObj?: unknown;
  arguments?: unknown;
}

export type ToolDisplayKind = 'success' | 'error' | 'blocked' | 'cancelled' | 'background_running';

export interface ToolDisplayState {
  kind: ToolDisplayKind;
  isError: boolean;
  success: boolean;
}

export interface ToolResultData {
  toolName?: unknown;
  name?: unknown;
  displayStatus?: unknown;
  status?: unknown;
  success?: unknown;
  isError?: unknown;
  executionId?: unknown;
  result?: unknown;
  error?: unknown;
  content?: unknown;
  resultPreview?: unknown;
  blocked?: unknown;
  _meta?: unknown;
  text?: unknown;
  processDetailId?: unknown;
  _payloadDeferred?: unknown;
}

const OBSERVATION_TOOLS = new Set(['wait_tool_execution', 'get_tool_execution']);

/** The arguments of a call: the object it carries, or the JSON text of it (kept raw when that text is not JSON). */
export function parseToolCallArgs(data: ToolCallData | null | undefined): Record<string, unknown> {
  if (!data) return {};
  let args = data.argumentsObj;
  if (args == null && data.arguments != null && String(data.arguments).trim() !== '') {
    try {
      args = JSON.parse(String(data.arguments));
    } catch {
      args = { _raw: String(data.arguments) };
    }
  }
  if (args == null || typeof args !== 'object') return {};
  return args as Record<string, unknown>;
}

export function toolCallArgsEmpty(args: unknown): boolean {
  if (args == null) return true;
  if (typeof args !== 'object') return false;
  if (Array.isArray(args)) return args.length === 0;
  return Object.keys(args).length === 0;
}

export function formatToolCallTitle(toolName: unknown, index: number, total: number, t: TimelineTranslate): string {
  const name = toolName ? String(toolName) : t('chat.unknownTool');
  return t('chat.callTool', { name, index: index || 0, total: total || 0 });
}

/** The text pieces of a result, found through its nested shapes (up to four levels down). */
export function collectToolResultTextParts(value: unknown, parts: string[], depth: number): void {
  if (value == null || depth > 4) return;
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(v => collectToolResultTextParts(v, parts, depth + 1));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') parts.push(record.text);
  if (typeof record.result === 'string') parts.push(record.result);
  if (typeof record.error === 'string') parts.push(record.error);
  if (record.content != null) collectToolResultTextParts(record.content, parts, depth + 1);
}

/**
 * Whether a result was blocked by the tool guard. Older records had no structured marker, so only the exact guard prefix at
 * the start of a result counts; a quoted mention in ordinary output does not.
 */
export function isToolGuardBlockedResult(value: unknown, depth = 0, allowLegacy = true): boolean {
  if (value == null || depth > 5) return false;
  if (typeof value === 'string') {
    const text = value.trimStart();
    if (allowLegacy && /^\u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a(?:[:\uff1a\r\n]|$)/.test(text)) return true;
    if (text.startsWith('{')) {
      try {
        return isToolGuardBlockedResult(JSON.parse(text), depth + 1, allowLegacy);
      } catch {
        // Plain text that only looks like JSON.
      }
    }
    return false;
  }
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(part => isToolGuardBlockedResult(part, depth + 1, allowLegacy));
  const record = value as Record<string, unknown>;
  if (record.blocked === true || record.status === 'blocked' || record.displayStatus === 'blocked') return true;
  const meta = record._meta as Record<string, unknown> | undefined;
  if (meta && meta['raptix.ai/blocked'] === true) return true;
  if (record.success === true || record.isError === false || record.status === 'completed') allowLegacy = false;
  return ['result', 'error', 'content', 'text', 'resultPreview'].some(key => isToolGuardBlockedResult(record[key], depth + 1, allowLegacy));
}

/** The status word of an execution: blocked when the guard blocked it, else its own status in lower case. */
export function getToolExecutionDisplayStatus(execution: { status?: unknown } | null | undefined): string {
  return isToolGuardBlockedResult(execution) ? 'blocked' : String(execution?.status || 'unknown').toLowerCase();
}

/** What a result means for the screen. A poll of a background run counts as a success, and a run that is still going is not a failure. */
export function getToolResultDisplayState(data: ToolResultData | null | undefined, opts: { rawText?: unknown } = {}): ToolDisplayState {
  const record: ToolResultData = data ?? {};
  const allowLegacyBlock = record.success !== true && record.isError !== false && record.status !== 'completed';
  if (isToolGuardBlockedResult(record) || isToolGuardBlockedResult(opts.rawText, 0, allowLegacyBlock)) {
    return { kind: 'blocked', isError: true, success: false };
  }

  const toolName = String(record.toolName || record.name || '').trim().toLowerCase();
  const isObservationTool = OBSERVATION_TOOLS.has(toolName);
  const explicitStatus = String(record.displayStatus || record.status || '').toLowerCase();
  if (explicitStatus === 'background_running') {
    if (isObservationTool) return { kind: 'success', isError: false, success: true };
    return { kind: 'background_running', isError: false, success: false };
  }
  if (explicitStatus === 'cancelled' || explicitStatus === 'canceled') {
    return { kind: 'cancelled', isError: true, success: false };
  }

  const parts: string[] = [];
  if (opts.rawText != null) parts.push(String(opts.rawText));
  collectToolResultTextParts(record.result, parts, 0);
  collectToolResultTextParts(record.error, parts, 0);
  collectToolResultTextParts(record.content, parts, 0);
  if (record.executionId != null) parts.push('execution_id: ' + String(record.executionId));
  if (record.status != null) parts.push('status: ' + String(record.status));
  const text = parts.join('\n');

  const errorLike = record.isError === true || record.success === false;
  const hasExecutionId = !!record.executionId ||
    /execution[_-]?id\\?["']?\s*[:=]\s*\\?["']?[0-9a-f]{8}-[0-9a-f-]{12,}/i.test(text);
  const hasRunningStatus = /status\\?["']?\s*[:=]\s*\\?["']?(running|queued)\\?["']?/i.test(text) ||
    /\bstatus:\s*(running|queued)\b/i.test(text);
  const hasSoftWaitSignal = /(\u5de5\u5177\u5df2\u63d0\u4ea4\u5230\u540e\u53f0\u6267\u884c|\u672c\u6b21\u7b49\u5f85\u5df2\u5230\u8fbe|wait_timeout|wait timeout|background execution|\u540e\u53f0\u6267\u884c|\u4ecd\u672a\u5b8c\u6210|still running)/i.test(text);
  if (errorLike && hasExecutionId && hasRunningStatus && hasSoftWaitSignal) {
    if (isObservationTool) return { kind: 'success', isError: false, success: true };
    return { kind: 'background_running', isError: false, success: false };
  }
  return { kind: errorLike ? 'error' : 'success', isError: errorLike, success: !errorLike };
}

export function getBackgroundRunningToolLabel(t: TimelineTranslate): string {
  const translated = t('timeline.backgroundRunning');
  return translated && translated !== 'timeline.backgroundRunning' ? translated : 'Running in background';
}

/** The status a tool call shows, given how its result was read. */
export function toolDisplayStatusFromState(state: ToolDisplayState | null | undefined): string {
  if (!state) return 'completed';
  if (state.kind === 'background_running') return 'background_running';
  if (state.kind === 'cancelled') return 'cancelled';
  if (state.kind === 'blocked') return 'blocked';
  return state.isError ? 'failed' : 'completed';
}
