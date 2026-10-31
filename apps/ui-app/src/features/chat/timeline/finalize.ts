import {
  formatTimelineStreamBody,
  isFinalizedResponseData,
  resolveFinalAssistantResponseText,
  type StepMeta,
} from './labels';

export interface FinalizeStreamState {
  itemId?: string;
  buffer?: string;
  streamMeta?: StepMeta | null;
}

export interface FinalizePorts {
  flushPlain(element: HTMLElement): void;
  setPlain(element: HTMLElement, text: string): void;
  einoPlanningTitle(meta: StepMeta): string;
}

/** Marks an assistant message as finalized (or not) on its element, so the styling and the checks follow the server's verdict. */
export function markAssistantFinalizationState(doc: Document, assistantMessageId: string, responseData: StepMeta | null | undefined): void {
  const el = doc.getElementById(assistantMessageId);
  if (!el) return;
  const finalized = isFinalizedResponseData(responseData);
  el.dataset.finalized = finalized ? 'true' : 'false';
  el.dataset.finalizationStatus = responseData && responseData.status ? String(responseData.status) : '';
  el.classList.toggle('assistant-finalized', finalized);
  el.classList.toggle('assistant-not-finalized', !finalized);
}

/**
 * When the main channel's response ends, the streaming placeholder becomes a planning item (the type the server stores on flush).
 * Doing it at the end keeps the "assistant output" in view without a reload. An empty answer removes the placeholder.
 */
export function finalizeMainResponseStreamItem(
  doc: Document,
  streamState: FinalizeStreamState | null | undefined,
  finalMessage: unknown,
  responseData: StepMeta | null | undefined,
  ports: FinalizePorts,
): boolean {
  if (!streamState || !streamState.itemId) return false;
  const item = doc.getElementById(streamState.itemId);
  if (!item || !item.parentNode) return false;

  const resolved = resolveFinalAssistantResponseText(finalMessage, streamState);
  const fullText = resolved != null && String(resolved).trim() !== '' ? String(resolved) : (streamState.buffer || '');
  if (!String(fullText).trim()) {
    item.parentNode.removeChild(item);
    return false;
  }

  const meta = Object.assign({}, streamState.streamMeta || {}, responseData || {}) as StepMeta;
  item.classList.remove('timeline-item-thinking');
  item.classList.add('timeline-item-planning');
  item.dataset.timelineType = 'planning';
  delete item.dataset.responseStreamPlaceholder;
  const orchestration = meta.orchestration != null ? String(meta.orchestration).trim() : '';
  if (orchestration !== '') item.dataset.orchestration = orchestration;
  const einoAgent = meta.einoAgent != null ? String(meta.einoAgent).trim() : '';
  if (einoAgent !== '') item.dataset.einoAgent = einoAgent;

  const titleEl = item.querySelector<HTMLElement>('.timeline-item-title');
  if (titleEl) titleEl.textContent = ports.einoPlanningTitle(meta);

  let contentEl = item.querySelector<HTMLElement>('.timeline-item-content');
  if (!contentEl) {
    contentEl = doc.createElement('div');
    contentEl.className = 'timeline-item-content';
    item.appendChild(contentEl);
  }
  ports.flushPlain(contentEl);
  ports.setPlain(contentEl, formatTimelineStreamBody(fullText, meta));
  return true;
}
