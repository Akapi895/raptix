// The summary line of an assistant turn ("Elapsed 12s · 3.4K tokens"): kept on the message element as data, redrawn
// from it, and refreshed once a second while the turn runs.

import { escapeHtml } from '../../../ui/format';
import type { Translate } from '../messages/text';
import {
  extractTokenUsage, formatTurnDuration, normalizeTokenUsage, mergeTokenUsage, terminalState, tokenUsageLabel, tokenUsageTitle,
  turnSummaryText, turnTimestamp, type TurnTokenUsage,
} from './turn';

export interface TurnTiming {
  startedAt?: unknown;
  completedAt?: unknown;
  status?: string;
  durationMs?: unknown;
}

export interface TurnSummaryDependencies {
  doc: Document;
  t: Translate;
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface TurnSummary {
  setTokenUsage(target: HTMLElement | string | null, usage: unknown): void;
  tokenUsage(element: HTMLElement | null): TurnTokenUsage | null;
  setTiming(target: HTMLElement | string | null, timing: TurnTiming | null | undefined): void;
  sync(target: HTMLElement | string | null): void;
  syncRunning(): void;
  syncClock(): void;
  /** The terminal state of a turn's process details, for the caller that stores it. */
  terminal: typeof terminalState;
  /** The usage of a turn's process details, for the caller that stores it. */
  extract: typeof extractTokenUsage;
  merge: typeof mergeTokenUsage;
  normalize: typeof normalizeTokenUsage;
}

const TOKEN_KEYS = [
  ['turnModelCalls', 'modelCalls'],
  ['turnPromptTokens', 'promptTokens'],
  ['turnCompletionTokens', 'completionTokens'],
  ['turnTotalTokens', 'totalTokens'],
  ['turnCachedTokens', 'cachedTokens'],
  ['turnCacheWriteTokens', 'cacheWriteTokens'],
  ['turnReasoningTokens', 'reasoningTokens'],
] as const;

export function createTurnSummary(deps: TurnSummaryDependencies): TurnSummary {
  const { doc, t } = deps;
  let elapsedTimer: unknown = null;

  function resolve(target: HTMLElement | string | null): HTMLElement | null {
    return typeof target === 'string' ? doc.getElementById(target) : target;
  }

  function setTokenUsage(target: HTMLElement | string | null, usage: unknown): void {
    const element = resolve(target);
    if (!element?.dataset) return;
    const normalized = normalizeTokenUsage(usage);
    if (!normalized) {
      for (const [key] of TOKEN_KEYS) delete element.dataset[key];
      delete element.dataset.turnModel;
      sync(element);
      return;
    }
    for (const [key, field] of TOKEN_KEYS) element.dataset[key] = String(normalized[field] || 0);
    if (normalized.model) element.dataset.turnModel = normalized.model;
    else delete element.dataset.turnModel;
    sync(element);
  }

  function tokenUsage(element: HTMLElement | null): TurnTokenUsage | null {
    if (!element?.dataset) return null;
    const data: Record<string, unknown> = { model: element.dataset.turnModel };
    for (const [key, field] of TOKEN_KEYS) data[field] = element.dataset[key];
    return normalizeTokenUsage(data);
  }

  function setTiming(target: HTMLElement | string | null, timing: TurnTiming | null | undefined): void {
    const element = resolve(target);
    if (!element?.dataset) return;
    const value = timing || {};
    if (value.startedAt) element.dataset.turnStartedAt = String(value.startedAt);
    if (value.completedAt) element.dataset.turnCompletedAt = String(value.completedAt);
    if (value.status) element.dataset.turnStatus = String(value.status);
    const status = String(element.dataset.turnStatus || 'completed');
    if (status === 'running') {
      // A running task reports a zero duration; keeping that snapshot would freeze the timer at zero after a reload.
      delete element.dataset.turnDurationMs;
      delete element.dataset.turnCompletedAt;
    } else {
      const explicit = Number(value.durationMs);
      if (Number.isFinite(explicit) && explicit >= 0) element.dataset.turnDurationMs = String(Math.round(explicit));
      const startedAt = turnTimestamp(element.dataset.turnStartedAt);
      const completedAt = turnTimestamp(element.dataset.turnCompletedAt);
      if ((!Number.isFinite(explicit) || explicit < 0) && Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
        element.dataset.turnDurationMs = String(completedAt - startedAt);
      }
    }
    sync(element);
    syncClock();
  }

  function sync(target: HTMLElement | string | null): void {
    const element = resolve(target);
    if (!element) return;
    const label = element.querySelector<HTMLElement>('.mcp-call-label.turn-process-summary');
    if (!label) return;
    const timeline = element.querySelector('.process-details-container .progress-timeline');
    const expanded = !!timeline?.classList.contains('expanded');
    const status = String(element.dataset.turnStatus || 'completed');
    let durationMs = Number(element.dataset.turnDurationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      const startedAt = turnTimestamp(element.dataset.turnStartedAt);
      const completedAt = status === 'running' ? deps.now() : turnTimestamp(element.dataset.turnCompletedAt);
      durationMs = Number.isFinite(startedAt) && Number.isFinite(completedAt) ? Math.max(0, completedAt - startedAt) : 0;
    }
    const duration = formatTurnDuration(durationMs, t);
    const usage = tokenUsage(element);
    const usageHtml = usage
      ? '<span class="turn-process-token-chip" title="' + escapeHtml(tokenUsageTitle(usage, t)) + '">' + escapeHtml(tokenUsageLabel(usage, t)) + '</span>'
      : '';
    const text = turnSummaryText(status, duration, t);
    label.innerHTML = `
        <span class="turn-process-leading">
            <span class="turn-process-status-dot${status === 'running' ? ' is-running' : ''}" aria-hidden="true"></span>
            <span class="turn-process-summary-text">${escapeHtml(text)}</span>
            ${usageHtml}
        </span>
        <svg class="turn-process-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.5 5.5L12 10l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    `;
    label.classList.toggle('is-expanded', expanded);
    label.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    label.setAttribute('aria-label', t('chat.turnProcessAria', text + '. Expand or collapse the execution process', { state: text }));
  }

  function syncRunning(): void {
    const running = doc.querySelectorAll<HTMLElement>('#chat-messages .message.assistant[data-turn-status="running"]');
    running.forEach(element => sync(element));
    if (running.length === 0 && elapsedTimer) {
      deps.clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function syncClock(): void {
    const hasRunning = !!doc.querySelector('#chat-messages .message.assistant[data-turn-status="running"]');
    if (hasRunning && !elapsedTimer) {
      elapsedTimer = deps.setInterval(syncRunning, 1000);
    } else if (!hasRunning && elapsedTimer) {
      deps.clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  return {
    setTokenUsage,
    tokenUsage,
    setTiming,
    sync,
    syncRunning,
    syncClock,
    terminal: terminalState,
    extract: extractTokenUsage,
    merge: mergeTokenUsage,
    normalize: normalizeTokenUsage,
  };
}
