import { createStreamPlainText, updateAssistantBubbleContent, processSseDataLines } from '@/features/chat/timeline/stream-text';
import { createToolCallView } from '@/features/chat/timeline/tool-call-view';
import { addTimelineItem, type TimelineItemOptions } from '@/features/chat/timeline/item';
import { applyEinoTimelineRole } from '@/features/chat/timeline/eino-format';
import { buildMainResponseStreamIdentity, responseStreamStateFromRestoredItem, toolCallMapKey, type ResponseStreamMeta } from '@/features/chat/timeline/response-stream';
import { formatTimelineStreamBody, timeFormatOptions } from '@/features/chat/timeline/labels';
import { pruneLiveTimelineIfNeeded } from '@/features/chat/timeline/prune';
import { escapeHtml } from '@/ui/format';
import { translate, type ChatResources } from './runtime';
import type { ChatState } from './state';

export function createChatTimeline(doc: Document, state: ChatState, resources: ChatResources, deps: {
  request(path: string, init?: RequestInit): Promise<Response>;
  locale(): string;
  appendCopyButton(element: HTMLElement): void;
  attachDeleteButton(element: HTMLElement): void;
  reloadLazyDetails(id: string): void;
  registerProgress(id: string, conversationId: string): void;
}) {
  const painter = createStreamPlainText({ request: callback => resources.frame(callback), cancel: resources.cancelFrame });
  const streams = state.timeline;
  const toolView = createToolCallView({
    doc, t: translate,
    async fetchProcessDetailData(detailId) {
      const id = String(detailId || '').trim(); if (!id) return null;
      const response = await deps.request(`/api/process-details/${encodeURIComponent(id)}`);
      const body = await response.json().catch(() => ({})) as { error?: string; processDetail?: { data?: Record<string, unknown> } };
      if (!response.ok) throw new Error(body.error || String(response.status));
      return body.processDetail?.data ?? null;
    },
    flushPlainText: painter.flush, resetPlainText: painter.reset,
    mappingFor: (progressId, toolCallId) => streams.toolCalls.get(toolCallMapKey(progressId, toolCallId)) || streams.toolCalls.get(toolCallId) || null,
  });
  const identity = (progressId: string, data: ResponseStreamMeta | null | undefined) => buildMainResponseStreamIdentity(data, streams.mainIterations.get(progressId));
  function findRestored(timeline: HTMLElement | null | undefined, data: ResponseStreamMeta = {}) {
    if (!timeline) return null;
    const streamId = String(data.streamId ?? '').trim();
    const agent = String(data.einoAgent ?? '').trim();
    const orchestration = String(data.orchestration ?? '').trim();
    const items = Array.from(timeline.querySelectorAll<HTMLElement>('.timeline-item-planning, .timeline-item-thinking'));
    return items.reverse().find(item => streamId ? item.dataset.responseStreamId === streamId : !!agent && item.dataset.einoAgent === agent && (item.dataset.orchestration || '') === orchestration) || null;
  }
  const api = {
    painter, toolView, identity, findRestored,
    processSseDataLines,
    addItem(timeline: HTMLElement, type: string, options: TimelineItemOptions) {
      return addTimelineItem(timeline, type, options, {
        doc, t: translate, view: toolView, timeLocale: deps.locale, timeOptions: () => timeFormatOptions(deps.locale()),
        streamBody: formatTimelineStreamBody,
        plainTextHtml: text => `<pre class="timeline-plain-text">${escapeHtml(String(text ?? ''))}</pre>`,
        applyEinoRole: applyEinoTimelineRole,
        pruneLive: timeline => pruneLiveTimelineIfNeeded(doc, timeline, translate),
      });
    },
    restoredState(progressId: string, item: HTMLElement | null | undefined, data: ResponseStreamMeta | null | undefined) {
      if (!item) return null;
      item.dataset.responseStreamPlaceholder = '1';
      return responseStreamStateFromRestoredItem(progressId, { id: item.id, contentText: item.querySelector('.timeline-item-content')?.textContent || '' }, data, identity(progressId, data));
    },
    clearStreams(progressId: string) {
      streams.responseStreams.delete(progressId); streams.thinkingStreams.delete(progressId); streams.einoReplyStreams.delete(progressId);
      for (const key of streams.toolResultStreams.keys()) if (key.startsWith(`${progressId}::`)) streams.toolResultStreams.delete(key);
    },
    finalizeToolCalls(progressId: string, status: string) {
      for (const [key, mapping] of streams.toolCalls) {
        if (mapping.progressId != null && mapping.progressId !== progressId) continue;
        const id = mapping.toolCallId || (key.includes('::') ? key.split('::').slice(1).join('::') : key);
        if (!mapping.terminalStatus) toolView.updateStatus(mapping.progressId || progressId, id, status);
        streams.toolCalls.delete(key);
      }
    },
    updateAssistant(id: string, content: unknown, markdown: boolean) { updateAssistantBubbleContent(doc, id, content, markdown, deps.appendCopyButton); },
    applyAssistantId(domId: string, backendId: string) {
      const element = doc.getElementById(domId); if (!element || !backendId) return;
      element.dataset.backendMessageId = backendId; deps.attachDeleteButton(element); deps.reloadLazyDetails(domId);
    },
    applyLastUserId(backendId: string) {
      const users = doc.querySelectorAll<HTMLElement>('#chat-messages .message.user');
      const last = users[users.length - 1];
      if (!last || last.dataset.backendMessageId || !backendId) return;
      last.dataset.backendMessageId = backendId; deps.attachDeleteButton(last);
    },
    replayProgressId: (id: string | null | undefined) => `task-ev-${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    beginReplay(progressId: string, assistantDomId: string, conversationId: string) {
      state.setReplay({ progressId, assistantDomId, conversationId, timelineHostId: `process-details-${assistantDomId}-timeline` });
      deps.registerProgress(progressId, conversationId);
    },
    clearReplay() { state.setReplay(null); },
    resolveTimeline(progressId: string) {
      const replay = state.replay();
      return doc.getElementById(`${progressId}-timeline`) || (replay?.progressId === progressId ? doc.getElementById(replay.timelineHostId) : null);
    },
    start() { resources.on(doc, 'click', event => toolView.onDocumentClick(event)); },
    dispose() { painter.flushAll(doc); painter.dispose(); },
  };
  return api;
}
export type ChatTimeline = ReturnType<typeof createChatTimeline>;
