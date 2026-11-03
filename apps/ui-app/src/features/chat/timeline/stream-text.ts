// The text of a streamed answer: how a delta joins the text already shown, how the text is painted into its element, how
// the SSE lines are read in batches, and how the bubble of an assistant message is filled. The paint is once per frame and
// appends when it can, so a long answer does not rebuild its text on every event.

import { escapeHtmlLocal, formatMarkdownToHtml, stripSuspiciousImages } from '../../../ui/markdown';
import { wrapTablesInBubble } from '../messages/view';
import { BACKEND_PROCESSING_PLACEHOLDER } from '@/platform/backend-legacy-strings';

/** How a delta joins the text: the new text, and the part of it that is new. */
export function normalizeStreamingDelta(current: unknown, incoming: unknown): [string, string] {
  const cur = current == null ? '' : String(current);
  const inc = incoming == null ? '' : String(incoming);
  if (inc === '') return [cur, ''];
  if (cur === '') return [inc, inc];
  if (inc.startsWith(cur) && inc.length > cur.length) return [inc, inc.slice(cur.length)];
  const runeCount = Array.from(cur).length;
  if (inc === cur && runeCount > 1) return [cur, ''];
  return [cur + inc, inc];
}

/** The full text the server sent with an event, when it sent one: the server's text is the truth, so the page takes it as is. */
export function streamBufferFromAccumulated(data: { accumulated?: unknown } | null | undefined): string | null {
  if (!data || data.accumulated == null) return null;
  return String(data.accumulated);
}

export function mergeStreamBuffer(current: unknown, delta: unknown, data?: { accumulated?: unknown } | null): string {
  const acc = streamBufferFromAccumulated(data);
  if (acc !== null) return acc;
  return normalizeStreamingDelta(current, delta)[0];
}

const TEXT_NODE = 3;

export interface StreamPlainState {
  pendingText: string;
  rafId: number;
  renderedLen: number;
}

export interface StreamFrames {
  request(callback: () => void): number;
  cancel(id: number): void;
}

const browserFrames: StreamFrames = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
};

export interface StreamPlainText {
  /** Shows text at once, as plain text. */
  setPlain(element: HTMLElement, text: unknown): void;
  /** Shows text on the next frame; a newer text before that frame replaces it. */
  schedule(element: HTMLElement, text: unknown): void;
  /** Shows the pending text of an element now. */
  flush(element: HTMLElement): void;
  /** Shows the pending text of every element still waiting, when they are on the page. */
  flushAll(doc?: Document): void;
  /** Forgets an element's pending text, so that a rich render can take its place. */
  reset(element: HTMLElement): void;
  dispose(): void;
}

export function createStreamPlainText(frames: StreamFrames = browserFrames): StreamPlainText {
  const states = new WeakMap<HTMLElement, StreamPlainState>();
  const pending = new Set<HTMLElement>();

  /** Appends the new part of the text when the element still holds the old text alone; otherwise replaces the text. */
  function paint(element: HTMLElement, text: string, state: StreamPlainState | null): void {
    const prevLen = state && state.renderedLen ? state.renderedLen : 0;
    element.classList.add('timeline-stream-plain');

    const first = element.firstChild;
    if (text.length > prevLen && element.childNodes.length === 1 && first && first.nodeType === TEXT_NODE) {
      const textNode = first as Text;
      const existing = textNode.nodeValue || '';
      if (existing.length === prevLen && text.startsWith(existing)) {
        const delta = text.slice(prevLen);
        if (delta) {
          textNode.appendData(delta);
          if (state) {
            state.renderedLen = text.length;
            state.pendingText = text;
          }
          return;
        }
      }
    }

    element.textContent = text;
    if (state) {
      state.renderedLen = text.length;
      state.pendingText = text;
    }
  }

  function flush(element: HTMLElement): void {
    const state = states.get(element);
    if (!state) return;
    if (state.rafId) {
      frames.cancel(state.rafId);
      state.rafId = 0;
    }
    paint(element, state.pendingText, state);
  }

  function reset(element: HTMLElement): void {
    const state = states.get(element);
    if (state && state.rafId) frames.cancel(state.rafId);
    states.delete(element);
    pending.delete(element);
  }

  return {
    setPlain(element, text) {
      reset(element);
      paint(element, text == null ? '' : String(text), null);
    },
    schedule(element, text) {
      const full = text == null ? '' : String(text);
      let state = states.get(element);
      if (!state) {
        state = { pendingText: full, rafId: 0, renderedLen: 0 };
        states.set(element, state);
      } else {
        state.pendingText = full;
      }
      pending.add(element);
      if (state.rafId) return;
      const current = state;
      current.rafId = frames.request(() => {
        current.rafId = 0;
        paint(element, current.pendingText, current);
      });
    },
    flush,
    flushAll(doc) {
      pending.forEach(element => {
        if (element.isConnected && (!doc || element.ownerDocument === doc)) flush(element);
      });
    },
    reset,
    dispose() { pending.forEach(reset); pending.clear(); },
  };
}

/**
 * Reads the SSE data lines in batches, giving the page a frame between batches so that a long read does not hold the page.
 * A line that is not JSON, or an event whose handler throws, is reported and skipped.
 */
export async function processSseDataLines(
  lines: string[],
  onEvent: (event: unknown) => void,
  options: { yieldEvery?: number } = {},
  nextFrame: () => Promise<void> = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
): Promise<void> {
  const yieldEvery = options.yieldEvery || 32;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('data: ')) {
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch (e) {
        console.error('Failed to parse event data:', e, line);
      }
    }
    if ((i + 1) % yieldEvery === 0 && i + 1 < lines.length) {
      await nextFrame();
    }
  }
}

/** The rich HTML of an assistant answer: the markdown rendered and sanitised, or the text with its line breaks. */
export function formatAssistantMarkdownContent(text: unknown, renderMarkdown = true): string {
  const raw = text == null ? '' : String(text);
  return renderMarkdown ? formatMarkdownToHtml(raw, { profile: 'chat' }) : escapeHtmlLocal(raw).replace(/\n/g, '<br>');
}

/** Fills the bubble of an assistant message with its content. The placeholder wording keeps the bubble hidden. */
export function updateAssistantBubbleContent(
  doc: Document,
  assistantMessageId: string,
  content: unknown,
  renderMarkdown: boolean,
  appendCopyButton: (element: HTMLElement) => void,
): void {
  const assistantElement = doc.getElementById(assistantMessageId);
  if (!assistantElement) return;
  const bubble = assistantElement.querySelector<HTMLElement>('.message-bubble');
  if (!bubble) return;

  // An old copy button that was left in the bubble; the buttons now sit in the time row.
  bubble.querySelector('.message-copy-btn')?.remove();

  const newContent = content == null ? '' : String(content);
  const normalizedContent = newContent.trim();
  if (normalizedContent !== BACKEND_PROCESSING_PLACEHOLDER && normalizedContent !== 'Processing...') {
    assistantElement.classList.remove('assistant-placeholder-content');
    bubble.hidden = false;
  }
  bubble.innerHTML = formatAssistantMarkdownContent(newContent, renderMarkdown);
  assistantElement.dataset.originalContent = newContent;

  wrapTablesInBubble(bubble, doc);
  appendCopyButton(assistantElement);
  stripSuspiciousImages(bubble);
}
