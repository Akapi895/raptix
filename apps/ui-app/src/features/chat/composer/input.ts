// The chat input's events: Enter sends and Shift+Enter keeps the line break, the @-mention follows the caret, the
// draft follows the text, and the input-method composition is tracked so that the Enter which confirms a candidate
// is not taken as a send.

import type { MentionController } from './mention';
import { browser } from '@/platform/browser';

export interface ComposerInputDependencies {
  input(): HTMLTextAreaElement | null;
  mention: MentionController;
  fitHeight(textarea: HTMLTextAreaElement): void;
  saveDraftDebounced(value: string): void;
  saveDraftNow(value: string): void;
  send(): void;
}

/** Binds the input's events. Returns the function that removes them. */
export function bindComposerInput(deps: ComposerInputDependencies): () => void {
  const input = deps.input();
  if (!input) return () => undefined;

  let composing = false;
  let composingEndTimer: number | null = null;
  let blurTimer: number | undefined;
  let heightFrame: number | undefined;
  const clearComposingTimer = () => {
    if (composingEndTimer) browser.clearTimeout(composingEndTimer);
    composingEndTimer = null;
  };

  const onKeydown = (event: KeyboardEvent) => {
    // Safari can fire compositionend before the Enter that confirms a candidate, so keyCode 229 is checked too.
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (deps.mention.handleKey(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      deps.send();
    }
  };
  const onInput = () => {
    deps.mention.update(input);
    if (heightFrame) browser.cancelAnimationFrame(heightFrame);
    heightFrame = browser.requestAnimationFrame(() => { heightFrame = undefined; deps.fitHeight(input); });
    deps.saveDraftDebounced(input.value);
  };
  const onCaretMove = () => deps.mention.update(input);
  const onCompositionStart = () => {
    clearComposingTimer();
    composing = true;
  };
  const onCompositionEnd = () => {
    clearComposingTimer();
    composingEndTimer = browser.setTimeout(() => {
      composing = false;
      composingEndTimer = null;
    }, 0);
  };
  const onBlur = () => {
    browser.clearTimeout(blurTimer);
    blurTimer = browser.setTimeout(() => {
      if (!input.matches(':focus')) deps.mention.deactivate();
    }, 120);
    if (input.value) deps.saveDraftNow(input.value);
  };

  input.addEventListener('keydown', onKeydown);
  input.addEventListener('input', onInput);
  input.addEventListener('click', onCaretMove);
  input.addEventListener('focus', onCaretMove);
  input.addEventListener('compositionstart', onCompositionStart);
  input.addEventListener('compositionend', onCompositionEnd);
  input.addEventListener('blur', onBlur);

  return () => {
    input.removeEventListener('keydown', onKeydown);
    input.removeEventListener('input', onInput);
    input.removeEventListener('click', onCaretMove);
    input.removeEventListener('focus', onCaretMove);
    input.removeEventListener('compositionstart', onCompositionStart);
    input.removeEventListener('compositionend', onCompositionEnd);
    input.removeEventListener('blur', onBlur);
    clearComposingTimer();
    browser.clearTimeout(blurTimer);
    if (heightFrame) browser.cancelAnimationFrame(heightFrame);
  };
}
