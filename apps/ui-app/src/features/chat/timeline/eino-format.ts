// The wording of the Eino steps on the timeline: the retries of a run and of a model call, the failover to a backup model, and
// the usage summary of a turn. Pure: the translation comes in through `t`, the locale of the numbers through `locale`.

import type { TimelineTranslate } from './tool-result';

export type EinoData = Record<string, unknown>;

const asData = (data: unknown): EinoData => (data && typeof data === 'object' ? (data as EinoData) : {});
const text = (value: unknown): string => String(value).trim();
const hasText = (value: unknown): boolean => value != null && text(value) !== '';

/** A translation, or the fallback when the page has none. */
function translated(t: TimelineTranslate, key: string, fallback: string): string {
  const value = t(key);
  return value && value !== key ? value : fallback;
}

/** The execution ids of two lists, merged: trimmed, without blanks or repeats, the first list first. */
export function mergeMcpExecutionIdLists(prev: unknown, next: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const value of arr) {
      const s = value != null ? String(value).trim() : '';
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  };
  add(prev);
  add(next);
  return out;
}

const RETRY_KINDS: Record<string, string> = {
  rate_limit: 'Rate limited / too many requests',
  retryable_http: 'Retryable HTTP error',
  upstream_server: 'Upstream server error',
  http_error: 'HTTP error',
  upstream_busy: 'Upstream busy',
  network: 'Network connection error',
  stream: 'Stream read error',
  transient: 'Transient error',
};

/** The reason of a retry, in the reader's words; its key is looked up first, then the Chinese label, then the key itself. */
export function formatEinoRunRetryKind(t: TimelineTranslate, kind: unknown): string {
  const key = String(kind || '').trim();
  if (!key) return '';
  const translatedKind = translated(t, 'chat.einoRunRetryKind_' + key, '');
  if (translatedKind) return translatedKind;
  return Object.prototype.hasOwnProperty.call(RETRY_KINDS, key) ? RETRY_KINDS[key] ?? key : key;
}

/** The lines of a run's retry: the message, the attempt and its wait, the reason kind, and the error when the message lacks it. */
export function formatEinoRunRetryMessage(t: TimelineTranslate, message: unknown, data: unknown): string {
  const d = asData(data);
  const base = String(message || '').trim();
  const errRaw = hasText(d.errorSummary)
    ? text(d.errorSummary)
    : (d.error != null ? text(d.error) : '');
  const lines: string[] = [];
  if (base) lines.push(base);
  const attempt = Number(d.attempt || 0);
  const maxAttempts = Number(d.maxAttempts || 0);
  const backoffSec = Number(d.backoffSec || 0);
  const kind = formatEinoRunRetryKind(t, d.errorKind);
  if (Number.isFinite(attempt) && attempt > 0 && Number.isFinite(maxAttempts) && maxAttempts > 0) {
    const retryPlan = t('chat.einoRunRetryPlan', { attempt, maxAttempts, backoffSec: Number.isFinite(backoffSec) && backoffSec > 0 ? backoffSec : '-' });
    if (!base || base.indexOf(String(attempt) + '/' + String(maxAttempts)) === -1) lines.push(retryPlan);
  }
  if (kind) lines.push(translated(t, 'chat.einoRunRetryReasonKind', 'Reason type') + ': ' + kind);
  if (!errRaw) return lines.join('\n');
  if (!base || base.indexOf(errRaw) === -1) {
    lines.push(translated(t, 'chat.einoRunRetryErrorDetail', 'Error detail') + ': ' + errRaw);
  }
  return lines.join('\n');
}

/** The title of a run's retry, with its attempt when it is known. */
export function formatEinoRunRetryTitle(t: TimelineTranslate, data: unknown): string {
  const d = asData(data);
  const base = t('chat.einoRunRetryTitle');
  const attempt = Number(d.attempt || 0);
  const maxAttempts = Number(d.maxAttempts || 0);
  if (Number.isFinite(attempt) && attempt > 0 && Number.isFinite(maxAttempts) && maxAttempts > 0) {
    return base + ` (${attempt}/${maxAttempts})`;
  }
  return base;
}

export function formatEinoModelRetryTitle(t: TimelineTranslate, data: unknown): string {
  const d = asData(data);
  const base = t('chat.einoModelRetryTitle');
  const attempt = Number(d.attempt || 0);
  return Number.isFinite(attempt) && attempt > 0 ? base + ` (${attempt})` : base;
}

export function formatEinoModelRetryMessage(message: unknown, data: unknown): string {
  const d = asData(data);
  const lines: string[] = [];
  const base = String(message || '').trim();
  if (base) lines.push(base);
  if (hasText(d.reason)) lines.push('Reason: ' + text(d.reason));
  if (hasText(d.error)) lines.push('Error detail: ' + text(d.error));
  return lines.join('\n');
}

export function formatEinoModelFailoverTitle(t: TimelineTranslate, data: unknown): string {
  const d = asData(data);
  const base = t('chat.einoModelFailoverTitle');
  const attempt = Number(d.attempt || 0);
  return Number.isFinite(attempt) && attempt > 0 ? base + ` (${attempt})` : base;
}

export function formatEinoModelFailoverMessage(message: unknown, data: unknown): string {
  const d = asData(data);
  const lines: string[] = [];
  const base = String(message || '').trim();
  if (base) lines.push(base);
  if (hasText(d.channel)) lines.push('Channel: ' + text(d.channel));
  if (hasText(d.model)) lines.push('Model: ' + text(d.model));
  return lines.join('\n');
}

/** A count with the thousands grouped, in the reader's locale. */
export function formatCompactInteger(value: unknown, locale: string): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  try {
    return Math.max(0, Math.trunc(n)).toLocaleString(locale);
  } catch {
    return String(Math.max(0, Math.trunc(n)));
  }
}

export function formatEinoUsageSummaryTitle(t: TimelineTranslate, data: unknown, locale: string): string {
  const d = asData(data);
  const base = translated(t, 'chat.einoUsageSummaryTitle', 'Token usage summary');
  const total = Number(d.totalTokens || 0);
  if (Number.isFinite(total) && total > 0) return base + ' · ' + formatCompactInteger(total, locale);
  return base;
}

/** The usage of a turn, one line per count; cached, cache-write and reasoning counts appear only when they are not zero. */
export function formatEinoUsageSummaryMessage(t: TimelineTranslate, data: unknown, locale: string): string {
  const d = asData(data);
  const label = (key: string, fallback: string) => translated(t, key, fallback);
  const rows: [string, unknown][] = [
    [label('chat.einoUsageModelCalls', 'Model calls'), d.modelCalls],
    [label('chat.einoUsagePromptTokens', 'Prompt tokens'), d.promptTokens],
    [label('chat.einoUsageCompletionTokens', 'Completion tokens'), d.completionTokens],
    [label('chat.einoUsageTotalTokens', 'Total tokens'), d.totalTokens],
  ];
  if (Number(d.cachedTokens || 0) > 0) rows.push([label('chat.einoUsageCachedTokens', 'Cached tokens'), d.cachedTokens]);
  if (Number(d.cacheWriteTokens || 0) > 0) rows.push([label('chat.einoUsageCacheWriteTokens', 'Cache write tokens'), d.cacheWriteTokens]);
  if (Number(d.reasoningTokens || 0) > 0) rows.push([label('chat.einoUsageReasoningTokens', 'Reasoning tokens'), d.reasoningTokens]);
  return rows.map(([name, value]) => name + ': ' + formatCompactInteger(value, locale)).join('\n');
}

const TASK_TOOLS = ['taskcreate', 'taskupdate', 'tasklist', 'taskget'];

/** The plan-task calls and results are passed on to the agent-plan listeners; other events are not. */
export function agentPlanTaskDetail(event: { type?: string; data?: unknown } | null | undefined, fallbackConversationId: string, currentConversationId: string): { eventType: string; conversationId: string; data: EinoData } | null {
  if (!event || (event.type !== 'tool_call' && event.type !== 'tool_result')) return null;
  const data = asData(event.data);
  const toolName = String(data.toolName || '').trim().toLowerCase();
  if (!TASK_TOOLS.includes(toolName)) return null;
  const conversationId = String(data.conversationId || fallbackConversationId || currentConversationId || '').trim();
  if (!conversationId) return null;
  return { eventType: String(event.type), conversationId, data };
}

/** Marks a sub-agent or orchestrator item with its role and scope, so that the left border and tint follow them. */
export function applyEinoTimelineRole(item: HTMLElement, data: { einoRole?: unknown; einoScope?: unknown } | null | undefined): void {
  if (!item || !data) return;
  const role = data.einoRole;
  if (role === 'orchestrator' || role === 'sub') {
    item.dataset.einoRole = role;
    item.classList.add('timeline-eino-role-' + role);
  }
  const scope = data.einoScope;
  if (scope === 'main' || scope === 'sub') {
    item.dataset.einoScope = scope;
    item.classList.add('timeline-eino-scope-' + scope);
  }
}
