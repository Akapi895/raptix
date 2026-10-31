// Drawing the process details of a turn into its timeline: the lazy placeholder before the details are loaded, the rows
// in batches (or prepended to older ones), the inline approvals, and the summary that is fetched ahead of the details.

import { collectExecutionIdsFromProcessDetails } from './mcp-calls';
import type { McpSections } from './mcp-section';
import type { TurnSummary } from './turn-summary';
import {
  compactWorkflowProcessDetails, dedupeConsecutiveProcessDetailRows, filterNoiseProcessDetails, type ProcessDetail,
} from './details';
import { agentPrefixOf, processDetailTitle, type TitleHelpers } from './render-title';
import { mergeReasoningIntoProcessDetails, normalizeReasoningContentForDisplay, type Translate } from '../messages/text';

export interface RenderOptions {
  append?: boolean;
  prepend?: boolean;
  markLoaded?: boolean;
  force?: boolean;
  toolExecutions?: { processDetailId?: unknown; status?: unknown }[];
}

export interface TimelineOptions {
  title: string;
  message: string;
  data: Record<string, unknown>;
  processDetailId: string;
  createdAt?: unknown;
  mergedResult?: Record<string, unknown>;
  toolStatus?: string;
}

export interface RendererDependencies {
  doc: Document;
  t: Translate;
  title: TitleHelpers;
  mcp: McpSections;
  turn: TurnSummary;
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  /** Opens or closes a message's process details. */
  toggleDetails(messageId: string): void;
  addTimelineItem(timeline: HTMLElement, eventType: string, options: TimelineOptions): string | null;
  renderInlineHitlApproval(itemId: string, data: Record<string, unknown>): void;
  resolveInlineHitlDecision(timeline: HTMLElement, data: Record<string, unknown>, decision: 'approve' | 'reject', message: string): void;
  findToolCallItemForHitl(timeline: HTMLElement, data: Record<string, unknown>): { id?: string } | null;
  restoreWorkflowHitl(conversationId: string): void;
  currentConversationId(): string;
  ensureReturnLatest(timeline: HTMLElement): void;
  updateReturnLatest(timeline: HTMLElement): void;
  coalesceToolPairs(details: ProcessDetail[]): ProcessDetail[];
  scheduleFrame(callback: () => void): void;
  /** The scrolling box of the transcript, whose offset is kept when older rows are prepended. */
  scrollBox(): HTMLElement | null;
  isUserExpanded(messageId: string): boolean;
}

export interface ProcessRenderer {
  render(messageId: string, details: ProcessDetail[] | null, options?: RenderOptions): void;
  bindLazyHint(host: HTMLElement | null, messageId: string): void;
  syncButtonLabels(messageId: string, expanded: boolean): void;
  isUserExpanded(messageId: string): boolean;
  messageHasConversationContent(element: HTMLElement | null): boolean;
  reasoningOf(element: HTMLElement | null): string;
  setReasoning(element: HTMLElement | string | null, reasoning: unknown): void;
}

const TIMELINE_RENDER_BATCH = 40;
const HITL_TITLE_TYPES = new Set(['hitl_interrupt', 'hitl_audit_agent_started', 'hitl_audit_agent', 'hitl_resumed', 'hitl_rejected']);

export function createProcessRenderer(deps: RendererDependencies): ProcessRenderer {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);

  function reasoningOf(element: HTMLElement | null): string {
    if (!element?.dataset) return '';
    return normalizeReasoningContentForDisplay(element.dataset.reasoningContent || '');
  }

  function setReasoning(target: HTMLElement | string | null, reasoning: unknown): void {
    const element = typeof target === 'string' ? byId(target) : target;
    if (!element?.dataset) return;
    const text = normalizeReasoningContentForDisplay(reasoning);
    if (text) element.dataset.reasoningContent = text;
    else delete element.dataset.reasoningContent;
  }

  function messageHasConversationContent(element: HTMLElement | null): boolean {
    if (!element?.classList?.contains('assistant')) return false;
    if (element.hasAttribute('data-system-ready-message')) return false;
    if (String(element.dataset.backendMessageId || '').trim()) return true;
    if (String(element.dataset.originalContent || '').trim()) return true;
    const bubble = element.querySelector<HTMLElement>('.message-bubble');
    if (!bubble) return false;
    const clone = bubble.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.message-copy-btn').forEach(button => button.remove());
    return String(clone.textContent || '').trim().length > 0;
  }

  function isUserExpanded(messageId: string): boolean {
    const container = byId('process-details-' + messageId);
    return container?.dataset.userExpanded === '1';
  }

  function syncButtonLabels(messageId: string, expanded: boolean): void {
    const label = expanded ? t('tasks.collapseDetail', 'Collapse details') : t('chat.expandDetail', 'Expand details');
    doc.querySelectorAll<HTMLElement>('#' + messageId + ' .process-detail-btn').forEach(button => {
      button.innerHTML = '<span>' + label + '</span>';
    });
    const element = byId(messageId);
    if (element) deps.turn.sync(element);
  }

  /** A lazy placeholder opens the details when clicked, the same way the toolbar button does. */
  function bindLazyHint(host: HTMLElement | null, messageId: string): void {
    if (!host || !messageId) return;
    const empty = host.classList.contains('progress-timeline-empty')
      ? host
      : host.querySelector<HTMLElement>('.progress-timeline-empty');
    if (!empty || empty.dataset.lazyHintBound === '1') return;
    empty.dataset.lazyHintBound = '1';
    empty.classList.add('progress-timeline-lazy-clickable');
    empty.setAttribute('role', 'button');
    empty.setAttribute('tabindex', '0');
    const activate = () => deps.toggleDetails(messageId);
    empty.addEventListener('click', activate);
    empty.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  }

  /** The summary of a collapsed turn: its timing, its tool calls and the size of its details. */
  function prefetchSummary(messageId: string, messageElement: HTMLElement): void {
    if (!messageElement?.dataset?.backendMessageId) return;
    const backendId = String(messageElement.dataset.backendMessageId).trim();
    if (!backendId) return;
    const container = byId('process-details-' + messageId);
    if (!container || container.dataset.summaryFetched === '1') return;
    container.dataset.summaryFetched = '1';
    deps.apiFetch('/api/messages/' + encodeURIComponent(backendId) + '/process-details?summary=1')
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { summary?: Record<string, unknown> };
        if (!response.ok || !body.summary) return;
        const summary = body.summary;
        deps.turn.setTiming(messageElement, {
          startedAt: summary.startedAt,
          completedAt: summary.completedAt,
          durationMs: summary.durationMs,
          status: (summary.status as string) || 'completed',
        });
        const mcpIds = Array.isArray(summary.mcpExecutionIds) ? summary.mcpExecutionIds as string[] : [];
        const tools = Array.isArray(summary.toolExecutions) ? summary.toolExecutions as unknown[] : [];
        if (tools.length > 0) deps.mcp.setPendingSummaries(messageElement, tools);
        if (mcpIds.length > 0) deps.mcp.setPendingExecutionIds(messageElement, mcpIds);
        const toolCount = tools.map(item => deps.mcp.normalizeSummary(item)).filter(item => item.executionId).length;
        const buttonCount = toolCount > 0 ? toolCount : mcpIds.length;
        if (buttonCount > 0) deps.mcp.setCount(messageElement, buttonCount);
        const timeline = container.querySelector<HTMLElement>('.progress-timeline');
        if (!timeline || container.dataset.loaded === '1') return;
        const expandLabel = t('chat.expandDetail', 'Expand details');
        const maxIteration = Number(summary.maxIteration || 0);
        const total = Number(summary.total || 0);
        let hint = expandLabel + ' (click to load iteration details)';
        if (maxIteration > 0) hint = expandLabel + ` (${maxIteration} iterations, ${total} detail entries)`;
        else if (total > 0) hint = expandLabel + ` (${total} detail entries)`;
        const empty = timeline.querySelector<HTMLElement>('.progress-timeline-empty');
        if (empty) {
          empty.textContent = hint;
          bindLazyHint(timeline, messageId);
        }
      })
      .catch(() => undefined);
  }

  /** Once the rows are drawn: the expanded state, the workflow approval that waits, and the return-to-latest control. */
  function finish(messageElement: HTMLElement, details: ProcessDetail[], isLazyNotLoaded: boolean, timeline: HTMLElement): void {
    if (isLazyNotLoaded && reasoningOf(messageElement)) {
      const hint = doc.createElement('div');
      hint.className = 'progress-timeline-empty progress-timeline-lazy-hint';
      hint.textContent = t('chat.expandDetail', 'Expand details') + ' (click to load the full process details)';
      timeline.appendChild(hint);
      bindLazyHint(hint, messageElement.id);
    }
    const hasPendingHitl = details.some(item => item && item.eventType === 'hitl_interrupt');
    const hasPendingWorkflowHitl = details.some(item => item && item.eventType === 'workflow_hitl_waiting');
    const hasErrorOrCancelled = details.some(item => item.eventType === 'error' || item.eventType === 'cancelled');
    if (deps.isUserExpanded(messageElement.id)) {
      timeline.classList.add('expanded');
      syncButtonLabels(messageElement.id, true);
    } else if (hasErrorOrCancelled && !hasPendingHitl && !hasPendingWorkflowHitl) {
      timeline.classList.remove('expanded');
      syncButtonLabels(messageElement.id, false);
    }
    if (hasPendingWorkflowHitl && messageElement.id) {
      const conversationId = deps.currentConversationId();
      if (conversationId) deps.restoreWorkflowHitl(conversationId);
    }
    deps.ensureReturnLatest(timeline);
    deps.updateReturnLatest(timeline);
  }

  function createDetailsContainer(id: string, mcpSection: HTMLElement, buttons: HTMLElement, toolList: HTMLElement | null): HTMLElement {
    const container = doc.createElement('div');
    container.id = id;
    container.className = 'process-details-container';
    if (toolList) toolList.after(container);
    else if (buttons.nextSibling) mcpSection.insertBefore(container, buttons.nextSibling);
    else mcpSection.appendChild(container);
    return container;
  }

  function createTimeline(container: HTMLElement, id: string): HTMLElement {
    const content = doc.createElement('div');
    content.className = 'process-details-content';
    const timeline = doc.createElement('div');
    timeline.id = id;
    timeline.className = 'progress-timeline';
    content.appendChild(timeline);
    container.appendChild(content);
    return timeline;
  }

  function render(messageId: string, incoming: ProcessDetail[] | null, options: RenderOptions = {}): void {
    const appendMode = !!options.append;
    const prependMode = !!options.prepend;
    const markLoaded = options.markLoaded !== false;
    const toolStatusByProcessDetailId = new Map<string, string>();
    (options.toolExecutions ?? []).forEach(execution => {
      if (!execution?.processDetailId) return;
      toolStatusByProcessDetailId.set(String(execution.processDetailId), String(execution.status || '').toLowerCase());
    });

    const messageElement = byId(messageId) as HTMLElement | null;
    if (!messageElement) return;
    const isLazyRequest = incoming === null;
    const reasoningFromMessage = reasoningOf(messageElement);
    const backendId = String(messageElement.dataset.backendMessageId || '').trim();
    const hasConversationContent = !!options.force || messageHasConversationContent(messageElement);
    if (isLazyRequest && !reasoningFromMessage && !backendId && deps.mcp.count(messageElement) <= 0 && !hasConversationContent) {
      deps.mcp.pruneEmpty(messageElement);
      return;
    }

    const chrome = deps.mcp.ensureChrome(messageElement, messageId);
    const buttons = chrome?.toolbar;
    if (!chrome || !buttons) return;
    const { mcpSection, toolList } = chrome;

    if (!buttons.querySelector('.process-detail-btn')) {
      const processButton = doc.createElement('button');
      processButton.className = 'mcp-detail-btn process-detail-btn';
      processButton.innerHTML = '<span>' + t('chat.expandDetail', 'Expand details') + '</span>';
      processButton.onclick = () => deps.toggleDetails(messageId);
      buttons.appendChild(processButton);
    }
    deps.mcp.syncToggle(messageElement);

    const detailsId = 'process-details-' + messageId;
    const container = byId(detailsId) ?? createDetailsContainer(detailsId, mcpSection, buttons, toolList);
    const timelineId = detailsId + '-timeline';
    const timeline = byId(timelineId) ?? createTimeline(container, timelineId);
    deps.ensureReturnLatest(timeline);

    // `null` means the details are not loaded yet; the reasoning of the message can still be shown.
    const isLazyNotLoaded = isLazyRequest;
    if (isLazyNotLoaded && !reasoningFromMessage) {
      container.dataset.lazyNotLoaded = '1';
      container.dataset.loaded = '0';
      timeline.innerHTML = '<div class="progress-timeline-empty">' + t('chat.expandDetail', 'Expand details') + ' (click to load iteration details)</div>';
      bindLazyHint(timeline, messageId);
      timeline.classList.remove('expanded');
      deps.updateReturnLatest(timeline);
      prefetchSummary(messageId, messageElement);
      return;
    }

    let details: ProcessDetail[] = incoming ?? [];
    if (isLazyNotLoaded) {
      container.dataset.lazyNotLoaded = '1';
      container.dataset.loaded = '0';
      if (!appendMode) prefetchSummary(messageId, messageElement);
    } else if (markLoaded) {
      container.dataset.lazyNotLoaded = '0';
      container.dataset.loaded = '1';
    }

    const usage = deps.turn.extract(details);
    if (usage) deps.turn.setTokenUsage(messageElement, usage);
    details = mergeReasoningIntoProcessDetails(details, reasoningFromMessage) as ProcessDetail[];
    details = filterNoiseProcessDetails(details);
    details = dedupeConsecutiveProcessDetailRows(details);
    const renderedIds = collectExecutionIdsFromProcessDetails(details);
    if (renderedIds.length > 0) {
      deps.mcp.setPendingExecutionIds(messageElement, renderedIds);
      deps.mcp.setCount(messageElement, renderedIds.length);
    }
    details = deps.coalesceToolPairs(details);
    details = compactWorkflowProcessDetails(details);

    if (details.length === 0) {
      if (!appendMode && !prependMode) {
        timeline.innerHTML = '<div class="progress-timeline-empty">' + t('chat.noProcessDetail', 'No process details (execution may be too fast or no detailed events)') + '</div>';
        if (!deps.isUserExpanded(messageId)) timeline.classList.remove('expanded');
        deps.updateReturnLatest(timeline);
      }
      return;
    }

    const prependAnchor = prependMode ? timeline.firstChild : null;
    const scrollBox = prependMode ? deps.scrollBox() : null;
    const scrollHeight = scrollBox ? scrollBox.scrollHeight : 0;
    const scrollTop = scrollBox ? scrollBox.scrollTop : 0;
    const prependedIds: string[] = [];
    if (!appendMode && !prependMode) timeline.innerHTML = '';

    const renderOne = (detail: ProcessDetail) => {
      const eventType = detail.eventType || '';
      const data = (detail.data && typeof detail.data === 'object' ? detail.data : {}) as Record<string, unknown>;
      const rowMessage = detail.message != null ? String(detail.message) : '';
      const agentPrefix = agentPrefixOf(data);
      const titled = processDetailTitle(eventType, rowMessage, data, agentPrefix, deps.title);
      const message = titled.message ?? rowMessage;

      if (HITL_TITLE_TYPES.has(eventType)) {
        const target = deps.findToolCallItemForHitl(timeline, data);
        if (target?.id) {
          if (eventType === 'hitl_interrupt' || eventType === 'hitl_audit_agent_started') {
            deps.renderInlineHitlApproval(target.id, {
              ...data,
              reviewer: eventType === 'hitl_audit_agent_started' ? 'audit_agent' : (data.reviewer || 'human'),
              status: eventType === 'hitl_audit_agent_started' ? 'audit_running' : (data.status || 'pending'),
            });
          } else {
            const decision = eventType === 'hitl_rejected' || data.decision === 'reject' ? 'reject' : 'approve';
            deps.resolveInlineHitlDecision(timeline, {
              ...data,
              reviewer: data.reviewer || data.decidedBy || (eventType === 'hitl_audit_agent' ? 'audit_agent' : 'human'),
              status: 'decided',
            }, decision, message);
          }
          return;
        }
      }

      const timelineOptions: TimelineOptions = {
        title: titled.title,
        message,
        data,
        processDetailId: String(detail.id || data.processDetailId || ''),
        createdAt: detail.createdAt,
      };
      if (eventType === 'tool_call' && data._mergedResult) {
        const merged = data._mergedResult as Record<string, unknown>;
        timelineOptions.mergedResult = merged;
        if (deps.title.toolResultState?.(merged)?.kind === 'background_running') timelineOptions.toolStatus = 'background_running';
      }
      if (eventType === 'tool_call' && detail.id && toolStatusByProcessDetailId.has(String(detail.id))) {
        timelineOptions.toolStatus = toolStatusByProcessDetailId.get(String(detail.id));
      }
      const itemId = deps.addTimelineItem(timeline, eventType, timelineOptions);
      if (itemId && (eventType === 'hitl_interrupt' || eventType === 'hitl_audit_agent_started')) {
        deps.renderInlineHitlApproval(itemId, {
          ...data,
          reviewer: eventType === 'hitl_audit_agent_started' ? 'audit_agent' : (data.reviewer || 'human'),
          status: eventType === 'hitl_audit_agent_started' ? 'audit_running' : (data.status || 'pending'),
        });
      } else if (itemId && (eventType === 'hitl_audit_agent' || eventType === 'hitl_resumed' || eventType === 'hitl_rejected')) {
        deps.renderInlineHitlApproval(itemId, {
          ...data,
          resolved: true,
          decision: eventType === 'hitl_rejected' || data.decision === 'reject' ? 'reject' : 'approve',
          reviewer: data.reviewer || data.decidedBy || (eventType === 'hitl_audit_agent' ? 'audit_agent' : 'human'),
          status: 'decided',
        });
      }
      if (prependMode && itemId) prependedIds.push(itemId);
    };

    const finishPrepend = () => {
      if (!prependMode || prependedIds.length === 0) return;
      const fragment = doc.createDocumentFragment();
      prependedIds.forEach(id => {
        const node = byId(id);
        if (node) fragment.appendChild(node);
      });
      timeline.insertBefore(fragment, prependAnchor || timeline.firstChild);
      if (scrollBox) scrollBox.scrollTop = scrollTop + (scrollBox.scrollHeight - scrollHeight);
    };

    const renderBatch = (start: number) => {
      const end = Math.min(start + TIMELINE_RENDER_BATCH, details.length);
      for (let i = start; i < end; i++) renderOne(details[i] as ProcessDetail);
      if (end < details.length) {
        deps.scheduleFrame(() => renderBatch(end));
      } else if (markLoaded) {
        finishPrepend();
        finish(messageElement, details, isLazyNotLoaded, timeline);
      } else {
        finishPrepend();
      }
    };

    if (details.length > TIMELINE_RENDER_BATCH) {
      renderBatch(0);
    } else {
      details.forEach(renderOne);
      finishPrepend();
      if (markLoaded) finish(messageElement, details, isLazyNotLoaded, timeline);
    }
  }

  return {
    render,
    bindLazyHint,
    syncButtonLabels,
    isUserExpanded,
    messageHasConversationContent,
    reasoningOf,
    setReasoning,
  };
}
