// Bringing back the approvals a conversation still waits for, after a refresh or a change of conversation: the pending list is read
// from the server, the dock and the sidebar follow it, and each approval gets its card under the tool call it belongs to.

import { isAgentReviewedHitl, type HitlRecord } from './describe';
import { escapeAttrSelector } from './view';
import type { PendingInterrupt, PendingInterruptTracker, ExecutionTracker } from '../timeline/trackers';

export interface PendingItem {
  id?: unknown;
  interruptId?: unknown;
  mode?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  payload?: unknown;
  conversationId?: unknown;
  createdAt?: unknown;
  reviewer?: unknown;
  decidedBy?: unknown;
  status?: unknown;
  messageId?: unknown;
  [key: string]: unknown;
}

/** A pending approval as the server reports it, in the shape the page uses everywhere. */
export function hitlPendingItemToData(item: PendingItem | null | undefined, fallbackConversationId?: string): HitlRecord | null {
  if (!item) return null;
  let payloadObj: Record<string, unknown> = item.payload && typeof item.payload === 'object' ? (item.payload as Record<string, unknown>) : {};
  if (typeof item.payload === 'string') {
    try {
      payloadObj = JSON.parse(item.payload || '{}') as Record<string, unknown>;
    } catch {
      payloadObj = {};
    }
  }
  const timing = (payloadObj.hitlApproval && typeof payloadObj.hitlApproval === 'object' ? payloadObj.hitlApproval : {}) as Record<string, unknown>;
  return {
    interruptId: String(item.interruptId || item.id || '').trim(),
    mode: item.mode,
    toolName: item.toolName,
    toolCallId: item.toolCallId,
    payload: payloadObj,
    conversationId: String(item.conversationId || fallbackConversationId || '').trim(),
    createdAt: timing.createdAt || item.createdAt,
    timeoutSeconds: timing.timeoutSeconds,
    expiresAt: timing.expiresAt,
    reviewer: item.reviewer || item.decidedBy || 'human',
    status: item.status || 'pending',
  };
}

export interface RestoreDeps {
  doc: Document;
  currentConversationId(): string;
  request(path: string): Promise<Response>;
  execution: ExecutionTracker;
  pending: PendingInterruptTracker;
  syncTaskAvailability(): void;
  clearDock(): void;
  renderDock(data: HitlRecord): void;
  updateSidebar(data: HitlRecord, pending: boolean): void;
  renderInline(itemId: string, data: HitlRecord): void;
  loadProcessDetails(clientMessageId: string, backendMessageId: string): Promise<void>;
  restoreWorkflow(conversationId: string): Promise<void>;
  logError(message: string, error: unknown): void;
}

/** The newest assistant message of the chat that the server has saved: its backend id is on it. */
export function findLastAssistantMessageElInChat(doc: Document): HTMLElement | null {
  const nodes = doc.querySelectorAll<HTMLElement>('#chat-messages .message.assistant');
  for (let i = nodes.length - 1; i >= 0; i--) {
    const el = nodes[i];
    if (el && el.dataset && el.dataset.backendMessageId) return el;
  }
  return null;
}

/** The details of a message are opened, and the page scrolls to them while the reader stays where they are. */
export function expandProcessDetailsTimeline(deps: RestoreDeps & {
  syncButtonLabels(assistantId: string, expanded: boolean): void;
  syncTurnSummary(el: HTMLElement | null): void;
  scrollIntoViewIfFollowing(el: HTMLElement, options: ScrollIntoViewOptions): boolean;
  capturePinned(): boolean;
  setTimeout(callback: () => void, ms: number): void;
}, assistantMessageId: string): void {
  if (!assistantMessageId) return;
  const detailsContainer = deps.doc.getElementById('process-details-' + assistantMessageId) as HTMLElement | null;
  if (!detailsContainer) return;
  const timeline = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
  if (!timeline) return;
  timeline.classList.add('expanded');
  detailsContainer.dataset.userExpanded = '1';
  deps.syncButtonLabels(assistantMessageId, true);
  deps.syncTurnSummary(deps.doc.getElementById(assistantMessageId) as HTMLElement | null);
  deps.setTimeout(() => {
    if (!deps.scrollIntoViewIfFollowing(detailsContainer, { behavior: 'smooth', block: 'nearest' }) && deps.capturePinned()) {
      detailsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 100);
}

/**
 * Makes the pending approvals match what the running tasks allow: an approval of a conversation that no longer runs is dropped,
 * the newest approval of the open conversation is shown in the dock, and the sidebar is kept in step.
 */
export function reconcilePendingHitlState(deps: RestoreDeps & {
  syncSidebarState(items: HitlRecord[]): void;
  syncProjectStatuses(items: HitlRecord[]): void;
  restoreInline(conversationId: string): void;
}, rawItems: PendingItem[] | null | undefined): void {
  const activeItems = (Array.isArray(rawItems) ? rawItems : [])
    .map(item => hitlPendingItemToData(item))
    .filter((item): item is HitlRecord => !!item && !isAgentReviewedHitl(item) && deps.execution.isRunning(String(item.conversationId ?? '')));
  deps.pending.update(activeItems as PendingInterrupt[]);
  deps.syncTaskAvailability();
  deps.syncSidebarState(activeItems);
  deps.syncProjectStatuses(activeItems);

  const currentId = String(deps.currentConversationId() || '').trim();
  const currentPending = activeItems.find(item => item.conversationId === currentId);
  const dock = deps.doc.getElementById('chat-hitl-approval-dock') as HTMLElement | null;
  const dockInterruptId = dock && String(dock.dataset.hitlInterruptId || '').trim();
  if (!currentPending) {
    if (dockInterruptId) deps.clearDock();
    return;
  }
  if (!dockInterruptId || dockInterruptId !== String(currentPending.interruptId) || dock?.hidden) {
    deps.renderDock(currentPending);
  }
  const inlineSelector = '.hitl-inline-approval[data-hitl-interrupt-id="' + escapeAttrSelector(String(currentPending.interruptId)) + '"]';
  if (!deps.doc.querySelector(inlineSelector)) deps.restoreInline(currentId);
}

const inFlight = new Set<string>();

/**
 * Restores the approvals of a conversation in its timeline: the dock, the sidebar and the card of each approval under the
 * tool call it waits on. A conversation whose task no longer runs gets nothing back.
 */
export async function restoreHitlInlineForConversation(deps: RestoreDeps & {
  syncButtonLabels(assistantId: string, expanded: boolean): void;
  syncTurnSummary(el: HTMLElement | null): void;
  scrollIntoViewIfFollowing(el: HTMLElement, options: ScrollIntoViewOptions): boolean;
  capturePinned(): boolean;
  setTimeout(callback: () => void, ms: number): void;
}, conversationId: string): Promise<void> {
  if (!conversationId) return;
  if (inFlight.has(conversationId)) return;
  const current = deps.currentConversationId();
  if (current && current !== conversationId) return;
  inFlight.add(conversationId);
  try {
    const resp = await deps.request('/api/hitl/pending?conversationId=' + encodeURIComponent(conversationId) + '&status=pending&pageSize=50');
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({})) as { items?: PendingItem[] };
    const rawItems = (Array.isArray(data.items) ? data.items : []).filter(item => !isAgentReviewedHitl(item as HitlRecord));
    // The task list is the authority on what runs now: an approval read from a stale pending list is not put back.
    const items = deps.execution.ready && !deps.execution.isRunning(conversationId) ? [] : rawItems;
    if (deps.currentConversationId() && deps.currentConversationId() !== conversationId) return;
    deps.clearDock();
    const normalizedItems = items.map(item => hitlPendingItemToData(item, conversationId)).filter((item): item is HitlRecord => !!item);
    deps.pending.replaceConversation(conversationId, normalizedItems as PendingInterrupt[]);
    deps.syncTaskAvailability();
    if (items.length > 0) {
      const newestPending = normalizedItems[0];
      if (newestPending) {
        deps.renderDock(newestPending);
        deps.updateSidebar(newestPending, true);
      }
    } else {
      deps.updateSidebar({ conversationId }, false);
    }

    for (const item of items) {
      let backendMsgId = item.messageId != null ? String(item.messageId).trim() : '';
      let msgEl: HTMLElement | null = null;
      if (backendMsgId) {
        msgEl = deps.doc.querySelector<HTMLElement>('#chat-messages [data-backend-message-id="' + escapeAttrSelector(backendMsgId) + '"]');
      }
      if (!msgEl) {
        msgEl = findLastAssistantMessageElInChat(deps.doc);
        if (msgEl && msgEl.dataset && msgEl.dataset.backendMessageId) backendMsgId = String(msgEl.dataset.backendMessageId).trim();
      }
      if (!msgEl || !msgEl.id || !backendMsgId) continue;
      const clientMsgId = msgEl.id;
      const detailsContainer = deps.doc.getElementById('process-details-' + clientMsgId) as HTMLElement | null;
      if (!detailsContainer) continue;
      if (detailsContainer.dataset.lazyNotLoaded === '1' && detailsContainer.dataset.loaded !== '1') {
        try {
          detailsContainer.dataset.loading = '1';
          await deps.loadProcessDetails(clientMsgId, backendMsgId);
        } catch (e) {
          deps.logError('Failed to load process details (HITL resume):', e);
        } finally {
          detailsContainer.dataset.loading = '0';
        }
      }
      expandProcessDetailsTimeline(deps, clientMsgId);
      const hitlData = hitlPendingItemToData(item);
      if (!hitlData) continue;
      let hitlItemEl: HTMLElement | null = null;
      if (item.toolCallId) {
        hitlItemEl = detailsContainer.querySelector<HTMLElement>('[data-tool-call-id="' + escapeAttrSelector(String(item.toolCallId)) + '"]');
      }
      if (!hitlItemEl && item.toolName) {
        const want = String(item.toolName).trim().toLowerCase();
        const shortWant = want.indexOf('::') >= 0 ? want.split('::').pop() : want;
        const calls = detailsContainer.querySelectorAll<HTMLElement>('.timeline-item-tool_call');
        for (let j = calls.length - 1; j >= 0; j--) {
          const call = calls[j];
          if (!call) continue;
          const tn = String(call.dataset.toolName || '').trim().toLowerCase();
          const shortTn = tn.indexOf('::') >= 0 ? tn.split('::').pop() : tn;
          const match = want && (tn === want || tn.endsWith('::' + shortWant) || shortTn === shortWant);
          if (match) {
            hitlItemEl = call;
            break;
          }
        }
      }
      if (!hitlItemEl) {
        hitlItemEl = detailsContainer.querySelector<HTMLElement>('[data-hitl-interrupt-id="' + escapeAttrSelector(String(item.id)) + '"]');
      }
      if (!hitlItemEl) continue;
      deps.renderInline(hitlItemEl.id, hitlData);
    }
    await deps.restoreWorkflow(conversationId);
  } catch (e) {
    deps.logError('restoreHitlInlineForConversation failed', e);
  } finally {
    inFlight.delete(conversationId);
  }
}
