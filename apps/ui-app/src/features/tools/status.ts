// Tool-call status derived from execution records and tool results. Shared by the MCP monitor and the
// chat timeline; the record shapes come from internal/handler/monitor.go and the agent streams.

const LEGACY_GUARD_PREFIX = /^\u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a(?:[:\uff1a\r\n]|$)/;

/**
 * Whether a value says the tool call was stopped by the tool guard. Accepts JSON text, nested results and
 * the legacy plain-text prefix. The legacy prefix is ignored once a value is known to be a success.
 */
export function isToolGuardBlockedResult(value: unknown, depth = 0, allowLegacy = true): boolean {
  if (value == null || depth > 5) return false;
  if (typeof value === 'string') {
    const text = value.trimStart();
    if (allowLegacy && LEGACY_GUARD_PREFIX.test(text)) return true;
    if (text.startsWith('{')) {
      try { return isToolGuardBlockedResult(JSON.parse(text), depth + 1, allowLegacy); } catch { /* Plain text. */ }
    }
    return false;
  }
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(part => isToolGuardBlockedResult(part, depth + 1, allowLegacy));
  const record = value as Record<string, unknown>;
  if (record.blocked === true || record.status === 'blocked' || record.displayStatus === 'blocked') return true;
  const meta = record._meta as Record<string, unknown> | undefined;
  if (meta && meta['raptix.ai/blocked'] === true) return true;
  const known = record.success === true || record.isError === false || record.status === 'completed';
  const legacy = known ? false : allowLegacy;
  return ['result', 'error', 'content', 'text', 'resultPreview'].some(key => isToolGuardBlockedResult(record[key], depth + 1, legacy));
}

/** The status a monitor row shows: a guard block wins over the stored status. */
export function getToolExecutionDisplayStatus(execution: { status?: unknown; [key: string]: unknown } | null | undefined): string {
  if (isToolGuardBlockedResult(execution)) return 'blocked';
  return String(execution?.status || 'unknown').toLowerCase();
}
