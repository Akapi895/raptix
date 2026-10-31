// One item of the progress timeline: the element of an event (a thinking step, a tool call or its result, a workflow step,
// an iteration divider, a warning), its title and time, its body, and the tool-call state it carries. The item is appended
// to its timeline, and the timeline is pruned when it grows too long.

import { escapeHtml } from '../../../ui/format';
import type { ToolCallView } from './tool-call-view';
import { buildWorkflowBranchDetailHtml, buildWorkflowConditionResultHtml, toolCallStatusPresentation } from './tool-calls';
import {
  getToolResultDisplayState,
  parseToolCallArgs,
  toolDisplayStatusFromState,
  type TimelineTranslate,
  type ToolResultData,
} from './tool-result';

/** The data of an event: what the server sent with it. Only the fields the item reads are named here. */
export interface TimelinePayload extends ToolResultData {
  argumentsObj?: unknown;
  arguments?: unknown;
  index?: unknown;
  total?: unknown;
  toolCallId?: unknown;
  count?: unknown;
  iteration?: unknown;
  einoScope?: unknown;
  einoAgent?: unknown;
  orchestration?: unknown;
  streamId?: unknown;
  responseStreamPlaceholder?: unknown;
  interruptId?: unknown;
  workflowRunId?: unknown;
  workflow_run_id?: unknown;
  nodeType?: unknown;
  inputSource?: unknown;
  inputPreview?: unknown;
  edgeCondition?: unknown;
  expression?: unknown;
  output?: unknown;
  matched?: unknown;
  createdAt?: unknown;
  _mergedResult?: ToolResultData;
  _mergedResultDetailId?: unknown;
  _payloadDeferred?: unknown;
  modelCalls?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  totalTokens?: unknown;
  cachedTokens?: unknown;
  cacheWriteTokens?: unknown;
  reasoningTokens?: unknown;
  reviewer?: unknown;
  decidedBy?: unknown;
  comment?: unknown;
  editedArgs?: unknown;
  editedArguments?: unknown;
  autoCancelledPendingExecutionIds?: unknown;
  autoCancelledExecutionIds?: unknown;
  agentFacing?: unknown;
  [key: string]: unknown;
}

export interface TimelineItemOptions {
  title?: string;
  message?: string;
  data?: TimelinePayload;
  iterationN?: number;
  processDetailId?: unknown;
  mergedResult?: ToolResultData | null;
  toolStatus?: string;
  createdAt?: string | number | Date | null;
  skipPendingResult?: boolean;
}

export interface TimelineItemDeps {
  doc: Document;
  t: TimelineTranslate;
  view: ToolCallView;
  timeLocale(): string;
  timeOptions(): Intl.DateTimeFormatOptions;
  /** The body of a stream step, with its wording for the event. */
  streamBody(message: string, data: TimelinePayload | undefined): string;
  /** The HTML of a plain text body, with its line breaks kept. */
  plainTextHtml(text: string): string;
  applyEinoRole(item: HTMLElement, data: TimelinePayload): void;
  pruneLive(timeline: HTMLElement): void;
}

const TERMINAL_STATUSES = new Set(['completed', 'blocked', 'failed', 'cancelled', 'canceled']);
const HITL_TYPES = new Set(['hitl_interrupt', 'hitl_audit_agent_started', 'hitl_audit_agent', 'hitl_resumed', 'hitl_rejected']);

const present = (value: unknown): boolean => value != null && String(value).trim() !== '';
const asText = (value: unknown): string => String(value).trim();

/** The status a tool call takes from its final status: the terminal one it reached, or what its merged result says. */
function forcedStatusOf(mergedKind: string | undefined, terminalStatus: string): string {
  if (mergedKind === 'blocked') return 'blocked';
  if (TERMINAL_STATUSES.has(terminalStatus)) return terminalStatus === 'canceled' ? 'cancelled' : terminalStatus;
  return '';
}

/** Adds one item of the timeline, and returns the id it was given. */
export function addTimelineItem(timeline: HTMLElement, type: string, options: TimelineItemOptions, deps: TimelineItemDeps): string {
  const { doc, t, view } = deps;
  const item = doc.createElement('div');
  const itemId = 'timeline-item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
  item.id = itemId;
  item.className = `timeline-item timeline-item-${type}`;
  if (type === 'eino_run_retry') item.classList.add('timeline-item-warning');
  // The type and the arguments are kept, so that a change of language can write the title again.
  item.dataset.timelineType = type;

  const d: TimelinePayload = options.data ?? {};
  if (type === 'iteration') {
    const n = options.iterationN != null ? options.iterationN : (options.data && options.data.iteration != null ? options.data.iteration : 1);
    item.dataset.iterationN = String(n);
    if (options.data && options.data.einoScope) item.dataset.einoScope = String(options.data.einoScope);
  }
  if (type === 'progress' && options.message) item.dataset.progressMessage = options.message;
  if (type === 'tool_calls_detected' && options.data && options.data.count != null) {
    item.dataset.toolCallsCount = String(options.data.count);
  }

  if (type === 'tool_call' && options.data) {
    if (options.processDetailId) item.dataset.processDetailId = String(options.processDetailId);
    item.dataset.toolName = present(d.toolName) ? String(d.toolName) : '';
    item.dataset.toolIndex = d.index != null ? String(d.index) : '0';
    item.dataset.toolTotal = d.total != null ? String(d.total) : '0';
    if (present(d.toolCallId)) item.dataset.toolCallId = asText(d.toolCallId);

    const merged = options.mergedResult || d._mergedResult || null;
    const mergedDisplayState = merged ? getToolResultDisplayState(merged) : null;
    const mergedBackgroundRunning = mergedDisplayState?.kind === 'background_running';
    const terminalStatus = String(options.toolStatus || '').toLowerCase();
    const forcedStatus = forcedStatusOf(mergedDisplayState?.kind, terminalStatus);
    if (merged && mergedDisplayState) {
      item.dataset.toolResultMerged = '1';
      item.dataset.toolSuccess = forcedStatus ? (forcedStatus === 'completed' ? '1' : '0') : ((!mergedDisplayState.isError && !mergedBackgroundRunning) ? '1' : '0');
      item.dataset.toolDisplayStatus = forcedStatus || toolDisplayStatusFromState(mergedDisplayState);
      if (present(merged.executionId)) item.dataset.toolExecutionId = asText(merged.executionId);
      addClass(item, toolCallStatusPresentation(item.dataset.toolDisplayStatus, t)?.itemClass);
      if (d._mergedResultDetailId) item.dataset.toolResultDetailId = String(d._mergedResultDetailId);
    } else if (TERMINAL_STATUSES.has(terminalStatus)) {
      item.dataset.toolSuccess = terminalStatus === 'completed' ? '1' : '0';
      item.dataset.toolDisplayStatus = terminalStatus === 'canceled' ? 'cancelled' : terminalStatus;
      addClass(item, toolCallStatusPresentation(terminalStatus, t)?.itemClass);
    } else if (terminalStatus === 'result_missing') {
      item.dataset.toolDisplayStatus = 'result_missing';
      item.classList.add('tool-call-incomplete');
      item.title = t('timeline.resultMissing');
    } else if (terminalStatus === 'running' || terminalStatus === 'background_running') {
      item.dataset.toolDisplayStatus = terminalStatus;
      item.classList.add('tool-call-running');
    }
  }

  if (HITL_TYPES.has(type) && options.data && present(options.data.interruptId)) {
    item.dataset.hitlInterruptId = asText(options.data.interruptId);
  }
  if (type === 'workflow_hitl_waiting' && options.data) {
    const runId = options.data.workflowRunId || options.data.workflow_run_id;
    if (present(runId)) item.dataset.workflowRunId = asText(runId);
  }

  if (type === 'tool_result' && options.data) {
    const noResultText = t('timeline.noResult');
    const result = d.result != null ? d.result : (d.error != null ? d.error : (d.resultPreview != null ? d.resultPreview : noResultText));
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const displayState = getToolResultDisplayState(d, { rawText: resultStr });
    if (options.processDetailId) item.dataset.processDetailId = String(options.processDetailId);
    item.dataset.toolName = present(d.toolName) ? String(d.toolName) : '';
    item.dataset.toolSuccess = (!displayState.isError && displayState.kind !== 'background_running') ? '1' : '0';
    item.dataset.toolDisplayStatus = toolDisplayStatusFromState(displayState);
    if (present(d.executionId)) item.dataset.toolExecutionId = asText(d.executionId);
  }

  if (type === 'eino_usage_summary' && options.data) {
    ['modelCalls', 'promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens', 'cacheWriteTokens', 'reasoningTokens'].forEach(key => {
      if (d[key] != null) item.dataset[key] = String(d[key]);
    });
  }
  if (options.data && present(options.data.einoAgent)) item.dataset.einoAgent = asText(options.data.einoAgent);
  if (options.data && present(options.data.orchestration)) item.dataset.orchestration = asText(options.data.orchestration);
  if (options.data && present(options.data.streamId)) item.dataset.responseStreamId = asText(options.data.streamId);
  if (options.data && options.data.responseStreamPlaceholder === true) item.dataset.responseStreamPlaceholder = '1';

  // The time of the event is the one the server gave, when it gave a valid one; otherwise the time now.
  let eventTime: Date;
  if (options.createdAt) {
    eventTime = options.createdAt instanceof Date ? options.createdAt : new Date(options.createdAt);
    if (isNaN(eventTime.getTime())) eventTime = new Date();
  } else {
    eventTime = new Date();
  }
  try {
    item.dataset.createdAtIso = eventTime.toISOString();
  } catch {
    // An invalid time keeps no ISO copy.
  }

  const time = eventTime.toLocaleTimeString(deps.timeLocale(), deps.timeOptions());
  let content = `
        <div class="timeline-item-header">
            <span class="timeline-item-time">${time}</span>
            <span class="timeline-item-title">${escapeHtml(options.title || '')}</span>
        </div>
    `;

  if ((type === 'thinking' || type === 'reasoning_chain' || type === 'planning') && options.message) {
    content += `<div class="timeline-item-content timeline-stream-plain">${deps.plainTextHtml(deps.streamBody(options.message, options.data))}</div>`;
  } else if (type === 'tool_call' && options.data) {
    const args = parseToolCallArgs(d);
    const merged = options.mergedResult || d._mergedResult || null;
    const mergedDisplayState = merged ? getToolResultDisplayState(merged) : null;
    const terminalStatus = String(options.toolStatus || '').toLowerCase();
    const forcedStatus = forcedStatusOf(mergedDisplayState?.kind, terminalStatus);
    const hasTerminalStatus = TERMINAL_STATUSES.has(terminalStatus);
    const hasHistoricalStatus = hasTerminalStatus || terminalStatus === 'result_missing';
    if (merged && mergedDisplayState) {
      addClass(item, toolCallStatusPresentation(forcedStatus || toolDisplayStatusFromState(mergedDisplayState), t)?.itemClass);
    } else if (hasTerminalStatus) {
      addClass(item, toolCallStatusPresentation(terminalStatus, t)?.itemClass);
    } else if (terminalStatus === 'result_missing') {
      item.classList.add('tool-call-incomplete');
    } else if (!options.skipPendingResult) {
      item.classList.add('tool-call-running');
    }
    const deferred = d._payloadDeferred === true || merged?._payloadDeferred === true;
    view.setDetailState(item, {
      args,
      resultData: (merged && forcedStatus)
        ? { ...merged, status: forcedStatus, success: forcedStatus === 'completed', isError: forcedStatus !== 'completed' }
        : (merged ?? undefined),
      pending: !merged && !hasHistoricalStatus && !options.skipPendingResult,
      processDetailId: options.processDetailId ? String(options.processDetailId) : '',
      resultDetailId: String(d._mergedResultDetailId || merged?.processDetailId || ''),
      payloadDeferred: deferred,
      payloadLoaded: !deferred,
    });
  } else if ((type === 'eino_agent_reply' || type === 'workflow_agent_output') && options.message) {
    let prefix = '';
    if (type === 'workflow_agent_output' && options.data) {
      const source = options.data.inputSource ? String(options.data.inputSource) : '';
      const preview = options.data.inputPreview ? String(options.data.inputPreview) : '';
      if (source || preview) {
        const previewText = preview.trim();
        const summaryPreview = previewText.length > 80 ? previewText.slice(0, 80) + '...' : previewText;
        prefix = `<details class="workflow-agent-input">
                    <summary>
                        <span class="workflow-agent-io-label">Input</span>
                        ${source ? `<code>${escapeHtml(source)}</code>` : ''}
                        ${summaryPreview ? `<span class="workflow-agent-input-summary">${escapeHtml(summaryPreview)}</span>` : ''}
                    </summary>
                    ${previewText ? `<pre>${escapeHtml(previewText)}</pre>` : '<div class="workflow-agent-empty">No input preview</div>'}
                </details>`;
      }
    }
    const body = type === 'workflow_agent_output'
      ? `<div class="workflow-agent-output">
                <div class="workflow-agent-io-label">Output</div>
                <div class="workflow-agent-output-body">${deps.plainTextHtml(options.message)}</div>
            </div>`
      : deps.plainTextHtml(options.message);
    content += `<div class="timeline-item-content workflow-agent-io">${prefix}${body}</div>`;
  } else if (type === 'workflow_node_result' && options.data && String(options.data.nodeType || '').toLowerCase() === 'condition') {
    content += buildWorkflowConditionResultHtml(options.data, escapeHtml);
  } else if ((type === 'workflow_branch_taken' || type === 'workflow_branch_skipped') && options.data) {
    content += buildWorkflowBranchDetailHtml(options.data, escapeHtml);
  } else if (type === 'tool_result' && options.data) {
    const noResultText = t('timeline.noResult');
    const result = d.result || d.error || d.resultPreview || noResultText;
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const displayState = getToolResultDisplayState(d, { rawText: resultStr });
    view.setDetailState(item, {
      resultData: d,
      rawText: resultStr,
      pending: false,
      hideArgs: true,
      processDetailId: options.processDetailId ? String(options.processDetailId) : '',
      resultDetailId: options.processDetailId ? String(options.processDetailId) : '',
      payloadDeferred: d._payloadDeferred === true,
      payloadLoaded: d._payloadDeferred !== true,
    });
    item.dataset.toolDisplayStatus = toolDisplayStatusFromState(displayState);
    if (present(d.executionId)) item.dataset.toolExecutionId = asText(d.executionId);
    addClass(item, toolCallStatusPresentation(toolDisplayStatusFromState(displayState), t)?.itemClass);
  } else if (type === 'cancelled') {
    const taskCancelledLabel = t('chat.taskCancelled');
    content += `
            <div class="timeline-item-content">
                ${escapeHtml(options.message || taskCancelledLabel)}
            </div>
        `;
  } else if ((type === 'warning' || type === 'eino_run_retry') && options.message) {
    content += `<div class="timeline-item-content timeline-stream-plain">${deps.plainTextHtml(deps.streamBody(options.message, options.data))}</div>`;
  } else if (type === 'eino_usage_summary' && options.message) {
    content += `<div class="timeline-item-content timeline-stream-plain timeline-usage-summary">${deps.plainTextHtml(options.message)}</div>`;
  } else if (type === 'progress' && options.message) {
    content += `<div class="timeline-item-content timeline-eino-trace"><pre class="tool-result">${escapeHtml(options.message)}</pre></div>`;
  } else if (type === 'user_interrupt_continue' && options.message) {
    content += `<div class="timeline-item-content timeline-stream-plain">${deps.plainTextHtml(deps.streamBody(options.message, options.data))}</div>`;
  }

  item.innerHTML = content;
  if (type === 'tool_call') {
    let initialToolStatus = item.dataset.toolDisplayStatus || '';
    if (!initialToolStatus && item.classList.contains('tool-call-running')) initialToolStatus = 'running';
    if (initialToolStatus) view.applyStatus(item, initialToolStatus);
  }
  if (type === 'iteration') {
    const scope = options.data && options.data.einoScope != null ? String(options.data.einoScope).trim() : '';
    // A main agent's round starts each time it re-enters the model. A sub-agent's step keeps the plain timeline style,
    // so that an expert call inside one round does not look like a new main round.
    if (scope !== 'sub') {
      item.classList.add('timeline-iteration-divider');
      item.setAttribute('role', 'separator');
      item.setAttribute('aria-label', String(options.title || ''));
    }
  }
  if (item.classList.contains('tool-detail-collapsible')) view.updateToggleLabel(item);
  if (options.data) deps.applyEinoRole(item, options.data);
  timeline.appendChild(item);
  deps.pruneLive(timeline);
  return itemId;
}

function addClass(item: HTMLElement, className: string | undefined): void {
  if (className) item.classList.add(className);
}
