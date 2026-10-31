// The chat input's draft: saved while typing (debounced), restored into an empty input, and cleared once a message is
// sent. The placeholder is never stored as a draft, and a stored placeholder-only draft is discarded.

import type { KeyValueStorage } from '../../../platform/storage';

export const DRAFT_STORAGE_KEY = 'raptix-chat-draft';
export const DRAFT_SAVE_DELAY_MS = 500;
const MIN_INPUT_HEIGHT_PX = 40;
const MAX_INPUT_HEIGHT_PX = 300;

/** What to store for a draft: the content as typed, or null when it is empty or only the placeholder. */
export function draftToStore(content: string, placeholder: string): string | null {
  const trimmed = (content || '').trim();
  if (trimmed && (!placeholder || trimmed !== placeholder)) return content;
  return null;
}

export interface DraftRestorePlan {
  /** The value to write into the input, or null to leave it as it is. */
  input: string | null;
  /** True when the input receives the stored draft (its height must follow). */
  restored: boolean;
  removeStored: boolean;
}

/** Decides what restoring a draft does, given the input's current value and the stored draft. */
export function planDraftRestore(current: string, stored: string | null, placeholder: string): DraftRestorePlan {
  // A placeholder that ended up as the value is not content: show the real placeholder again.
  const pending = placeholder && current.trim() === placeholder ? '' : current;
  const cleanedInput = pending === current ? null : pending;
  if (pending.trim().length > 0) return { input: cleanedInput, restored: false, removeStored: false };
  const trimmed = stored ? stored.trim() : '';
  if (trimmed && (!placeholder || trimmed !== placeholder)) return { input: stored, restored: true, removeStored: false };
  return { input: cleanedInput, restored: false, removeStored: !!trimmed && trimmed === placeholder };
}

/** Sizes the textarea to its content, between a line and a tall block; an empty input collapses to one line. */
export function fitTextareaHeight(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.style.height = 'auto';
  void textarea.offsetHeight;
  const next = Math.min(Math.max(textarea.scrollHeight, MIN_INPUT_HEIGHT_PX), MAX_INPUT_HEIGHT_PX);
  textarea.style.height = next + 'px';
  if (!textarea.value || textarea.value.trim().length === 0) {
    textarea.style.height = MIN_INPUT_HEIGHT_PX + 'px';
  }
}

export interface DraftDependencies {
  storage: KeyValueStorage;
  /** The chat input; null while the page does not have one. */
  input(): HTMLTextAreaElement | null;
  setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> | number;
  clearTimer(handle: ReturnType<typeof setTimeout> | number): void;
}

export interface DraftController {
  /** Saves after a pause in typing; a newer change replaces the pending save. */
  saveDebounced(content: string): void;
  /** Drops a pending save, so a save scheduled before a send cannot bring the draft back. */
  cancelPending(): void;
  save(content: string): void;
  /** Restores the stored draft into an empty input; reports whether it did. */
  restore(): boolean;
  clear(): void;
}

export function createDraftController(deps: DraftDependencies): DraftController {
  const { storage } = deps;
  let timer: ReturnType<typeof setTimeout> | number | null = null;

  const placeholder = (): string => {
    const input = deps.input();
    return input ? (input.getAttribute('placeholder') || '').trim() : '';
  };

  function cancelPending(): void {
    if (timer) deps.clearTimer(timer);
    timer = null;
  }

  function save(content: string): void {
    const stored = draftToStore(content, placeholder());
    if (stored !== null) storage.set(DRAFT_STORAGE_KEY, stored);
    else storage.remove(DRAFT_STORAGE_KEY);
  }

  return {
    saveDebounced(content) {
      cancelPending();
      timer = deps.setTimer(() => {
        timer = null;
        save(content);
      }, DRAFT_SAVE_DELAY_MS);
    },
    cancelPending,
    save,
    restore() {
      const input = deps.input();
      if (!input) return false;
      const plan = planDraftRestore(input.value, storage.get(DRAFT_STORAGE_KEY), placeholder());
      if (plan.input !== null) input.value = plan.input;
      if (plan.removeStored) storage.remove(DRAFT_STORAGE_KEY);
      if (plan.restored) fitTextareaHeight(input);
      return plan.restored;
    },
    clear() {
      storage.remove(DRAFT_STORAGE_KEY);
    },
  };
}
