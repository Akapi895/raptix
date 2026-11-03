// Reasoning controls of the session settings card: the mode (default/off/on/auto) and the effort level. The
// choice is kept in two hidden selects (the source of truth), mirrored to localStorage, and sent with each message.

import type { KeyValueStorage } from '../../../platform/storage';

export const REASONING_MODES = ['default', 'off', 'on', 'auto'] as const;
export const REASONING_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const REASONING_MODE_STORAGE_KEY = 'raptix-chat-reasoning-mode';
export const REASONING_EFFORT_STORAGE_KEY = 'raptix-chat-reasoning-effort';

export type ReasoningMode = typeof REASONING_MODES[number];
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export interface ReasoningRequest { mode?: Exclude<ReasoningMode, 'default'>; effort?: Exclude<ReasoningEffort, ''> }
export type Translate = (key: string, fallback: string) => string;

export function normalizeReasoningMode(value: unknown): ReasoningMode {
  const v = String(value ?? '').trim();
  return (REASONING_MODES as readonly string[]).includes(v) ? v as ReasoningMode : 'default';
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const v = String(value ?? '').trim();
  return (REASONING_EFFORTS as readonly string[]).includes(v) ? v as ReasoningEffort : '';
}

export function reasoningModeLabel(mode: string | undefined, t: Translate): string {
  switch (String(mode || 'default').trim()) {
    case 'off': return t('chat.reasoningModeOff', 'Off');
    case 'on': return t('chat.reasoningModeOn', 'On');
    case 'auto': return t('chat.reasoningModeAuto', 'Auto');
    default: return t('chat.reasoningSummaryFollow', 'System');
  }
}

export function reasoningEffortLabel(effort: ReasoningEffort, t: Translate): string {
  return effort || t('chat.reasoningEffortUnset', 'Unspecified');
}

/** The short label of the composer shortcut: "off" wins, then an explicit effort, then the mode. */
export function reasoningMenuLabel(mode: ReasoningMode, effort: ReasoningEffort, t: Translate): string {
  if (mode === 'off') return t('chat.reasoningModeOff', 'Off');
  return effort ? effort : reasoningModeLabel(mode, t);
}

/** The `reasoning` field of a chat request; undefined when both controls are left at their defaults. */
export function reasoningRequest(mode: ReasoningMode, effort: ReasoningEffort): ReasoningRequest | undefined {
  if (mode === 'default' && !effort) return undefined;
  const request: ReasoningRequest = {};
  if (mode !== 'default') request.mode = mode;
  if (effort) request.effort = effort;
  return request;
}

export interface ReasoningControlsDependencies {
  doc: Document;
  storage: KeyValueStorage;
  refreshSessionSettings(): void;
  updateSummary(): void;
}

export interface ReasoningControls {
  current(): { mode: ReasoningMode; effort: ReasoningEffort };
  setMode(mode: unknown): void;
  setEffort(effort: unknown): void;
  /** Applies the stored choices to the selects, leaving them alone when the stored value is unknown. */
  restoreFromStorage(): void;
  persist(): void;
  /** The `reasoning` field for the next request, or undefined while the card is hidden. */
  requestField(): ReasoningRequest | undefined;
}

export function createReasoningControls(deps: ReasoningControlsDependencies): ReasoningControls {
  const { doc, storage } = deps;
  const modeSelect = () => doc.getElementById('chat-reasoning-mode') as HTMLSelectElement | null;
  const effortSelect = () => doc.getElementById('chat-reasoning-effort') as HTMLSelectElement | null;

  function current() {
    return {
      mode: normalizeReasoningMode(modeSelect()?.value),
      effort: normalizeReasoningEffort(effortSelect()?.value),
    };
  }

  function restoreFromStorage(): void {
    const mode = modeSelect();
    const effort = effortSelect();
    const storedMode = storage.get(REASONING_MODE_STORAGE_KEY);
    const storedEffort = storage.get(REASONING_EFFORT_STORAGE_KEY);
    if (mode && storedMode && (REASONING_MODES as readonly string[]).includes(storedMode)) mode.value = storedMode;
    if (effort && storedEffort !== null && (REASONING_EFFORTS as readonly string[]).includes(storedEffort)) effort.value = storedEffort;
    deps.refreshSessionSettings();
    deps.updateSummary();
  }

  function persist(): void {
    const { mode, effort } = current();
    storage.set(REASONING_MODE_STORAGE_KEY, mode);
    storage.set(REASONING_EFFORT_STORAGE_KEY, effort);
    deps.refreshSessionSettings();
    deps.updateSummary();
  }

  function requestField(): ReasoningRequest | undefined {
    const wrap = doc.getElementById('chat-reasoning-wrapper');
    if (!wrap || wrap.style.display === 'none' || !modeSelect()) return undefined;
    const { mode, effort } = current();
    return reasoningRequest(mode, effort);
  }

  return {
    current,
    setMode(mode) {
      const select = modeSelect();
      if (select) select.value = normalizeReasoningMode(mode);
    },
    setEffort(effort) {
      const select = effortSelect();
      if (select) select.value = normalizeReasoningEffort(effort);
    },
    restoreFromStorage,
    persist,
    requestField,
  };
}
