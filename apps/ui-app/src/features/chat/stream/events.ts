// The timeline's reaction to each event of a running turn: the progress card, the thinking and answer streams, the tool calls and
// their results, the workflow steps, the approvals, and the terminal events (an error, a cancel, the end). The page's own writes
// (the timeline items, the messages, the conversation state, the scroll) come in through `StreamPorts`.

import { escapeHtml } from '../../../ui/format';
import type { PendingInterruptTracker } from '../timeline/trackers';
import type { TimelineStreamState, ToolCallEntry } from '../timeline/stream-state';
import type { TimelineTranslate, ToolResultData, ToolCallData } from '../timeline/tool-result';
import { getBackgroundRunningToolLabel, getToolResultDisplayState, toolDisplayStatusFromState } from '../timeline/tool-result';
import {
  progressDoneOutcome,
  shouldReuseMainResponseStream,
  timelineAgentBracketPrefix,
  toolCallMapKey,
  toolResultStreamKey,
  type ResponseStreamMeta,
  type ResponseStreamState,
} from '../timeline/response-stream';
import {
  finalizationCheckTitle,
  finalizationNoticeMarkdown,
  einoMainStreamPlanningTitle,
  hasFinalizationContract,
  isEinoEmptyResponsePlaceholder,
  isFinalizedResponseData,
  resolveFinalAssistantResponseText,
} from '../timeline/labels';
import {
  formatEinoModelFailoverMessage,
  formatEinoModelFailoverTitle,
  formatEinoModelRetryMessage,
  formatEinoModelRetryTitle,
  formatEinoRunRetryMessage,
  formatEinoRunRetryTitle,
  formatEinoUsageSummaryMessage,
  formatEinoUsageSummaryTitle,
  mergeMcpExecutionIdLists,
} from '../timeline/eino-format';
import { mergeStreamBuffer, streamBufferFromAccumulated } from '../timeline/stream-text';
import type { TimelineItemOptions } from '../timeline/item';

export interface StreamEvent {
  type: string;
  message?: string;
  data?: Record<string, unknown> & ToolResultData & ToolCallData;
}

export interface StreamInput {
  progressId: string;
  getAssistantId: (() => string | null) | null;
  setAssistantId: (id: string) => void;
  getMcpIds: (() => unknown[] | null | undefined) | null;
  setMcpIds: (ids: string[]) => void;
  conversationId?: string;
}

/** What the stream does on the page: each one is a page write or read that belongs to the page, not to the stream. */
export interface StreamPorts {
  doc: Document;
  t: TimelineTranslate;
  locale(): string;
  state: TimelineStreamState;
  pending: PendingInterruptTracker;
  currentConversationId(): string;
  conversationIsNull(): boolean;
  resolveTimeline(progressId: string): HTMLElement | null;
  pinned(): boolean;
  scrollIfPinned(pinned: boolean): void;
  dispatchAgentPlan(event: StreamEvent, conversationId: string): void;
  applyBackendIdToLastUser(backendMessageId: string): void;
  addTimeline(timeline: HTMLElement, type: string, options: TimelineItemOptions): string;
  addMessage(role: string, content: string, mcpIds: string[] | null, progressId: string): string;
  updateAssistantBubble(id: string, content: string, renderMarkdown: boolean): void;
  setConversationFromStream(cid: string): void;
  syncLiveConversation(cid: string): void;
  updateActiveConversation(): void;
  addAttackChainButton(cid: string | null): void;
  loadActiveTasks(): void;
  loadConversations(): void;
  refreshProjectFolders(): void;
  updateProgressConversation(progressId: string, cid: string): void;
  finalizeProgressTask(progressId: string, label?: string): void;
  stopElapsedClock(progressId: string): void;
  translateProgressMessage(message: string, data: unknown): string;
  translatePlanPhase(agentName: unknown): string;
  resolveEventBackendMessageId(data: unknown): string;
  applyBackendIdToAssistantDom(domId: string, backendId: string): void;
  integrateProgressToMCPSection(progressId: string, assistantId: string, mcpIds: string[], terminalStatus?: string): void;
  applyTurnTiming(progressId: string, el: HTMLElement | null, status: string): void;
  maybeReloadLazy(assistantId: string): void;
  collapseAllProgressDetails(assistantId: string | null, progressId: string | null, options?: { force?: boolean }): void;
  hideProgressMessageForFinalReply(progressId: string): void;
  clearTimelineStreams(progressId: string): void;
  finalizeOutstandingToolCalls(progressId: string, status: string): void;
  markCancelledExecutions(root: HTMLElement | null, executionIds: string[]): void;
  autoCancelledIds(data: unknown): string[];
  updateToolCallStatus(progressId: string, toolCallId: string, status: string): void;
  attachToolResult(progressId: string, toolCallId: string, data: ToolResultData): boolean;
  mergeIntoCall(item: HTMLElement, data: ToolResultData): void;
  formatToolTitle(name: string, index: number, total: number): string;
  identityFor(progressId: string, responseData: ResponseStreamMeta): string;
  findRestoredResponseItem(timeline: HTMLElement | null, responseData: ResponseStreamMeta): HTMLElement | null;
  restoredResponseState(progressId: string, item: HTMLElement, responseData: ResponseStreamMeta): ResponseStreamState | null;
  finalizeMainResponseItem(streamState: ResponseStreamState, finalMessage: unknown, responseData: ResponseStreamMeta): boolean;
  markAssistantFinalization(id: string, data: ResponseStreamMeta): void;
  isDirectReplay(progressId: string): boolean;
  clearReplayFor(progressId: string): void;
  syncReasoningFromServer(backendId: string, assistantId: string): void;
  renderInlineApproval(itemId: string, data: Record<string, unknown>): void;
  resolveInlineDecision(timeline: HTMLElement, data: Record<string, unknown>, decision: string, message: unknown): boolean;
  findToolItemForHitl(timeline: HTMLElement, data: Record<string, unknown>): HTMLElement | null;
  renderChatDock(data: Record<string, unknown>): void;
  clearChatDock(interruptId: unknown): void;
  updateApprovalSidebar(data: Record<string, unknown>, pending: boolean): void;
  renderInlineWorkflowApproval(itemId: string, data: Record<string, unknown>): void;
  setStreamPlain(element: HTMLElement, text: string): void;
  scheduleStreamPlain(element: HTMLElement, text: string): void;
  flushStreamPlain(element: HTMLElement): void;
  dispatchWindowEvent(name: string, detail: unknown): void;
  setTimer(callback: () => void, ms: number): void;
}

const NO_TIMELINE_TYPES = new Set(['conversation', 'response', 'error', 'cancelled', 'done']);

const str = (value: unknown): string => String(value).trim();

/**
 * Handles one event of the stream. Events of another conversation, or of a progress that is no longer on the page, are dropped;
 * the rest update the timeline and the page state each one belongs to.
 */
export function handleStreamEvent(ports: StreamPorts, event: StreamEvent, input: StreamInput): void {
  const { progressId, getAssistantId, setAssistantId } = input;
  const state = ports.state;
  const doc = ports.doc;
  const t = ports.t;
  const expectedConversationId = input.conversationId ? String(input.conversationId) : '';
  const eventConversationId = event && event.data && event.data.conversationId ? String(event.data.conversationId) : '';
  if (expectedConversationId) {
    if (eventConversationId && eventConversationId !== expectedConversationId) return;
    const current = ports.currentConversationId();
    if (current && current !== expectedConversationId) return;
    const progressNode = progressId ? doc.getElementById(progressId) : null;
    const progressConversationId = progressNode && progressNode.dataset ? String(progressNode.dataset.conversationId || '') : '';
    if (progressConversationId && progressConversationId !== expectedConversationId) return;
  }
  ports.dispatchAgentPlan(event, expectedConversationId || eventConversationId);
  const streamScrollWasPinned = ports.pinned();

  // Not bound to the progress timeline: the first event of the stream binds the user message id.
  if (event.type === 'message_saved') {
    const d = event.data || {};
    if (d.userMessageId) ports.applyBackendIdToLastUser(str(d.userMessageId));
    ports.scrollIfPinned(streamScrollWasPinned);
    return;
  }

  const timeline = ports.resolveTimeline(progressId);
  if (!timeline && !NO_TIMELINE_TYPES.has(String(event.type || ''))) return;

  /** The message a terminal event shows: the existing answer when there is one, else a new message. */
  const upsertTerminalAssistantMessage = (message: string, preferredMessageId: string | null) => {
    const preferredIds: string[] = [];
    if (preferredMessageId) preferredIds.push(preferredMessageId);
    const existingAssistantId = getAssistantId ? getAssistantId() : null;
    if (existingAssistantId && !preferredIds.includes(existingAssistantId)) preferredIds.push(existingAssistantId);
    for (const id of preferredIds) {
      const element = doc.getElementById(id) as HTMLElement | null;
      if (element) {
        ports.updateAssistantBubble(id, message, true);
        if (setAssistantId) setAssistantId(id);
        return { assistantId: id, assistantElement: element };
      }
    }
    const assistantId = ports.addMessage('assistant', message, null, progressId);
    if (setAssistantId) setAssistantId(assistantId);
    return { assistantId, assistantElement: doc.getElementById(assistantId) as HTMLElement | null };
  };

  const tl = (type: string, options: TimelineItemOptions): string => (timeline ? ports.addTimeline(timeline, type, options) : '');
  const d = (event.data || {}) as Record<string, unknown> & ToolResultData & ToolCallData;
  const msg = event.message || '';
  const locale = ports.locale();

  switch (event.type) {
    case 'heartbeat':
      break;

    case 'conversation': {
      if (event.data && event.data.conversationId) {
        const taskState = state.progressTasks.get(progressId);
        const originalConversationId = taskState?.conversationId;
        const cid = str(event.data.conversationId);
        ports.updateProgressConversation(progressId, cid);
        // A new conversation was started by the user: an event of the old conversation does not replace it.
        if (ports.conversationIsNull() && originalConversationId !== null) break;
        ports.setConversationFromStream(cid);
        ports.syncLiveConversation(cid);
        ports.updateActiveConversation();
        ports.addAttackChainButton(cid);
        ports.loadActiveTasks();
        ports.setTimer(() => {
          ports.loadConversations();
          ports.refreshProjectFolders();
        }, 200);
      }
      break;
    }

    case 'iteration': {
      const n = d.iteration != null ? (d.iteration as number) : 1;
      const scope = d.einoScope != null ? str(d.einoScope) : '';
      if (scope !== 'sub') {
        const prevMainIter = state.mainIterations.get(String(progressId));
        const prevN = prevMainIter && prevMainIter.iteration != null ? prevMainIter.iteration : null;
        const prevNode = prevMainIter && prevMainIter.workflowNodeId != null ? str(prevMainIter.workflowNodeId) : '';
        const curNode = d.workflowNodeId != null ? str(d.workflowNodeId) : '';
        const prevAgent = prevMainIter && prevMainIter.einoAgent != null ? str(prevMainIter.einoAgent) : '';
        const curAgent = d.einoAgent != null ? str(d.einoAgent) : '';
        const prevOrchestration = prevMainIter && prevMainIter.orchestration != null ? str(prevMainIter.orchestration) : '';
        const curOrchestration = d.orchestration != null ? str(d.orchestration) : '';
        const duplicateMainIteration = prevN != null && String(prevN) === String(n) &&
          prevNode === curNode && prevAgent === curAgent && prevOrchestration === curOrchestration;
        state.mainIterations.set(String(progressId), {
          iteration: n,
          orchestration: d.orchestration != null ? d.orchestration : '',
          workflowNodeId: curNode,
          einoAgent: curAgent,
        });
        // A new round of the main channel, or a new agent node of a workflow, does not reuse the stream of the previous part.
        if (prevN != null && (Number(n) < Number(prevN) || prevN !== n || (curNode && prevNode && curNode !== prevNode))) {
          ports.clearTimelineStreams(progressId);
        }
        // The same main agent can announce the same round twice; the state is kept, the timeline keeps one item.
        if (duplicateMainIteration) break;
      }
      let iterTitle: string;
      if (d.orchestration === 'plan_execute' && d.einoScope === 'main') {
        iterTitle = t('chat.einoPlanExecuteRound', { n, phase: ports.translatePlanPhase(d.einoAgent) });
      } else if (d.einoScope === 'main') {
        iterTitle = t('chat.einoOrchestratorRound', { n });
      } else if (d.einoScope === 'sub') {
        iterTitle = t('chat.einoSubAgentStep', { n, agent: d.einoAgent != null ? str(d.einoAgent) : '' });
      } else {
        iterTitle = t('chat.iterationRound', { n });
      }
      tl('iteration', { title: iterTitle, message: event.message, data: d as never, iterationN: Number(n) });
      break;
    }

    case 'workflow_start': {
      const name = d.workflowName || d.workflowId || '';
      tl('workflow_start', { title: '🧭 Workflow started' + (name ? ' · ' + str(name) : ''), message: msg, data: d as never });
      break;
    }

    case 'workflow_done': {
      const name = d.workflowName || d.workflowId || '';
      tl('workflow_done', { title: '✅ Workflow completed' + (name ? ' · ' + str(name) : ''), message: msg, data: d as never });
      break;
    }

    case 'workflow_node_start': {
      const label = d.label || d.nodeId || '';
      const nodeType = d.nodeType != null ? str(d.nodeType).toLowerCase() : '';
      if (nodeType === 'agent') ports.clearTimelineStreams(progressId);
      tl('workflow_node_start', { title: '▶ Node started' + (label ? ' · ' + str(label) : ''), message: msg, data: d as never });
      break;
    }

    case 'workflow_node_result': {
      const label = d.label || d.nodeId || '';
      const status = d.status || '';
      const nodeType = d.nodeType != null ? str(d.nodeType).toLowerCase() : '';
      let title: string;
      if (nodeType === 'condition') {
        const output = d.output as Record<string, unknown> | undefined;
        const matched = d.matched === true || d.matched === 'true' || (output && (output.matched === true || output.matched === 'true'));
        title = (matched ? '✅' : '🔀') + ' Condition' + (label ? ' · ' + str(label) : '') + ' → ' + (matched ? 'yes' : 'no');
      } else {
        const icon = status === 'failed' ? '❌' : (status === 'skipped' ? '⏭️' : '✅');
        title = icon + ' Node completed' + (label ? ' · ' + str(label) : '') + (status ? ` (${str(status)})` : '');
      }
      tl('workflow_node_result', { title, message: msg, data: d as never });
      break;
    }

    case 'workflow_branch_taken':
    case 'workflow_branch_skipped': {
      const branch = d.branchLabel || '';
      const target = d.targetLabel || d.targetId || '';
      const taken = event.type === 'workflow_branch_taken';
      tl(event.type, {
        title: (taken ? '➡️' : '⏭️') + (taken ? ' Branch taken' : ' Branch skipped') + (branch ? ' · ' + str(branch) : '') + (target ? ' → ' + str(target) : ''),
        message: msg,
        data: d as never,
      });
      break;
    }

    case 'workflow_tool_start': {
      const tool = d.tool || d.toolName || '';
      tl('workflow_tool_start', { title: '🔧 Tool node' + (tool ? ' · ' + str(tool) : ''), message: msg, data: d as never });
      break;
    }

    case 'workflow_agent_output': {
      const label = d.label || d.nodeId || '';
      tl('workflow_agent_output', { title: '🤖 Agent output' + (label ? ' · ' + str(label) : ''), message: msg, data: d as never });
      break;
    }

    case 'workflow_hitl_checkpoint':
      tl('workflow_hitl_checkpoint', { title: '🧑‍⚖️ Human confirmation checkpoint', message: msg, data: d as never });
      break;

    case 'workflow_hitl_waiting': {
      const hitlItemId = tl('workflow_hitl_waiting', { title: '🧑‍⚖️ Workflow awaiting approval', message: msg, data: d as never });
      ports.renderInlineWorkflowApproval(hitlItemId, d);
      break;
    }

    case 'workflow_hitl_resumed':
      tl('workflow_hitl_resumed', { title: '✅ Approval granted', message: event.message || 'Manual approval granted; continuing execution', data: d as never });
      break;

    case 'workflow_hitl_rejected':
      tl('workflow_hitl_rejected', { title: '❌ Approval rejected', message: msg, data: d as never });
      break;

    case 'workflow_paused':
      tl('workflow_paused', { title: '⏸️ Workflow paused', message: msg, data: d as never });
      break;

    case 'eino_trace_run':
    case 'eino_trace_start':
    case 'eino_trace_end':
    case 'eino_trace_error': {
      const comp = d.component != null ? str(d.component) : '';
      const name = d.name != null ? str(d.name) : '';
      let glyph = '◆';
      if (event.type === 'eino_trace_run') glyph = '●';
      else if (event.type === 'eino_trace_start') glyph = '▶';
      else if (event.type === 'eino_trace_end') glyph = '■';
      else if (event.type === 'eino_trace_error') glyph = '✖';
      const title = '[Eino] ' + glyph + ' ' + (comp || 'component') + (name ? '/' + name : '');
      const parts: string[] = [];
      if (d.runId) parts.push('run=' + str(d.runId));
      if (d.spanId) parts.push('span=' + str(d.spanId));
      if (d.parentSpanId) parts.push('parent=' + str(d.parentSpanId));
      if (d.inputSummary) parts.push(str(d.inputSummary));
      if (d.outputSummary) parts.push(str(d.outputSummary));
      if (d.error) parts.push(str(d.error));
      if (event.message && str(event.message)) parts.push(str(event.message));
      tl('progress', { title, message: parts.join(' · '), data: d as never });
      break;
    }

    case 'thinking_stream_start':
    case 'reasoning_chain_stream_start': {
      const streamId = d.streamId ? str(d.streamId) : '';
      if (!streamId) break;
      const timelineType = event.type === 'reasoning_chain_stream_start' ? 'reasoning_chain' : 'thinking';
      let streams = state.thinkingStreams.get(progressId);
      if (!streams) {
        streams = new Map();
        state.thinkingStreams.set(progressId, streams);
      }
      // A repeated start of the same stream reuses its item, so that the stream does not get a second card.
      if (streams.has(streamId)) {
        const ex = streams.get(streamId);
        if (!ex) break;
        ex.buffer = '';
        const existingItem = doc.getElementById(ex.itemId) as HTMLElement | null;
        const contentEl = existingItem?.querySelector<HTMLElement>('.timeline-item-content');
        if (contentEl) ports.setStreamPlain(contentEl, '');
        break;
      }
      const labelBase = t(timelineType === 'reasoning_chain' ? 'chat.reasoningChain' : 'chat.aiThinking');
      const emoji = timelineType === 'reasoning_chain' ? '🔗' : '🤔';
      const itemId = tl(timelineType, { title: timelineAgentBracketPrefix(d) + emoji + ' ' + labelBase, message: ' ', data: d as never });
      streams.set(streamId, { itemId, buffer: '' });
      break;
    }

    case 'thinking_stream_delta':
    case 'reasoning_chain_stream_delta': {
      const streamId = d.streamId ? str(d.streamId) : '';
      if (!streamId) break;
      const streams = state.thinkingStreams.get(progressId);
      if (!streams || !streams.has(streamId)) break;
      const s = streams.get(streamId);
      if (!s) break;
      s.buffer = mergeStreamBuffer(s.buffer, event.message || '', d as never);
      const item = doc.getElementById(s.itemId) as HTMLElement | null;
      const contentEl = item?.querySelector<HTMLElement>('.timeline-item-content');
      if (contentEl) ports.scheduleStreamPlain(contentEl, s.buffer);
      break;
    }

    case 'thinking':
    case 'reasoning_chain': {
      const timelineType = event.type === 'reasoning_chain' ? 'reasoning_chain' : 'thinking';
      // A thinking step that was already built from a stream (it has a stream id) is not added again.
      if (event.data && event.data.streamId) {
        const streamId = str(event.data.streamId);
        const streams = state.thinkingStreams.get(progressId);
        if (streams && streams.has(streamId)) {
          const s = streams.get(streamId);
          if (s) {
            s.buffer = event.message || '';
            const item = doc.getElementById(s.itemId) as HTMLElement | null;
            const contentEl = item?.querySelector<HTMLElement>('.timeline-item-content');
            if (contentEl) {
              ports.flushStreamPlain(contentEl);
              ports.setStreamPlain(contentEl, s.buffer);
            }
          }
          break;
        }
      }
      const labelBase = t(timelineType === 'reasoning_chain' ? 'chat.reasoningChain' : 'chat.aiThinking');
      const emoji = timelineType === 'reasoning_chain' ? '🔗' : '🤔';
      tl(timelineType, { title: timelineAgentBracketPrefix(event.data) + emoji + ' ' + labelBase, message: event.message, data: event.data as never });
      break;
    }

    case 'tool_calls_detected':
      // The text of the answer ends here and a tool batch starts: the next response_start opens a new item.
      state.responseStreams.delete(progressId);
      break;

    case 'warning':
      tl('warning', { title: '⚠️', message: event.message, data: event.data as never });
      break;

    case 'finalization_check': {
      const data = (event.data || {}) as ResponseStreamMeta;
      const passed = isFinalizedResponseData(data);
      tl('finalization_check', {
        title: finalizationCheckTitle(data),
        message: passed ? (event.message || 'Final response checks passed.') : finalizationNoticeMarkdown(data, event.message),
        data: event.data as never,
        expanded: !passed,
      } as TimelineItemOptions);
      break;
    }

    case 'finalization_auto_continue':
      tl('progress', { title: 'Continue verification', message: event.message, data: event.data as never, expanded: false } as TimelineItemOptions);
      break;

    case 'finalization_pending_tools_cancelled':
      ports.markCancelledExecutions(timeline, ports.autoCancelledIds(d));
      tl('progress', { title: 'Tool executions wrapped up', message: event.message, data: d as never, expanded: false } as TimelineItemOptions);
      break;

    case 'hitl_audit_agent_started': {
      const auditData: Record<string, unknown> = { ...(event.data || {}), reviewer: 'audit_agent', status: 'audit_running' };
      const auditTargetItem = timeline ? ports.findToolItemForHitl(timeline, auditData) : null;
      if (auditTargetItem && auditTargetItem.id) {
        ports.renderInlineApproval(auditTargetItem.id, auditData);
      } else {
        const auditItemId = tl('hitl_audit_agent_started', { title: 'Audit agent is reviewing', message: event.message, data: auditData as never });
        ports.renderInlineApproval(auditItemId, auditData);
      }
      break;
    }

    case 'hitl_audit_agent': {
      const auditDecisionData: Record<string, unknown> = { ...(event.data || {}), reviewer: 'audit_agent', decidedBy: 'audit_agent', status: 'decided' };
      const auditDecision = auditDecisionData.decision === 'reject' ? 'reject' : 'approve';
      if (!timeline || !ports.resolveInlineDecision(timeline, auditDecisionData, auditDecision, event.message)) {
        const auditTargetItem = timeline ? ports.findToolItemForHitl(timeline, auditDecisionData) : null;
        if (auditTargetItem && auditTargetItem.id) {
          ports.renderInlineApproval(auditTargetItem.id, { ...auditDecisionData, resolved: true, decision: auditDecision });
        }
      }
      break;
    }

    case 'hitl_interrupt': {
      const data = (event.data || {}) as Record<string, unknown>;
      ports.pending.add(data);
      ports.pending.ready = true;
      const hitlTargetItem = timeline ? ports.findToolItemForHitl(timeline, data) : null;
      if (hitlTargetItem && hitlTargetItem.id) {
        ports.renderInlineApproval(hitlTargetItem.id, data);
      } else {
        const hitlItemId = tl('hitl_interrupt', { title: '🧑‍⚖️ HITL', message: event.message, data: event.data as never });
        ports.renderInlineApproval(hitlItemId, data);
      }
      ports.renderChatDock(data);
      ports.updateApprovalSidebar(data, true);
      ports.dispatchWindowEvent('hitl-interrupt', data);
      break;
    }

    case 'hitl_resumed': {
      ports.pending.remove(event.data && event.data.interruptId);
      ports.pending.ready = true;
      const data = (event.data || {}) as Record<string, unknown>;
      if (!timeline || !ports.resolveInlineDecision(timeline, data, 'approve', event.message)) {
        tl('progress', { title: '✅ HITL', message: event.message, data: event.data as never });
      }
      ports.clearChatDock(event.data && event.data.interruptId);
      ports.updateApprovalSidebar(data, false);
      ports.dispatchWindowEvent('hitl-resolved', data);
      break;
    }

    case 'hitl_rejected': {
      ports.pending.remove(event.data && event.data.interruptId);
      ports.pending.ready = true;
      const data = (event.data || {}) as Record<string, unknown>;
      if (!timeline || !ports.resolveInlineDecision(timeline, data, 'reject', event.message)) {
        tl('error', { title: '⛔ HITL', message: event.message, data: event.data as never });
      }
      ports.clearChatDock(event.data && event.data.interruptId);
      ports.updateApprovalSidebar(data, false);
      ports.dispatchWindowEvent('hitl-resolved', data);
      break;
    }

    case 'user_interrupt_continue':
      tl('user_interrupt_continue', { title: t('chat.userInterruptContinueTitle'), message: msg, data: d as never });
      ports.finalizeOutstandingToolCalls(progressId, 'failed');
      break;

    case 'eino_stream_error': {
      const agent = d.einoAgent ? str(d.einoAgent) : '';
      tl('warning', {
        title: t('chat.einoStreamErrorTitle', { agent: agent || '-' }),
        message: event.message || t('chat.einoStreamErrorMessage'),
        data: d as never,
      });
      break;
    }

    case 'eino_empty_response_continue':
      tl('warning', {
        title: t('chat.einoEmptyResponseContinueTitle'),
        message: event.message || t('chat.einoEmptyResponseContinueMessage'),
        data: d as never,
      });
      break;

    case 'eino_run_retry':
      tl('warning', { title: formatEinoRunRetryTitle(t, d), message: formatEinoRunRetryMessage(t, event.message, d), data: d as never });
      break;

    case 'eino_model_retry':
      tl('warning', { title: formatEinoModelRetryTitle(t, d), message: formatEinoModelRetryMessage(event.message, d), data: d as never });
      break;

    case 'eino_model_failover':
      tl('warning', { title: formatEinoModelFailoverTitle(t, d), message: formatEinoModelFailoverMessage(event.message, d), data: d as never });
      break;

    case 'eino_usage_summary':
      tl('eino_usage_summary', {
        title: formatEinoUsageSummaryTitle(t, d, locale),
        message: formatEinoUsageSummaryMessage(t, d, locale),
        data: d as never,
        expanded: false,
      } as TimelineItemOptions);
      break;

    case 'iteration_limit_reached':
      tl('warning', {
        title: t('chat.iterationLimitReachedTitle'),
        message: event.message || t('chat.iterationLimitReachedMessage'),
        data: event.data as never,
      });
      ports.finalizeOutstandingToolCalls(progressId, 'failed');
      break;

    case 'eino_pending_orphaned': {
      const count = Number(d.pendingCount || 0);
      const countText = Number.isFinite(count) && count > 0 ? String(count) : '?';
      tl('warning', {
        title: t('chat.einoPendingOrphanedTitle'),
        message: event.message || t('chat.einoPendingOrphanedMessage', { count: countText }),
        data: d as never,
      });
      ports.finalizeOutstandingToolCalls(progressId, 'failed');
      break;
    }

    case 'tool_call': {
      const toolName = d.toolName || t('chat.unknownTool');
      const index = Number(d.index || 0);
      const total = Number(d.total || 0);
      const toolCallId = d.toolCallId ? str(d.toolCallId) : null;
      if (toolCallId) {
        const existing = state.toolCalls.get(toolCallMapKey(progressId, toolCallId)) ?? state.toolCalls.get(String(toolCallId));
        if (existing && existing.itemId) {
          const existingItem = doc.getElementById(existing.itemId) as HTMLElement | null;
          if (existingItem) {
            // A repeated call of the same id (a retry or a resend) only updates the status; it is not added again.
            if (!existing.terminalStatus) ports.updateToolCallStatus(progressId, toolCallId, 'running');
            break;
          }
        }
      }
      const toolCallItemId = tl('tool_call', {
        title: timelineAgentBracketPrefix(d) + '🔧 ' + ports.formatToolTitle(str(toolName), index, total),
        message: event.message,
        data: d as never,
        processDetailId: d.processDetailId || '',
        expanded: false,
      } as TimelineItemOptions);
      if (toolCallId && toolCallItemId) {
        state.toolCalls.set(toolCallMapKey(progressId, toolCallId), { toolCallId, itemId: toolCallItemId, timeline, progressId } as ToolCallEntry);
        ports.updateToolCallStatus(progressId, toolCallId, 'running');
      }
      break;
    }

    case 'tool_result_delta':
      // The output of a tool is not streamed; the final result is shown when tool_result arrives.
      break;

    case 'tool_result': {
      const resultToolName = d.toolName || t('chat.unknownTool');
      const successState = getToolResultDisplayState(d);
      const displayState = getToolResultDisplayState(d, { rawText: msg });
      const success = successState.success;
      const backgroundRunning = displayState.kind === 'background_running';
      const statusIcon = displayState.kind === 'blocked' ? '🛡' : (backgroundRunning ? '⏳' : (success ? '✅' : '❌'));
      const resultToolCallId = d.toolCallId ? str(d.toolCallId) : null;
      const resultStatusForCall = toolDisplayStatusFromState(displayState);
      const nameHtml = escapeHtml(String(resultToolName));
      const resultExecText = displayState.kind === 'blocked'
        ? t('chat.toolExecBlocked', { name: nameHtml })
        : backgroundRunning
          ? getBackgroundRunningToolLabel(t) + ': ' + nameHtml
          : (success ? t('chat.toolExecComplete', { name: nameHtml }) : t('chat.toolExecFailed', { name: nameHtml }));

      if (resultToolCallId) {
        const key = toolResultStreamKey(progressId, resultToolCallId);
        const streamState = state.toolResultStreams.get(key);
        if (streamState && streamState.itemId) {
          const streamCallItem = doc.getElementById(streamState.itemId) as HTMLElement | null;
          if (streamCallItem) ports.mergeIntoCall(streamCallItem, d);
          state.toolResultStreams.delete(key);
          const entry = state.toolCalls.get(toolCallMapKey(progressId, resultToolCallId));
          if (entry) {
            ports.updateToolCallStatus(progressId, resultToolCallId, resultStatusForCall);
            entry.terminalStatus = resultStatusForCall;
          }
          break;
        }
        if (ports.attachToolResult(progressId, resultToolCallId, d)) {
          const entry = state.toolCalls.get(toolCallMapKey(progressId, resultToolCallId));
          if (entry) {
            ports.updateToolCallStatus(progressId, resultToolCallId, resultStatusForCall);
            entry.terminalStatus = resultStatusForCall;
          }
          break;
        }
      }

      if (resultToolCallId) {
        const entry = state.toolCalls.get(toolCallMapKey(progressId, resultToolCallId));
        if (entry) {
          ports.updateToolCallStatus(progressId, resultToolCallId, resultStatusForCall);
          entry.terminalStatus = resultStatusForCall;
        }
      }
      tl('tool_result', {
        title: timelineAgentBracketPrefix(d) + statusIcon + ' ' + resultExecText,
        message: event.message,
        data: d as never,
        processDetailId: d.processDetailId || '',
        expanded: false,
      } as TimelineItemOptions);
      break;
    }

    case 'eino_agent_reply_stream_start': {
      const streamId = d.streamId ? str(d.streamId) : '';
      if (!streamId) break;
      let streams = state.einoReplyStreams.get(progressId);
      if (!streams) {
        streams = new Map();
        state.einoReplyStreams.set(progressId, streams);
      }
      if (streams.has(streamId)) {
        const ex = streams.get(streamId);
        if (!ex) break;
        ex.buffer = '';
        const existingItem = doc.getElementById(ex.itemId) as HTMLElement | null;
        const contentEl = existingItem?.querySelector<HTMLElement>('.timeline-item-content');
        if (contentEl) ports.setStreamPlain(contentEl, '');
        break;
      }
      const itemId = tl('eino_agent_reply', {
        title: timelineAgentBracketPrefix(d) + '💬 ' + t('chat.einoAgentReplyTitle') + ' · ' + t('timeline.running'),
        message: ' ',
        data: d as never,
        expanded: false,
      } as TimelineItemOptions);
      streams.set(streamId, { itemId, buffer: '' });
      break;
    }

    case 'eino_agent_reply_stream_delta': {
      const streamId = d.streamId ? str(d.streamId) : '';
      if (!streamId) break;
      const delta = event.message || '';
      if (!delta && streamBufferFromAccumulated(d as never) === null) break;
      const streams = state.einoReplyStreams.get(progressId);
      if (!streams || !streams.has(streamId)) break;
      const s = streams.get(streamId);
      if (!s) break;
      s.buffer = mergeStreamBuffer(s.buffer, delta, d as never);
      const item = doc.getElementById(s.itemId) as HTMLElement | null;
      if (item) {
        let contentEl = item.querySelector<HTMLElement>('.timeline-item-content');
        if (!contentEl && item.querySelector('.timeline-item-header')) {
          contentEl = doc.createElement('div');
          contentEl.className = 'timeline-item-content';
          item.appendChild(contentEl);
        }
        if (contentEl) ports.scheduleStreamPlain(contentEl, s.buffer);
      }
      break;
    }

    case 'eino_agent_reply_stream_end': {
      const streamId = d.streamId ? str(d.streamId) : '';
      const streams = state.einoReplyStreams.get(progressId);
      if (streamId && streams && streams.has(streamId)) {
        const s = streams.get(streamId);
        if (s) {
          const full = event.message != null && event.message !== '' ? String(event.message) : s.buffer;
          s.buffer = full;
          const item = doc.getElementById(s.itemId) as HTMLElement | null;
          if (item) {
            const titleEl = item.querySelector<HTMLElement>('.timeline-item-title');
            if (titleEl) titleEl.textContent = timelineAgentBracketPrefix(d) + '💬 ' + t('chat.einoAgentReplyTitle');
            let contentEl = item.querySelector<HTMLElement>('.timeline-item-content');
            if (!contentEl) {
              contentEl = doc.createElement('div');
              contentEl.className = 'timeline-item-content';
              item.appendChild(contentEl);
            }
            ports.flushStreamPlain(contentEl);
            ports.setStreamPlain(contentEl, full);
            if (d.einoAgent != null && str(d.einoAgent)) item.dataset.einoAgent = str(d.einoAgent);
          }
          streams.delete(streamId);
        }
      }
      break;
    }

    case 'eino_agent_reply':
      tl('eino_agent_reply', {
        title: timelineAgentBracketPrefix(d) + '💬 ' + t('chat.einoAgentReplyTitle'),
        message: event.message || '',
        data: d as never,
        expanded: false,
      } as TimelineItemOptions);
      break;

    case 'progress': {
      const progressTitle = doc.querySelector<HTMLElement>(`#${progressId} .progress-stage`);
      if (progressTitle) {
        const progressEl = doc.getElementById(progressId);
        if (progressEl) {
          progressEl.dataset.progressRawMessage = event.message || '';
          try {
            progressEl.dataset.progressRawData = event.data ? JSON.stringify(event.data) : '';
          } catch {
            progressEl.dataset.progressRawData = '';
          }
        }
        progressTitle.textContent = ports.translateProgressMessage(event.message || '', event.data);
      }
      break;
    }

    case 'cancelled': {
      ports.stopElapsedClock(progressId);
      const taskCancelledText = t('chat.taskCancelled');
      if (timeline) ports.addTimeline(timeline, 'cancelled', { title: '⛔ ' + taskCancelledText, message: event.message, data: event.data as never });
      const cancelTitle = doc.querySelector<HTMLElement>(`#${progressId} .progress-stage`);
      if (cancelTitle) cancelTitle.textContent = '⛔ ' + taskCancelledText;
      const cancelProgressContainer = doc.querySelector<HTMLElement>(`#${progressId} .progress-container`);
      if (cancelProgressContainer) cancelProgressContainer.classList.add('completed');
      if (state.progressTasks.has(progressId)) ports.finalizeProgressTask(progressId, t('tasks.statusCancelled'));

      // The answer of a terminal event is reused when there is one, so that the same notice is not shown twice.
      const preferredMessageId = ports.resolveEventBackendMessageId(event.data) || null;
      const { assistantId, assistantElement } = upsertTerminalAssistantMessage(event.message || '', preferredMessageId);
      if (assistantId && preferredMessageId) ports.applyBackendIdToAssistantDom(assistantId, preferredMessageId);
      if (assistantElement) {
        const detailsId = 'process-details-' + assistantId;
        if (!doc.getElementById(detailsId)) {
          ports.integrateProgressToMCPSection(progressId, assistantId, ((input.getMcpIds ? (input.getMcpIds() || []) : []) as string[]), 'cancelled');
        } else if (preferredMessageId) {
          ports.applyTurnTiming(progressId, assistantElement, 'cancelled');
          ports.maybeReloadLazy(assistantId);
        }
        ports.setTimer(() => ports.collapseAllProgressDetails(assistantId, progressId), 100);
      }
      ports.loadActiveTasks();
      ports.finalizeOutstandingToolCalls(progressId, 'cancelled');
      break;
    }

    case 'response_start': {
      const responseData = (event.data || {}) as ResponseStreamMeta;
      const streamIdentity = ports.identityFor(progressId, responseData);
      const mcpIds = (responseData.mcpExecutionIds as string[] | undefined) || [];
      input.setMcpIds(mergeMcpExecutionIdLists(input.getMcpIds ? (input.getMcpIds() || []) : [], mcpIds));

      const responseTaskState = state.progressTasks.get(progressId);
      const responseOriginalConversationId = responseTaskState?.conversationId;
      if (responseData.conversationId) {
        if (ports.conversationIsNull() && responseOriginalConversationId !== null) {
          ports.updateProgressConversation(progressId, str(responseData.conversationId));
          break;
        }
        const cid = str(responseData.conversationId);
        ports.setConversationFromStream(cid);
        ports.syncLiveConversation(cid);
        ports.updateActiveConversation();
        ports.addAttackChainButton(cid);
        ports.updateProgressConversation(progressId, cid);
        ports.loadActiveTasks();
      }

      // During a multi-agent run the output of an iteration only shows on the timeline; it does not make an answer bubble.
      const prevStream = state.responseStreams.get(progressId);
      const streamOrch = responseData.orchestration != null
        ? responseData.orchestration
        : (prevStream && prevStream.streamMeta ? prevStream.streamMeta.orchestration : '');
      if (shouldReuseMainResponseStream(prevStream, responseData, streamOrch, streamIdentity)) {
        // Eino can start the same message stream twice: the item and its buffer are reused.
        if (prevStream) {
          prevStream.streamMeta = { ...(prevStream.streamMeta || {}), ...responseData };
          prevStream.streamIdentity = streamIdentity;
          if (responseData.streamId != null) prevStream.streamId = str(responseData.streamId);
          state.responseStreams.set(progressId, prevStream);
        }
        break;
      }
      const restoredItem = ports.findRestoredResponseItem(timeline, responseData);
      if (restoredItem) {
        const restored = ports.restoredResponseState(progressId, restoredItem, responseData);
        if (restored) state.responseStreams.set(progressId, restored);
        break;
      }
      const itemId = tl('thinking', {
        title: einoMainStreamPlanningTitle(responseData, timelineAgentBracketPrefix(responseData), t),
        message: ' ',
        data: { ...responseData, responseStreamPlaceholder: true } as never,
      });
      state.responseStreams.set(progressId, {
        progressId,
        itemId,
        buffer: '',
        streamMeta: responseData,
        streamIdentity,
        streamId: responseData.streamId != null ? str(responseData.streamId) : '',
      });
      break;
    }

    case 'response_delta': {
      const responseData = (event.data || {}) as ResponseStreamMeta;
      const responseTaskState = state.progressTasks.get(progressId);
      const responseOriginalConversationId = responseTaskState?.conversationId;
      if (responseData.conversationId && ports.conversationIsNull() && responseOriginalConversationId !== null) {
        ports.updateProgressConversation(progressId, str(responseData.conversationId));
        break;
      }
      let streamState = state.responseStreams.get(progressId);
      const incomingStreamId = responseData.streamId != null ? str(responseData.streamId) : '';
      if (!streamState) {
        const restoredItem = ports.findRestoredResponseItem(timeline, responseData);
        streamState = restoredItem ? ports.restoredResponseState(progressId, restoredItem, responseData) ?? undefined : undefined;
        if (!streamState) {
          const itemId = tl('thinking', {
            title: einoMainStreamPlanningTitle(responseData, timelineAgentBracketPrefix(responseData), t),
            message: ' ',
            data: { ...responseData, responseStreamPlaceholder: true } as never,
          });
          streamState = {
            progressId,
            itemId,
            buffer: '',
            streamMeta: responseData,
            streamIdentity: ports.identityFor(progressId, responseData),
            streamId: incomingStreamId,
          };
        }
        state.responseStreams.set(progressId, streamState);
      } else if (!streamState.streamMeta && (responseData.einoAgent || responseData.orchestration)) {
        streamState.streamMeta = responseData;
      }
      if (incomingStreamId && streamState.streamId && streamState.streamId !== incomingStreamId) break;
      if (incomingStreamId && !streamState.streamId) streamState.streamId = incomingStreamId;

      const deltaContent = event.message || '';
      if (!deltaContent && streamBufferFromAccumulated(responseData as never) === null) break;
      streamState.buffer = mergeStreamBuffer(streamState.buffer, deltaContent, responseData as never);

      // The stream only appends plain text; the full markdown is rendered when the final response arrives.
      if (streamState.itemId) {
        const item = doc.getElementById(streamState.itemId) as HTMLElement | null;
        const contentEl = item?.querySelector<HTMLElement>('.timeline-item-content');
        if (contentEl) ports.scheduleStreamPlain(contentEl, streamState.buffer);
      }
      break;
    }

    case 'response': {
      const responseTaskState = state.progressTasks.get(progressId);
      const responseOriginalConversationId = responseTaskState?.conversationId;
      const responseData = (event.data || {}) as ResponseStreamMeta;
      const mcpIds = mergeMcpExecutionIdLists(input.getMcpIds ? (input.getMcpIds() || []) : [], responseData.mcpExecutionIds || []);
      input.setMcpIds(mcpIds);
      ports.markCancelledExecutions(timeline, ports.autoCancelledIds(responseData));

      if (responseData.conversationId) {
        if (ports.conversationIsNull() && responseOriginalConversationId !== null) {
          ports.updateProgressConversation(progressId, str(responseData.conversationId));
          break;
        }
        const cid = str(responseData.conversationId);
        ports.setConversationFromStream(cid);
        ports.syncLiveConversation(cid);
        ports.updateActiveConversation();
        ports.addAttackChainButton(cid);
        ports.updateProgressConversation(progressId, cid);
        ports.loadActiveTasks();
      }

      // A placeholder of the stream is reused for the final content.
      const streamState = state.responseStreams.get(progressId);
      const existingAssistantId = streamState?.assistantId || (getAssistantId ? getAssistantId() : null);
      let assistantIdFinal = existingAssistantId;
      const responseFinalized = isFinalizedResponseData(responseData);
      const responseHasFinalizationContract = hasFinalizationContract(responseData);
      const resolvedResponseText = resolveFinalAssistantResponseText(event.message, streamState || null);
      const bubbleText = responseFinalized
        ? String(resolvedResponseText ?? '')
        : finalizationNoticeMarkdown(responseData, event.message);

      if (!assistantIdFinal) {
        assistantIdFinal = ports.addMessage('assistant', bubbleText, mcpIds, progressId);
        if (setAssistantId) setAssistantId(assistantIdFinal);
      } else {
        if (setAssistantId) setAssistantId(assistantIdFinal);
        ports.updateAssistantBubble(assistantIdFinal, bubbleText, true);
      }
      ports.markAssistantFinalization(assistantIdFinal, responseData);

      if (streamState && streamState.itemId) {
        ports.finalizeMainResponseItem(streamState, responseFinalized ? event.message : '', responseData);
      } else if (timeline && responseFinalized && bubbleText && String(bubbleText).trim() && !isEinoEmptyResponsePlaceholder(event.message)) {
        ports.addTimeline(timeline, 'planning', {
          title: einoMainStreamPlanningTitle(responseData, timelineAgentBracketPrefix(responseData), t),
          message: event.message,
          data: responseData as never,
          expanded: false,
        } as TimelineItemOptions);
      } else if (timeline && !responseFinalized && !responseHasFinalizationContract && resolvedResponseText && String(resolvedResponseText).trim()) {
        ports.addTimeline(timeline, 'finalization_check', {
          title: 'Candidate output lacks finalization proof',
          message: String(resolvedResponseText),
          data: { ...responseData, missingFinalizationContract: true } as never,
          expanded: true,
        } as TimelineItemOptions);
      }

      // The final reply hides the progress card: the process moved into the answer bubble.
      ports.hideProgressMessageForFinalReply(progressId);
      ports.finalizeOutstandingToolCalls(progressId, 'failed');

      const respMid = responseData.messageId ? str(responseData.messageId) : '';
      if (respMid) ports.applyBackendIdToAssistantDom(assistantIdFinal ?? '', respMid);

      const directReplay = ports.isDirectReplay(progressId);
      if (!directReplay) {
        // The details join the tool-call area; the full process is loaded from the server later.
        ports.integrateProgressToMCPSection(progressId, assistantIdFinal ?? '', mcpIds);
      }
      state.responseStreams.delete(progressId);

      if (respMid) {
        const reasoningAssistantId = assistantIdFinal ?? '';
        ports.setTimer(() => ports.syncReasoningFromServer(respMid, reasoningAssistantId), 400);
      }
      ports.setTimer(() => ports.collapseAllProgressDetails(assistantIdFinal, directReplay ? null : progressId), 3000);
      ports.setTimer(() => ports.loadConversations(), 200);
      break;
    }

    case 'error': {
      ports.stopElapsedClock(progressId);
      if (timeline) tl('error', { title: '❌ ' + t('chat.error'), message: event.message, data: event.data as never });
      const errorTitle = doc.querySelector<HTMLElement>(`#${progressId} .progress-stage`);
      if (errorTitle) errorTitle.textContent = '❌ ' + t('chat.executionFailed');
      const progressContainer = doc.querySelector<HTMLElement>(`#${progressId} .progress-container`);
      if (progressContainer) progressContainer.classList.add('completed');
      if (state.progressTasks.has(progressId)) ports.finalizeProgressTask(progressId, t('tasks.statusFailed'));

      const preferredMessageId = ports.resolveEventBackendMessageId(event.data) || null;
      const { assistantId, assistantElement } = upsertTerminalAssistantMessage(event.message || '', preferredMessageId);
      if (assistantId && preferredMessageId) ports.applyBackendIdToAssistantDom(assistantId, preferredMessageId);
      if (assistantElement) {
        const detailsId = 'process-details-' + assistantId;
        const terminalStatus = event.data && event.data.errorType === 'timeout' ? 'timeout' : 'failed';
        if (!doc.getElementById(detailsId)) {
          ports.integrateProgressToMCPSection(progressId, assistantId, ((input.getMcpIds ? (input.getMcpIds() || []) : []) as string[]), terminalStatus);
        } else if (preferredMessageId) {
          ports.applyTurnTiming(progressId, assistantElement, terminalStatus);
          ports.maybeReloadLazy(assistantId);
        }
        ports.setTimer(() => ports.collapseAllProgressDetails(assistantId, progressId), 100);
      }
      ports.loadActiveTasks();
      ports.finalizeOutstandingToolCalls(progressId, 'failed');
      state.mainIterations.delete(String(progressId));
      break;
    }

    case 'done': {
      if (event.data && event.data.workflowStatus === 'awaiting_hitl') {
        const waitingTitle = doc.querySelector<HTMLElement>(`#${progressId} .progress-stage`);
        if (waitingTitle) waitingTitle.textContent = '⏸️ ' + t('chat.workflowAwaitingApproval');
        if (state.progressTasks.has(progressId)) ports.finalizeProgressTask(progressId, t('chat.workflowAwaitingApproval'));
        break;
      }
      ports.stopElapsedClock(progressId);
      state.responseStreams.delete(progressId);
      state.mainIterations.delete(String(progressId));
      state.thinkingStreams.delete(progressId);
      state.einoReplyStreams.delete(progressId);
      const prefix = String(progressId) + '::';
      for (const key of Array.from(state.toolResultStreams.keys())) {
        if (String(key).startsWith(prefix)) state.toolResultStreams.delete(key);
      }
      ports.clearReplayFor(progressId);
      const doneTitle = doc.querySelector<HTMLElement>(`#${progressId} .progress-stage`);
      const outcome = progressDoneOutcome(event.data as { status?: unknown; workflowStatus?: unknown } | undefined);
      if (doneTitle) doneTitle.textContent = outcome.icon + ' ' + t(outcome.key);
      if (event.data && event.data.conversationId) {
        const cid = str(event.data.conversationId);
        ports.setConversationFromStream(cid);
        ports.syncLiveConversation(cid);
        ports.updateActiveConversation();
        ports.addAttackChainButton(cid);
        ports.updateProgressConversation(progressId, cid);
      }
      if (state.progressTasks.has(progressId)) {
        const labelKey = outcome.icon === '✅' ? 'tasks.statusCompleted' : outcome.key;
        ports.finalizeProgressTask(progressId, t(labelKey));
      }
      const hasError = !!(timeline && timeline.querySelector('.timeline-item-error'));
      ports.loadActiveTasks();
      ports.finalizeOutstandingToolCalls(progressId, outcome.toolStatus);
      ports.setTimer(() => ports.loadActiveTasks(), 200);
      ports.setTimer(() => {
        const assistantIdFromDone = getAssistantId ? getAssistantId() : null;
        ports.collapseAllProgressDetails(assistantIdFromDone, progressId);
        if (hasError) ports.setTimer(() => ports.collapseAllProgressDetails(assistantIdFromDone || null, progressId), 200);
      }, 500);
      break;
    }

    default:
      break;
  }

  ports.scrollIfPinned(streamScrollWasPinned);
}
