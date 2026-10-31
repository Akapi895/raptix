import { createHitlInlineView } from '@/features/chat/hitl-inline/view';
import { createHitlSidebar } from '@/features/chat/hitl-inline/sidebar';
import { clearDock, renderDock } from '@/features/chat/hitl-inline/dock';
import * as restoration from '@/features/chat/hitl-inline/restore';
import { renderWorkflowApproval, restoreWorkflowApprovals, type WorkflowHitlDeps, type WorkflowHitlData } from '@/features/chat/hitl-inline/workflow';
import type { HitlRecord } from '@/features/chat/hitl-inline/describe';
import type { Trackers } from '@/features/chat/timeline/trackers';
import { browser } from '@/platform/browser';
import type { ChatState } from './state';
import type { ChatProcess } from './process';
import type { ChatTimeline } from './timeline';
import { t, type ChatResources } from './runtime';

export interface ApprovalDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  submitDecision(interruptId: unknown, decision: string, comment: string, editedArgs: unknown, conversationId: string): Promise<boolean>;
  setProjectStatus(conversationId: string, pending: boolean, data?: HitlRecord | null): void;
  syncProjectStatuses(items: unknown[]): void;
  timeline(): ChatTimeline;
  process(): ChatProcess;
  capturePinned(): boolean;
  scrollIntoView(element: HTMLElement, options: ScrollIntoViewOptions): void;
}
export function createChatApprovals(doc: Document, state: ChatState, trackers: Trackers, resources: ChatResources, deps: ApprovalDependencies) {
  const view = createHitlInlineView({
    doc, tr: t, now: Date.now, setInterval: resources.every, clearInterval: browser.clearInterval,
    currentConversationId: state.conversationId, toolView: deps.timeline().toolView,
    interruptItems: state.timeline.hitlInterruptToolItems, approvalClosed: trackers.approvalClosed,
    canSubmit: () => true, submitDecision: deps.submitDecision,
    clearDock: id => clearDock(dock, id), setProjectApprovalStatus: deps.setProjectStatus,
  });
  const dock = { doc, tr: t, now: Date.now, currentConversationId: state.conversationId, view };
  const sidebar = createHitlSidebar({
    doc, tr: t, now: Date.now, setInterval: resources.every, clearInterval: browser.clearInterval,
    currentConversationId: state.conversationId, setProjectApprovalStatus: deps.setProjectStatus,
  });
  const syncTaskAvailability = () => doc.querySelectorAll<HTMLElement>('.hitl-inline-approval[data-conversation-id], .chat-hitl-approval-dock[data-conversation-id]').forEach(panel => view.setTaskAvailability(panel, panel.dataset.conversationId));
  const workflow: WorkflowHitlDeps = {
    doc, request: deps.request, currentConversationId: state.conversationId, setTaskAvailability: view.setTaskAvailability,
    addTimelineItem: (timeline, type, options) => deps.timeline().addItem(timeline, type, { ...options, data: { ...options.data } }),
    loadProcessDetails: async (id, backendId) => { await deps.process().loadPage(id, backendId); },
    expandProcessDetails: id => restoration.expandProcessDetailsTimeline(restore, id), logError: console.error,
  };
  const restore = {
    doc, currentConversationId: state.conversationId, request: deps.request,
    execution: trackers.execution, pending: trackers.pending, syncTaskAvailability,
    clearDock: () => clearDock(dock), renderDock: (data: HitlRecord) => renderDock(dock, data),
    updateSidebar: sidebar.update, renderInline: view.renderApproval,
    loadProcessDetails: async (id: string, backendId: string) => { await deps.process().loadPage(id, backendId); },
    restoreWorkflow: (id: string) => restoreWorkflowApprovals(workflow, id), logError: console.error,
    syncButtonLabels: (id: string, expanded: boolean) => deps.process().renderer.syncButtonLabels(id, expanded),
    syncTurnSummary: (el: HTMLElement | null) => deps.process().turn.sync(el),
    scrollIntoViewIfFollowing(el: HTMLElement, options: ScrollIntoViewOptions) { deps.scrollIntoView(el, options); return true; },
    capturePinned: deps.capturePinned, setTimeout: resources.later,
    syncSidebarState: sidebar.syncState, syncProjectStatuses: deps.syncProjectStatuses,
    restoreInline: (id: string) => { void restoration.restoreHitlInlineForConversation(restore, id); },
  };
  return {
    view, sidebar, syncTaskAvailability,
    renderDock: (data: HitlRecord) => renderDock(dock, data), clearDock: (id?: unknown) => clearDock(dock, id),
    expandDetails: (id: string) => restoration.expandProcessDetailsTimeline(restore, id),
    restoreInline: (id: string) => restoration.restoreHitlInlineForConversation(restore, id),
    reconcile: (items: restoration.PendingItem[] | null | undefined) => restoration.reconcilePendingHitlState(restore, items),
    renderWorkflow: (id: string, data: WorkflowHitlData) => renderWorkflowApproval(workflow, id, data),
    restoreWorkflow: (id: string) => restoreWorkflowApprovals(workflow, id),
    async submitWorkflow(runId: unknown, approved: unknown, comment: unknown) {
      const response = await deps.request(`/api/workflows/runs/${encodeURIComponent(String(runId))}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: !!approved, comment: comment || '' }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Submit failed');
      return body;
    },
    dispose() {
      doc.querySelectorAll<HTMLElement>('.hitl-inline-approval, .chat-hitl-approval-dock').forEach(view.stopCountdown);
      clearDock(dock); sidebar.state.clear();
    },
  };
}
export type ChatApprovals = ReturnType<typeof createChatApprovals>;
