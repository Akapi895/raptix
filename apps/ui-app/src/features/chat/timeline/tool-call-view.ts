// The screen side of the tool calls on the timeline: a call's detail (its arguments and its result), the merge of a result
// into its call, and the status a call shows. Each call keeps its detail state by element id; the page's fetches, its
// stream paint and its call mapping come in through `deps`.

import { escapeHtml } from '../../../ui/format';
import { normalizeExecutionIdList, toolCallStatusPresentation } from './tool-calls';
import {
  formatToolCallTitle,
  getToolResultDisplayState,
  parseToolCallArgs,
  toolCallArgsEmpty,
  toolDisplayStatusFromState,
  type TimelineTranslate,
  type ToolResultData,
} from './tool-result';

export interface ToolCallDetailState {
  args?: Record<string, unknown>;
  argsEditedByHitl?: boolean;
  hideArgs?: boolean;
  payloadDeferred?: boolean;
  payloadLoaded?: boolean;
  processDetailId?: string;
  resultDetailId?: string;
  resultData?: ToolResultData;
  rawText?: string;
  pending?: boolean;
  /** The approval of the call, as the server sent it and as the decision left it. */
  hitlData?: { interruptId?: unknown; resolved?: unknown; [key: string]: unknown };
  originalArgs?: Record<string, unknown>;
}

export interface ToolResultHtmlOptions {
  pending?: boolean;
  pendingText?: string;
  rawText?: unknown;
}

export interface ToolCallMapping {
  itemId?: string;
  timeline?: HTMLElement | null;
}

export interface ToolCallViewDeps {
  doc: Document;
  t: TimelineTranslate;
  /** The data of a process detail, as the server keeps it, or null when it has none. */
  fetchProcessDetailData(detailId: string): Promise<Record<string, unknown> | null>;
  flushPlainText(element: HTMLElement): void;
  resetPlainText(element: HTMLElement): void;
  /** Where a call of a progress is on the screen. */
  mappingFor(progressId: string, toolCallId: string): ToolCallMapping | null;
}

const CLASSES_BY_STATUS = ['tool-call-running', 'tool-call-completed', 'tool-call-failed', 'tool-call-blocked'];

/** The section that shows a result: its label, its text, and its execution id when it has one. */
export function buildToolResultSectionHtml(data: ToolResultData, opts: ToolResultHtmlOptions, t: TimelineTranslate): string {
  const execResultLabel = t('timeline.executionResult');
  const execIdLabel = t('timeline.executionId');
  const waitingLabel = opts.pendingText || t('timeline.running');
  if (opts.pending) {
    return (
      '<div class="tool-result-section pending">' +
      '<strong data-i18n="timeline.executionResult">' + escapeHtml(execResultLabel) + '</strong>' +
      '<pre class="tool-result tool-result-pending">' + escapeHtml(waitingLabel) + '</pre>' +
      '</div>'
    );
  }
  const noResultText = t('timeline.noResult');
  const result = data.result != null ? data.result : (data.error != null ? data.error : (data.resultPreview != null ? data.resultPreview : noResultText));
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  const rawText = opts.rawText != null ? String(opts.rawText) : resultStr;
  const displayState = getToolResultDisplayState(data, { rawText });
  const sectionClass = displayState.kind === 'blocked' ? 'blocked' : (displayState.kind === 'background_running' ? 'pending' : (displayState.isError ? 'error' : 'success'));
  return (
    '<div class="tool-result-section ' + sectionClass + '">' +
    '<strong data-i18n="timeline.executionResult">' + escapeHtml(execResultLabel) + '</strong>' +
    '<pre class="tool-result">' + escapeHtml(rawText) + '</pre>' +
    (data.executionId ? '<div class="tool-execution-id"><span data-i18n="timeline.executionId">' +
      escapeHtml(execIdLabel) + '</span> <code>' + escapeHtml(String(data.executionId)) + '</code></div>' : '') +
    '</div>'
  );
}

/** The element of a call in a root, found by its tool call id. */
export function findToolCallItemById(root: ParentNode | null | undefined, toolCallId: unknown): HTMLElement | null {
  if (!root || !toolCallId) return null;
  const id = String(toolCallId).trim();
  if (!id) return null;
  try {
    return root.querySelector<HTMLElement>('[data-tool-call-id="' + CSS.escape(id) + '"]');
  } catch {
    return root.querySelector<HTMLElement>('[data-tool-call-id="' + id.replace(/"/g, '\\"') + '"]');
  }
}

export function createToolCallView(deps: ToolCallViewDeps) {
  const { doc, t } = deps;
  const details = new Map<string, ToolCallDetailState>();

  const detailsOf = (item: HTMLElement): ToolCallDetailState => details.get(item.id) ?? {};

  function toggleText(expanded: boolean): string {
    return expanded ? t('chat.collapseToolDetail') : t('chat.viewToolDetail');
  }

  function updateToggleLabel(item: HTMLElement | null | undefined): void {
    if (!item) return;
    const header = item.querySelector<HTMLElement>('.timeline-item-header');
    if (!header) return;
    const expanded = item.classList.contains('tool-call-detail-expanded');
    header.setAttribute('data-tool-detail-label', toggleText(expanded) + (expanded ? ' ▴' : ' ▾'));
  }

  function getDetailState(item: HTMLElement | null | undefined): ToolCallDetailState {
    if (!item || !item.id) return {};
    return { ...(details.get(item.id) ?? {}) };
  }

  function setDetailState(item: HTMLElement | null | undefined, state: ToolCallDetailState | null | undefined): void {
    if (!item || !item.id) return;
    details.set(item.id, { ...(state ?? {}) });
    item.classList.add('tool-detail-collapsible');
    item.classList.add('tool-call-collapsible');
    updateToggleLabel(item);
  }

  /** Closes the detail of the other calls of the same timeline, so that one call is open at a time. */
  function collapseOthers(item: HTMLElement): void {
    const timeline = item.closest<HTMLElement>('.progress-timeline');
    if (!timeline) return;
    timeline.querySelectorAll<HTMLElement>('.timeline-item.tool-detail-collapsible.tool-call-detail-expanded').forEach(other => {
      if (other === item) return;
      other.classList.remove('tool-call-detail-expanded');
      other.querySelector('.timeline-item-content.tool-call-detail-content')?.remove();
      updateToggleLabel(other);
    });
  }

  /** Opens or closes the detail of a call. A detail whose data is still on the server is fetched first. */
  async function renderDetailContent(item: HTMLElement): Promise<void> {
    if (!item || !item.id) return;
    const state = detailsOf(item);
    collapseOthers(item);

    let content = item.querySelector<HTMLElement>('.timeline-item-content.tool-call-detail-content');
    if (content) {
      content.remove();
      item.classList.remove('tool-call-detail-expanded');
      updateToggleLabel(item);
      return;
    }

    content = doc.createElement('div');
    content.className = 'timeline-item-content tool-call-detail-content';
    if (state.payloadDeferred && !state.payloadLoaded && (state.processDetailId || state.resultDetailId)) {
      content.innerHTML = '<div class="progress-timeline-empty">' + escapeHtml(t('common.loading')) + '</div>';
      item.appendChild(content);
      item.classList.add('tool-call-detail-expanded');
      updateToggleLabel(item);
      try {
        if (state.processDetailId && !state.hideArgs) {
          const fullCall = await deps.fetchProcessDetailData(state.processDetailId);
          if (fullCall) {
            state.args = parseToolCallArgs(fullCall);
            state.payloadDeferred = false;
          }
        }
        if (state.resultDetailId) {
          const fullResult = await deps.fetchProcessDetailData(state.resultDetailId);
          if (fullResult) {
            state.resultData = fullResult as ToolResultData;
            const noResultText = t('timeline.noResult');
            const result = fullResult.result != null ? fullResult.result : (fullResult.error != null ? fullResult.error : noResultText);
            state.rawText = typeof result === 'string' ? result : JSON.stringify(result);
          }
        }
        state.payloadLoaded = true;
        setDetailState(item, state);
        content.remove();
        item.classList.remove('tool-call-detail-expanded');
        void renderDetailContent(item);
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : 'Load failed';
        content.innerHTML = '<div class="progress-timeline-empty">' + escapeHtml(message) + '</div>';
      }
      return;
    }

    const args = state.args ?? {};
    let resultBlock = '';
    if (state.resultData) {
      resultBlock = '<div class="tool-details tool-result-slot">' +
        buildToolResultSectionHtml(state.resultData, { rawText: state.rawText }, t) +
        '</div>';
    } else if (state.pending !== false) {
      let pendingOpts: ToolResultHtmlOptions = { pending: true };
      if (state.hitlData?.interruptId) {
        pendingOpts = {
          pending: true,
          pendingText: state.hitlData.resolved ? 'Approved; waiting for the execution result' : 'Awaiting approval; runs once approved',
        };
      }
      resultBlock = '<div class="tool-details tool-result-slot">' +
        buildToolResultSectionHtml({}, pendingOpts, t) +
        '</div>';
    }

    const paramsLabel = t('timeline.params');
    const hitlEditedArgsLabel = state.argsEditedByHitl ? '<span class="tool-args-hitl-edited">Executed with HITL-adjusted arguments</span>' : '';
    const argsBlock = state.hideArgs ? '' :
      '<div class="tool-arg-section">' +
      '<strong data-i18n="timeline.params">' + escapeHtml(paramsLabel) + '</strong>' +
      hitlEditedArgsLabel +
      '<pre class="tool-args">' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' +
      '</div>';
    content.innerHTML = '<div class="tool-details">' + argsBlock + resultBlock + '</div>';
    item.appendChild(content);
    item.classList.add('tool-call-detail-expanded');
    updateToggleLabel(item);
  }

  /** The result section of a call: the one it has, or a pending one added to the detail when the call is open. */
  function ensureResultSlot(item: HTMLElement | null | undefined): HTMLElement | null {
    if (!item) return null;
    if (item.classList.contains('tool-call-collapsible')) {
      const state = detailsOf(item);
      state.pending = true;
      setDetailState(item, state);
      if (!item.classList.contains('tool-call-detail-expanded')) return null;
    }
    const section = item.querySelector<HTMLElement>('.tool-result-section');
    if (section) return section;
    const content = item.querySelector<HTMLElement>('.timeline-item-content');
    if (!content) return null;
    const wrap = doc.createElement('div');
    wrap.className = 'tool-details tool-result-slot';
    wrap.innerHTML = buildToolResultSectionHtml({}, { pending: true }, t);
    content.appendChild(wrap);
    return wrap.querySelector<HTMLElement>('.tool-result-section');
  }

  /** Puts a result into its call: into the call's detail when the call is collapsible, else into its result section. */
  function mergeResult(item: HTMLElement | null | undefined, data: ToolResultData | null | undefined, options: { rawText?: unknown } = {}): boolean {
    if (!item || !data) return false;
    const noResultText = t('timeline.noResult');
    const result = data.result != null ? data.result : (data.error != null ? data.error : (data.resultPreview != null ? data.resultPreview : noResultText));
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const text = options.rawText != null ? String(options.rawText) : resultStr;
    const displayState = getToolResultDisplayState(data, { rawText: text });
    const backgroundRunning = displayState.kind === 'background_running';

    const markItem = () => {
      item.dataset.toolResultMerged = '1';
      item.dataset.toolSuccess = (!displayState.isError && !backgroundRunning) ? '1' : '0';
      item.dataset.toolDisplayStatus = toolDisplayStatusFromState(displayState);
      if (data.executionId != null && String(data.executionId).trim() !== '') {
        item.dataset.toolExecutionId = String(data.executionId).trim();
      }
      item.classList.remove(...CLASSES_BY_STATUS);
      const itemClass = toolCallStatusPresentation(toolDisplayStatusFromState(displayState), t)?.itemClass;
      if (itemClass) item.classList.add(itemClass);
      applyStatus(item, item.dataset.toolDisplayStatus);
    };

    if (item.classList.contains('tool-call-collapsible')) {
      const state = detailsOf(item);
      const resultArgs = parseToolCallArgs(data as Record<string, unknown>);
      if (toolCallArgsEmpty(state.args) && !toolCallArgsEmpty(resultArgs)) state.args = resultArgs;
      state.resultData = data;
      state.rawText = text;
      state.resultDetailId = String(data.processDetailId || state.resultDetailId || '');
      state.pending = false;
      state.payloadDeferred = data._payloadDeferred === true;
      state.payloadLoaded = data._payloadDeferred !== true;
      setDetailState(item, state);
      const expanded = item.classList.contains('tool-call-detail-expanded');
      item.querySelector('.timeline-item-content.tool-call-detail-content')?.remove();
      if (expanded) {
        item.classList.remove('tool-call-detail-expanded');
        void renderDetailContent(item);
      }
      markItem();
      return true;
    }

    let section = item.querySelector<HTMLElement>('.tool-result-section');
    if (!section) {
      ensureResultSlot(item);
      section = item.querySelector<HTMLElement>('.tool-result-section');
    }
    if (!section) return false;

    section.className = 'tool-result-section ' + (displayState.kind === 'blocked' ? 'blocked' : (backgroundRunning ? 'pending' : (displayState.isError ? 'error' : 'success')));
    const pre = section.querySelector<HTMLElement>('pre.tool-result');
    if (pre) {
      pre.classList.remove('tool-result-pending');
      deps.flushPlainText(pre);
      pre.textContent = text;
      deps.resetPlainText(pre);
    }

    if (data.executionId) {
      let execIdEl = section.querySelector<HTMLElement>('.tool-execution-id');
      if (!execIdEl) {
        execIdEl = doc.createElement('div');
        execIdEl.className = 'tool-execution-id';
        execIdEl.innerHTML = '<span data-i18n="timeline.executionId">' + escapeHtml(t('timeline.executionId')) + '</span> <code></code>';
        section.appendChild(execIdEl);
      }
      const code = execIdEl.querySelector('code');
      if (code) code.textContent = String(data.executionId);
    }

    markItem();
    return true;
  }

  /** The status of a call on its title: the badge, and the classes the call takes from it. */
  function applyStatus(item: HTMLElement | null | undefined, status: unknown): void {
    if (!item) return;
    const presentation = toolCallStatusPresentation(status, t);
    const titleElement = item.querySelector<HTMLElement>('.timeline-item-title');
    if (!titleElement) return;

    item.classList.remove('tool-call-running', 'tool-call-completed', 'tool-call-failed', 'tool-call-blocked', 'tool-call-incomplete');
    titleElement.querySelector('.tool-status-badge')?.remove();
    if (!presentation) {
      delete item.dataset.toolDisplayStatus;
      return;
    }

    item.dataset.toolDisplayStatus = presentation.status;
    item.classList.add(presentation.itemClass);
    const badge = doc.createElement('span');
    badge.className = 'tool-status-badge ' + presentation.badgeClass;
    badge.textContent = presentation.icon + presentation.label;
    titleElement.appendChild(badge);
  }

  function updateStatus(progressId: string, toolCallId: string, status: unknown): void {
    const mapping = deps.mappingFor(progressId, toolCallId);
    if (!mapping) return;
    const item = mapping.itemId ? doc.getElementById(mapping.itemId) : null;
    if (!item) return;
    applyStatus(item, status);
  }

  /** Finds the call a result belongs to, through the mapping of the progress, the timeline, and the progress itself. */
  function attachResult(progressId: string, toolCallId: string, data: ToolResultData | null | undefined, options: { rawText?: unknown } = {}): boolean {
    if (!toolCallId || !data) return false;
    const mapping = deps.mappingFor(progressId, toolCallId);
    let item: HTMLElement | null = null;
    if (mapping?.itemId) item = doc.getElementById(mapping.itemId);
    if (!item && mapping?.timeline) item = findToolCallItemById(mapping.timeline, toolCallId);
    if (!item && progressId) {
      const progressRoot = doc.getElementById(String(progressId));
      if (progressRoot) item = findToolCallItemById(progressRoot, toolCallId);
    }
    if (!item) return false;
    mergeResult(item, data, options);
    return true;
  }

  /** Marks the calls whose executions were cancelled: their status, their result, and their badge. */
  function markCancelled(root: ParentNode | null | undefined, executionIds: unknown): number {
    const ids = normalizeExecutionIdList(executionIds);
    if (!root || ids.length === 0) return 0;
    const idSet = new Set(ids);
    let count = 0;
    root.querySelectorAll<HTMLElement>('.timeline-item[data-tool-execution-id]').forEach(item => {
      const execId = String(item.dataset.toolExecutionId || '').trim();
      if (!execId || !idSet.has(execId)) return;
      item.dataset.toolSuccess = '0';
      item.dataset.toolDisplayStatus = 'cancelled';
      item.classList.remove('tool-call-running', 'tool-call-completed', 'tool-call-incomplete');
      item.classList.add('tool-call-failed');
      const state = details.get(item.id);
      if (state && state.resultData && typeof state.resultData === 'object') {
        state.resultData = { ...state.resultData, status: 'cancelled', success: false, isError: true };
        state.pending = false;
        setDetailState(item, state);
      }
      applyStatus(item, 'cancelled');
      count++;
    });
    return count;
  }

  /** A click on a call opens or closes its detail, unless the click was on a control or on the detail itself. */
  function onDocumentClick(event: Event): void {
    const target = event.target as Element | null;
    if (target?.closest && target.closest('button, a, input, textarea, select, pre, code, .timeline-item-content')) return;
    const item = target?.closest ? target.closest<HTMLElement>('.timeline-item.tool-detail-collapsible') : null;
    if (!item) return;
    void renderDetailContent(item);
  }

  return {
    getDetailState,
    setDetailState,
    updateToggleLabel,
    renderDetailContent,
    ensureResultSlot,
    mergeResult,
    applyStatus,
    updateStatus,
    attachResult,
    markCancelled,
    onDocumentClick,
    formatTitle: (toolName: unknown, index: number, total: number) => formatToolCallTitle(toolName, index, total, t),
  };
}

export type ToolCallView = ReturnType<typeof createToolCallView>;
