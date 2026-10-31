// A turn of the assistant: how long it took, how many tokens it used, and how it ended. These are the pure rules; the
// summary line that shows them is drawn by turn-summary.ts.

import type { Translate } from '../messages/text';

export interface TurnTokenUsage {
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  model: string;
}

export type TurnStatus = 'running' | 'completed' | 'cancelled' | 'timeout' | 'failed';

export function formatTurnDuration(durationMs: unknown, t: Translate): string {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return t('chat.turnDurationHours', `${hours} h ${minutes} min`, { hours, minutes });
  if (minutes > 0) return t('chat.turnDurationMinutes', `${minutes} min ${seconds} s`, { minutes, seconds });
  return t('chat.turnDurationSeconds', `${seconds} s`, { seconds });
}

export function usageNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** A usage record as the server sends it; null when it counts no tokens at all. */
export function normalizeTokenUsage(data: unknown): TurnTokenUsage | null {
  const source = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const usage: TurnTokenUsage = {
    modelCalls: usageNumber(source.modelCalls),
    promptTokens: usageNumber(source.promptTokens),
    completionTokens: usageNumber(source.completionTokens),
    totalTokens: usageNumber(source.totalTokens),
    cachedTokens: usageNumber(source.cachedTokens),
    cacheWriteTokens: usageNumber(source.cacheWriteTokens),
    reasoningTokens: usageNumber(source.reasoningTokens),
    model: source.model != null ? String(source.model).trim() : '',
  };
  if (usage.totalTokens <= 0 && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
    usage.totalTokens = usage.promptTokens + usage.completionTokens;
  }
  return usage.totalTokens > 0 ? usage : null;
}

const EMPTY_USAGE: TurnTokenUsage = {
  modelCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, model: '',
};

/** Adds one usage record to a total. Returns the total, or null while nothing has been counted. */
export function mergeTokenUsage(target: TurnTokenUsage | null, usage: TurnTokenUsage | null): TurnTokenUsage | null {
  if (!usage) return target || null;
  const out = target || { ...EMPTY_USAGE };
  out.modelCalls += usage.modelCalls || 0;
  out.promptTokens += usage.promptTokens || 0;
  out.completionTokens += usage.completionTokens || 0;
  out.totalTokens += usage.totalTokens || 0;
  out.cachedTokens += usage.cachedTokens || 0;
  out.cacheWriteTokens += usage.cacheWriteTokens || 0;
  out.reasoningTokens += usage.reasoningTokens || 0;
  if (!out.model && usage.model) out.model = usage.model;
  return out.totalTokens > 0 ? out : null;
}

/** The turn's usage, summed over its usage summaries in the process details. */
export function extractTokenUsage(processDetails: unknown): TurnTokenUsage | null {
  if (!Array.isArray(processDetails)) return null;
  let total: TurnTokenUsage | null = null;
  processDetails.forEach((detail: { eventType?: unknown; data?: unknown } | null) => {
    if (!detail || String(detail.eventType || '').trim() !== 'eino_usage_summary') return;
    total = mergeTokenUsage(total, normalizeTokenUsage(detail.data));
  });
  return total;
}

/** Compact counts: 1.2K, 3M. Whole numbers below a thousand. */
export function formatTokenCount(value: unknown): string {
  const n = usageNumber(value);
  if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function tokenUsageLabel(usage: TurnTokenUsage | null, t: Translate): string {
  const tokens = formatTokenCount(usage?.totalTokens);
  return t('chat.turnTokenUsageLabel', `${tokens} tokens`, { tokens });
}

export function tokenUsageTitle(usage: TurnTokenUsage | null, t: Translate): string {
  const safe = usage || { ...EMPTY_USAGE };
  const values = {
    total: formatTokenCount(safe.totalTokens),
    prompt: formatTokenCount(safe.promptTokens),
    completion: formatTokenCount(safe.completionTokens),
    cached: formatTokenCount(safe.cachedTokens),
    cacheWrite: formatTokenCount(safe.cacheWriteTokens),
    reasoning: formatTokenCount(safe.reasoningTokens),
    calls: formatTokenCount(safe.modelCalls),
    model: safe.model || '',
  };
  return t('chat.turnTokenUsageTitle', `Token usage: ${values.total} (input ${values.prompt}, output ${values.completion})`, values);
}

/** The time a turn stamp names, or NaN when it names none. */
export function turnTimestamp(value: unknown): number {
  if (value == null || value === '') return NaN;
  const n = new Date(value as string).getTime();
  return Number.isFinite(n) ? n : NaN;
}

export interface TerminalState {
  status: 'cancelled' | 'timeout' | 'failed';
  completedAt: unknown;
  detail: Record<string, unknown>;
}

/** How the turn ended, when the last terminal row of the process details says it did not complete. */
export function terminalState(processDetails: unknown): TerminalState | null {
  if (!Array.isArray(processDetails)) return null;
  for (let i = processDetails.length - 1; i >= 0; i--) {
    const detail = (processDetails[i] || {}) as Record<string, unknown>;
    const eventType = String(detail.eventType || '').trim().toLowerCase();
    const completedAt = detail.createdAt || null;
    if (eventType === 'cancelled') return { status: 'cancelled', completedAt, detail };
    if (eventType === 'timeout') return { status: 'timeout', completedAt, detail };
    if (eventType === 'error') return { status: 'failed', completedAt, detail };
  }
  return null;
}

/** The sentence of the summary line for a status and a duration. */
export function turnSummaryText(status: string, duration: string, t: Translate): string {
  switch (status) {
    case 'running': return t('chat.turnElapsedRunning', `Processed for ${duration}`, { duration });
    case 'cancelled': return t('chat.turnElapsedCancelled', `Interrupted · took ${duration}`, { duration });
    case 'timeout': return t('chat.turnElapsedTimeout', `Timed out · took ${duration}`, { duration });
    case 'failed': return t('chat.turnElapsedFailed', `Failed · took ${duration}`, { duration });
    default: return t('chat.turnElapsedComplete', `Took ${duration}`, { duration });
  }
}
