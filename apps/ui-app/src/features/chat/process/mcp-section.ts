// The tool-call section of an assistant turn: its toolbar (the process toggle and the tool-list toggle) and the list
// of tool buttons. The ids and summaries are kept on the message element, and the list is drawn from them.

import { escapeHtml } from '../../../ui/format';
import type { Translate } from '../messages/text';
import {
  collectExecutionIdsFromProcessDetails, displayToolName, formatToolsToggleLabel, normalizeExecutionIds, normalizeToolSummaryForButton,
  selectSummariesForButtons, toolStatusLabel, type ToolSummary,
} from './mcp-calls';

export { collectExecutionIdsFromProcessDetails };

export interface McpSectionDependencies {
  doc: Document;
  t: Translate;
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  /** Opens or closes the process details of a message. */
  toggleProcessDetails(messageId: string): void;
  syncTurnSummary(element: HTMLElement): void;
  /** Opens the detail of one tool execution. */
  openExecutionDetail(executionId: string): Promise<void>;
  /** The status a summary is shown with, as the monitor reports it. */
  displayStatus(raw: unknown): string;
}

export interface McpChrome {
  mcpSection: HTMLElement;
  toolbar: HTMLElement | null;
  toolList: HTMLElement | null;
}

export interface McpSections {
  cacheExecutionIds(element: HTMLElement, ids: unknown): string[];
  cachedExecutionIds(element: HTMLElement): string[];
  cacheSummaries(element: HTMLElement, summaries: unknown): ToolSummary[];
  cachedSummaries(element: HTMLElement): ToolSummary[];
  count(element: HTMLElement | null): number;
  /** Removes the section when nothing in it is left to show. */
  pruneEmpty(element: HTMLElement): void;
  ensureChrome(element: HTMLElement | null, messageId: string): McpChrome | null;
  syncToggle(element: HTMLElement | null): void;
  toggleList(messageId: string): void;
  renderButtons(element: HTMLElement): void;
  setExecutionIds(element: HTMLElement, ids: unknown): void;
  setSummaries(element: HTMLElement, summaries: unknown): void;
  setCount(element: HTMLElement, count: unknown): void;
  setPendingExecutionIds(element: HTMLElement, ids: unknown): void;
  setPendingSummaries(element: HTMLElement, summaries: unknown): void;
  renderPending(element: HTMLElement): void;
  normalizeSummary(raw: unknown): ToolSummary;
}

function parseList(raw: string | undefined): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createMcpSections(deps: McpSectionDependencies): McpSections {
  const { doc, t } = deps;

  const pendingIdCount = (element: HTMLElement | null): number => {
    const list = parseList(element?.dataset.pendingMcpExecutionIds);
    return list ? list.length : 0;
  };

  const pendingSummaryCount = (element: HTMLElement | null): number => {
    const list = parseList(element?.dataset.pendingToolExecutionSummaries);
    return list ? list.map(normalizeToolSummaryForButton).filter(item => item.executionId).length : 0;
  };

  function count(element: HTMLElement | null): number {
    const pendingSummaries = pendingSummaryCount(element);
    if (pendingSummaries > 0) return pendingSummaries;
    const rendered = element?.querySelector('.mcp-tool-list')?.querySelectorAll('.mcp-detail-btn').length ?? 0;
    if (rendered > 0) return rendered;
    const summaryCount = parseInt(element?.dataset.mcpExecutionCount ?? '', 10) || 0;
    if (summaryCount > 0) return summaryCount;
    return pendingIdCount(element);
  }

  function existingChrome(element: HTMLElement | null): McpChrome | null {
    const mcpSection = element?.querySelector<HTMLElement>('.mcp-call-section');
    if (!mcpSection) return null;
    return {
      mcpSection,
      toolbar: mcpSection.querySelector<HTMLElement>('.mcp-call-toolbar'),
      toolList: mcpSection.querySelector<HTMLElement>('.mcp-tool-list'),
    };
  }

  function pruneEmpty(element: HTMLElement): void {
    const chrome = existingChrome(element);
    if (!chrome) return;
    const hasDetails = !!chrome.mcpSection.querySelector('.process-details-container');
    const hasProcessDetailButton = !!chrome.toolbar?.querySelector('.process-detail-btn');
    const hasToolButtons = !!chrome.toolList?.querySelector('.mcp-detail-btn');
    const hasPending = pendingIdCount(element) > 0 || pendingSummaryCount(element) > 0 || count(element) > 0;
    if (!hasDetails && !hasProcessDetailButton && !hasToolButtons && !hasPending) chrome.mcpSection.remove();
  }

  function cacheExecutionIds(element: HTMLElement, ids: unknown): string[] {
    if (!element?.dataset) return [];
    const normalized = normalizeExecutionIds(ids);
    if (normalized.length > 0) element.dataset.mcpExecutionIds = JSON.stringify(normalized);
    else delete element.dataset.mcpExecutionIds;
    return normalized;
  }

  function cachedExecutionIds(element: HTMLElement): string[] {
    const raw = element?.dataset?.mcpExecutionIds;
    if (!raw) return [];
    try {
      return normalizeExecutionIds(JSON.parse(raw));
    } catch {
      delete element.dataset.mcpExecutionIds;
      return [];
    }
  }

  function cacheSummaries(element: HTMLElement, summaries: unknown): ToolSummary[] {
    if (!element?.dataset || !Array.isArray(summaries)) return [];
    const normalized = summaries.map(normalizeToolSummaryForButton).filter(item => item.executionId);
    if (normalized.length > 0) element.dataset.toolExecutionSummaries = JSON.stringify(normalized);
    else delete element.dataset.toolExecutionSummaries;
    return normalized;
  }

  function cachedSummaries(element: HTMLElement): ToolSummary[] {
    const raw = element?.dataset?.toolExecutionSummaries;
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeToolSummaryForButton) : [];
    } catch {
      delete element.dataset.toolExecutionSummaries;
      return [];
    }
  }

  function syncToggle(element: HTMLElement | null): void {
    if (!element) return;
    const total = count(element);
    let chrome = existingChrome(element);
    if (!chrome || (total > 0 && (!chrome.toolbar || !chrome.toolList))) {
      if (total <= 0) return;
      chrome = ensureChrome(element, element.id);
    }
    if (!chrome?.toolbar || !chrome.toolList) return;
    const { toolbar, toolList } = chrome;
    let toggle = toolbar.querySelector<HTMLButtonElement>('.mcp-tools-toggle-btn');
    if (total <= 0) {
      toggle?.remove();
      pruneEmpty(element);
      return;
    }
    if (!toggle) {
      toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mcp-detail-btn mcp-tools-toggle-btn';
      toggle.onclick = event => {
        event.stopPropagation();
        toggleList(element.id);
      };
      toolbar.appendChild(toggle);
    }
    toggle.innerHTML = '<span>' + formatToolsToggleLabel(total, toolList.classList.contains('expanded'), t) + '</span>';
  }

  function ensureChrome(element: HTMLElement | null, messageId: string): McpChrome | null {
    const contentWrapper = element?.querySelector<HTMLElement>('.message-content');
    if (!element || !contentWrapper) return null;

    let mcpSection = element.querySelector<HTMLElement>('.mcp-call-section');
    if (!mcpSection) {
      mcpSection = doc.createElement('div');
      mcpSection.className = 'mcp-call-section';
      const label = doc.createElement('button');
      label.type = 'button';
      label.className = 'mcp-call-label turn-process-summary';
      label.onclick = event => {
        event.stopPropagation();
        deps.toggleProcessDetails(messageId || element.id);
      };
      mcpSection.appendChild(label);
      const resultBubble = contentWrapper.querySelector<HTMLElement>(':scope > .message-bubble');
      contentWrapper.insertBefore(mcpSection, resultBubble || contentWrapper.firstChild);
    } else if (mcpSection.parentNode === contentWrapper) {
      const resultBubble = contentWrapper.querySelector<HTMLElement>(':scope > .message-bubble');
      if (resultBubble && mcpSection.nextSibling !== resultBubble) contentWrapper.insertBefore(mcpSection, resultBubble);
    }

    element.classList.add('assistant-turn-with-process');
    contentWrapper.querySelector<HTMLElement>(':scope > .message-bubble')?.classList.add('assistant-final-result');

    let toolbar = mcpSection.querySelector<HTMLElement>('.mcp-call-toolbar');
    if (!toolbar) {
      toolbar = doc.createElement('div');
      toolbar.className = 'mcp-call-toolbar';
      mcpSection.appendChild(toolbar);
    }

    let toolList = mcpSection.querySelector<HTMLElement>('.mcp-tool-list');
    if (!toolList) {
      toolList = doc.createElement('div');
      toolList.className = 'mcp-tool-list';
      const details = mcpSection.querySelector('.process-details-container');
      if (details) mcpSection.insertBefore(toolList, details);
      else toolbar.after(toolList);
    }

    const clientId = messageId || element.id;
    if (clientId && !toolbar.querySelector('.process-detail-btn')) {
      const processButton = doc.createElement('button');
      processButton.className = 'mcp-detail-btn process-detail-btn';
      processButton.innerHTML = '<span>' + t('chat.expandDetail', 'Expand details') + '</span>';
      processButton.onclick = () => deps.toggleProcessDetails(clientId);
      toolbar.appendChild(processButton);
    }

    deps.syncTurnSummary(element);
    return { mcpSection, toolbar, toolList };
  }

  function toggleList(messageId: string): void {
    const element = doc.getElementById(messageId);
    if (!element) return;
    const chrome = ensureChrome(element, messageId);
    if (!chrome?.toolList) return;
    const { toolList } = chrome;
    if (!pendingIdCount(element) && !pendingSummaryCount(element) && !toolList.querySelector('.mcp-detail-btn')) {
      syncToggle(element);
      return;
    }
    if (!toolList.classList.contains('expanded')) {
      renderPending(element);
      toolList.classList.add('expanded');
    } else {
      toolList.classList.remove('expanded');
    }
    syncToggle(element);
  }

  function normalizeSummary(raw: unknown): ToolSummary {
    if (typeof raw === 'string') return { toolName: raw, status: '', executionId: '', toolCallId: '', processDetailId: '', resultDetailId: '' };
    const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!data) return { toolName: '', status: '', executionId: '', toolCallId: '', processDetailId: '', resultDetailId: '' };
    return { ...normalizeToolSummaryForButton(data), toolName: String(data.toolName || data.name || ''), status: deps.displayStatus(data) };
  }

  function renderButtons(element: HTMLElement): void {
    const chrome = ensureChrome(element, element.id);
    if (!chrome?.toolList) return;
    const toolList = chrome.toolList;
    const executionIds = cachedExecutionIds(element);
    const summaries = cachedSummaries(element);
    const items = selectSummariesForButtons(summaries, executionIds).filter(item => item.executionId);

    const version = String((parseInt(toolList.dataset.renderVersion ?? '', 10) || 0) + 1);
    toolList.dataset.renderVersion = version;
    const fragment = doc.createDocumentFragment();
    items.forEach((item, index) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'mcp-detail-btn';
      button.dataset.execIndex = String(index + 1);
      button.dataset.execId = item.executionId;
      if (item.toolCallId) button.dataset.toolCallId = item.toolCallId;
      button.onclick = () => { void deps.openExecutionDetail(item.executionId); };
      if (item.toolName) {
        setToolButtonContent(button, item.toolName, String(index + 1), item.status);
      } else {
        button.innerHTML = '<span>' + t('chat.callNumber', 'Call #{{n}}' + (index + 1), { n: index + 1 }) + '</span>';
      }
      fragment.appendChild(button);
    });
    toolList.replaceChildren(fragment);

    if (summaries.length === 0 && executionIds.length > 0) void updateNamesInBatch(toolList, executionIds, version);
    syncToggle(element);
  }

  function setToolButtonContent(button: HTMLElement, toolName: string, index: string, status: string): void {
    const safeName = escapeHtml(toolName || t('chat.unknownTool', 'Unknown tool'));
    const safeIndex = escapeHtml(index || '');
    const statusText = toolStatusLabel(status, t);
    const normalizedStatus = String(status || '').toLowerCase();
    button.innerHTML = '<span class="mcp-tool-name">' + (safeIndex ? `${safeName} #${safeIndex}` : safeName) + '</span>';
    if (!statusText) {
      button.removeAttribute('data-status');
      button.removeAttribute('title');
      return;
    }
    button.dataset.status = normalizedStatus;
    button.title = statusText;
  }

  /** One request names every tool of the list; a response that arrives after a newer render is dropped. */
  async function updateNamesInBatch(list: HTMLElement, executionIds: string[], version: string): Promise<void> {
    if (!executionIds.length) return;
    try {
      const response = await deps.apiFetch('/api/monitor/executions/names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: executionIds }),
      });
      if (!response.ok) return;
      const names = await response.json() as Record<string, unknown>;
      if (version && list.dataset.renderVersion !== version) return;
      list.querySelectorAll<HTMLElement>('.mcp-detail-btn[data-exec-id]').forEach(button => {
        const summary = normalizeSummary(names[button.dataset.execId ?? '']);
        if (summary.toolName) setToolButtonContent(button, displayToolName(summary.toolName), button.dataset.execIndex ?? '', summary.status);
      });
    } catch (error) {
      console.error('Failed to batch-load tool names:', error);
    }
  }

  function renderPending(element: HTMLElement): void {
    if (!element?.dataset) return;
    if (element.dataset.pendingToolExecutionSummaries) {
      const summaries = parseList(element.dataset.pendingToolExecutionSummaries) ?? [];
      delete element.dataset.pendingToolExecutionSummaries;
      if (summaries.length > 0) {
        setSummaries(element, summaries);
        return;
      }
    }
    if (element.dataset.pendingMcpExecutionIds) {
      const ids = parseList(element.dataset.pendingMcpExecutionIds) ?? [];
      delete element.dataset.pendingMcpExecutionIds;
      if (ids.length > 0) setExecutionIds(element, ids);
    }
  }

  function setExecutionIds(element: HTMLElement, ids: unknown): void {
    if (!element || !Array.isArray(ids)) return;
    cacheExecutionIds(element, ids);
    renderButtons(element);
  }

  function setSummaries(element: HTMLElement, summaries: unknown): void {
    if (!element || !Array.isArray(summaries)) return;
    cacheSummaries(element, summaries);
    renderButtons(element);
  }

  function setPendingExecutionIds(element: HTMLElement, ids: unknown): void {
    if (!element?.dataset || !Array.isArray(ids)) return;
    const normalized = cacheExecutionIds(element, ids);
    if (normalized.length > 0) element.dataset.pendingMcpExecutionIds = JSON.stringify(normalized);
    else delete element.dataset.pendingMcpExecutionIds;
    const list = element.querySelector('.mcp-tool-list');
    if (normalized.length > 0 && list?.querySelector('.mcp-detail-btn')) renderButtons(element);
    syncToggle(element);
  }

  function setPendingSummaries(element: HTMLElement, summaries: unknown): void {
    if (!element?.dataset || !Array.isArray(summaries)) return;
    const normalized = cacheSummaries(element, summaries);
    if (normalized.length > 0) element.dataset.pendingToolExecutionSummaries = JSON.stringify(normalized);
    else delete element.dataset.pendingToolExecutionSummaries;
    const list = element.querySelector('.mcp-tool-list');
    if (normalized.length > 0 && list?.querySelector('.mcp-detail-btn')) {
      setSummaries(element, normalized);
      delete element.dataset.pendingToolExecutionSummaries;
    }
    syncToggle(element);
  }

  function setCount(element: HTMLElement, value: unknown): void {
    if (!element?.dataset) return;
    const n = parseInt(String(value), 10) || 0;
    if (n > 0) element.dataset.mcpExecutionCount = String(n);
    else delete element.dataset.mcpExecutionCount;
    syncToggle(element);
  }

  return {
    cacheExecutionIds,
    cachedExecutionIds,
    cacheSummaries,
    cachedSummaries,
    count,
    pruneEmpty,
    ensureChrome,
    syncToggle,
    toggleList,
    renderButtons,
    setExecutionIds,
    setSummaries,
    setCount,
    setPendingExecutionIds,
    setPendingSummaries,
    renderPending,
    normalizeSummary,
  };
}
