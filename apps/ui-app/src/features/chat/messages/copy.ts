// Copying a message: the Markdown source when the message keeps it, otherwise the visible text. The Clipboard API is
// used when the page may use it; otherwise the copy goes through a hidden textarea.

export interface CopyDependencies {
  doc: Document;
  clipboard(): { writeText(text: string): Promise<void> } | null;
  /** Copies through the document's copy command; reports whether the browser accepted it. */
  execCopy(text: string): boolean;
  t(key: string, fallback: string): string;
  alert(text: string): void;
  onCopied(button: HTMLElement | null): void;
  error(message: string, error: unknown): void;
}

/** The text a copy of the bubble produces when the message has no stored source: the bubble text without the button. */
export function visibleBubbleText(bubble: HTMLElement, doc: Document): string {
  const temp = doc.createElement('div');
  temp.innerHTML = bubble.innerHTML;
  temp.querySelector('.message-copy-btn')?.remove();
  const text = temp.textContent || '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function copyText(text: string, button: HTMLElement | null, deps: CopyDependencies): void {
  const fallback = (value: string) => {
    try {
      if (!deps.execCopy(value)) throw new Error('execCommand copy failed');
      deps.onCopied(button);
    } catch (error) {
      deps.error('Fallback copy failed:', error);
      deps.alert(deps.t('chat.copyFailedManual', 'Copy failed, please select and copy manually'));
    }
  };
  const clipboard = deps.clipboard();
  if (!clipboard) {
    fallback(text);
    return;
  }
  clipboard.writeText(text).then(() => deps.onCopied(button), err => {
    deps.error('Clipboard API copy failed:', err);
    fallback(text);
  });
}

/** Copies a message's text. Errors are reported to the user, never thrown. */
export function copyMessage(messageDiv: HTMLElement, button: HTMLElement | null, deps: CopyDependencies): void {
  try {
    const original = messageDiv.dataset.originalContent;
    if (original) {
      copyText(original, button, deps);
      return;
    }
    const bubble = messageDiv.querySelector<HTMLElement>('.message-bubble');
    if (bubble) copyText(visibleBubbleText(bubble, deps.doc), button, deps);
  } catch (error) {
    deps.error('Failed to copy message:', error);
    deps.alert(deps.t('chat.copyFailedManual', 'Copy failed, please select and copy manually'));
  }
}

/** Marks a copy button as done for two seconds, then restores its label. */
export function showCopySuccess(button: HTMLElement | null, t: (key: string, fallback: string) => string, setTimer: (callback: () => void, ms: number) => unknown): void {
  if (!button) return;
  const originalText = button.innerHTML;
  button.dataset.copySuccessActive = '1';
  button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span>' + t('common.copied', 'Copied') + '</span>';
  button.style.color = '#10b981';
  button.style.background = 'rgba(16, 185, 129, 0.1)';
  button.style.borderColor = 'rgba(16, 185, 129, 0.3)';
  setTimer(() => {
    delete button.dataset.copySuccessActive;
    button.innerHTML = originalText;
    button.style.color = '';
    button.style.background = '';
    button.style.borderColor = '';
  }, 2000);
}
