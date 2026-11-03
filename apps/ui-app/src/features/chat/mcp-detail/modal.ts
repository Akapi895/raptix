// The MCP execution detail modal and the stop flow behind it. The record is fetched, decided by model.ts, and written
// into the modal; stopping asks for an optional note, sends it, and refreshes what is on screen.

import {
  executionDetailView, type ExecutionDetailView, type ExecutionRecord, type ResultTab, type ResultTabs,
} from './model';
import type { Translate } from '../messages/text';

export const DETAIL_MODAL_ID = 'mcp-detail-modal';
export const ABORT_MODAL_ID = 'mcp-tool-abort-modal';

export interface McpDetailDependencies {
  doc: Document;
  t: Translate;
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  openModal(id: string, options?: { focus?: boolean }): void;
  closeModal(id: string): void;
  /** Runs the work after the modal has opened, the way the page defers its heavy content. */
  deferContent(callback: () => void): void;
  alert(text: string): void;
  locale(): string;
  statusText(status: string): string;
  /** The normalised status of an execution, as the monitor reports it. */
  displayStatus(exec: ExecutionRecord): string;
  copyText(text: string): Promise<void>;
  setTimer(callback: () => void, ms: number): unknown;
  /** The conversation an execution belongs to, from the monitor's list; empty when unknown. */
  conversationOfExecution(executionId: string): string;
  /** Opens the page's "interrupt and continue" dialog for a conversation. */
  openInterruptDialog(conversationId: string, context: { executionId: string; refreshDetail: boolean }): void;
  /** Sends the stop request with its note, through the conversation's continue flow when there is one. */
  requestCancelWithContinue(conversationId: string, note: string, context: { executionId: string }): Promise<boolean>;
  refreshMonitor(): Promise<void>;
}

export interface McpDetailModal {
  show(executionId: string): Promise<void>;
  close(): void;
  /** Stops the execution the detail is showing. */
  abortFromDetail(): Promise<void>;
  /** Starts a stop of one execution: through the conversation dialog, or the note dialog. */
  cancel(executionId: string, options?: { refreshDetail?: boolean }): Promise<void>;
  openAbortDialog(executionId: string, options?: { refreshDetail?: boolean }): void;
  closeAbortDialog(): void;
  submitAbortDialog(): Promise<void>;
  switchResultTab(tab: string): void;
  copyActiveResult(trigger: HTMLElement | null): void;
  copyBlock(elementId: string, trigger: HTMLElement | null): void;
}

interface AbortContext {
  executionId: string;
  refreshDetail: boolean;
}

export function createMcpDetailModal(deps: McpDetailDependencies): McpDetailModal {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);
  let abortContext: AbortContext | null = null;

  function applyTabs(tabs: ResultTabs): void {
    const successTab = byId('detail-result-tab-success') as HTMLButtonElement | null;
    if (successTab) {
      successTab.disabled = !tabs.successEnabled;
      successTab.classList.toggle('disabled', !tabs.successEnabled);
    }
    switchResultTab(tabs.active);
  }

  function switchResultTab(tab: string): void {
    const active: ResultTab = tab === 'raw' ? 'raw' : 'success';
    (['success', 'raw'] as const).forEach(key => {
      const isActive = key === active;
      const tabButton = byId('detail-result-tab-' + key);
      if (tabButton) {
        tabButton.classList.toggle('active', isActive);
        tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
      const panel = byId('detail-result-panel-' + key);
      if (panel) {
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
      }
    });
  }

  function write(view: ExecutionDetailView): void {
    const setText = (id: string, text: string) => {
      const element = byId(id);
      if (element) element.textContent = text;
    };
    setText('detail-tool-name', view.toolName);
    setText('detail-execution-id', view.executionId);
    const statusEl = byId('detail-status');
    if (statusEl) {
      statusEl.textContent = view.statusText;
      statusEl.className = `status-chip status-${view.statusClass}`;
      statusEl.dataset.detailStatus = view.status;
    }
    const timeEl = byId('detail-time');
    if (timeEl) {
      const start = view.startTime ? new Date(view.startTime) : null;
      timeEl.textContent = start ? start.toLocaleString(deps.locale()) : '—';
      timeEl.dataset.detailTimeIso = start ? start.toISOString() : '';
    }
    setText('detail-request', view.request);

    const response = byId('detail-response');
    const success = byId('detail-success');
    const errorSection = byId('detail-error-section');
    const errorElement = byId('detail-error');
    if (response) {
      response.className = view.response.className;
      response.textContent = view.response.text;
    }
    if (success) {
      success.className = view.success.className;
      success.textContent = view.success.text;
    }
    if (errorSection && errorElement) {
      errorSection.style.display = view.error ? 'block' : 'none';
      errorElement.textContent = view.error ?? '';
    }
    applyTabs(view.tabs);

    const label = doc.querySelector<HTMLElement>('#detail-result-tab-success [data-i18n]');
    if (label) {
      label.dataset.i18n = view.successLabelKey;
      label.textContent = t(view.successLabelKey, view.status === 'blocked' ? 'Block reason' : 'Correct output');
    }

    const abortSection = byId('detail-abort-section');
    const abortButton = byId('detail-abort-btn') as HTMLButtonElement | null;
    if (abortSection && abortButton) {
      if (view.abort.visible) {
        abortSection.style.display = 'block';
        abortButton.dataset.execId = view.abort.executionId;
        abortButton.textContent = t('mcpDetailModal.abortBtn', 'Stop tool');
      } else {
        abortSection.style.display = 'none';
        delete abortButton.dataset.execId;
      }
    }
  }

  function texts() {
    return {
      unknown: t('mcpDetailModal.unknown', 'Unknown'),
      statusText: (status: string) => deps.statusText(status),
      blockedStatusText: deps.statusText('blocked'),
      emptySuccess: t('mcpDetailModal.execSuccessNoContent', 'Execution succeeded with no displayable content.'),
      running: t('mcpDetailModal.runningNoResponseYet', 'No output yet; the tool may still be running. If it hangs, use "Stop tool" below to end this call only.'),
      noResponse: t('chat.noResponseData', 'No response data'),
    };
  }

  function renderDetail(exec: ExecutionRecord): void {
    const status = deps.displayStatus(exec);
    write(executionDetailView(exec, status, texts()));
  }

  async function show(executionId: string): Promise<void> {
    try {
      deps.openModal(DETAIL_MODAL_ID, { focus: false });
      const response = await deps.apiFetch(`/api/monitor/execution/${executionId}`);
      const exec = await response.json() as ExecutionRecord & { error?: string };
      if (!response.ok) {
        close();
        deps.alert(t('mcpDetailModal.getDetailFailed', 'Failed to get details') + ': ' + (exec.error || t('mcpDetailModal.unknown', 'Unknown')));
        return;
      }
      deps.deferContent(() => renderDetail(exec));
    } catch (error) {
      close();
      deps.alert(t('mcpDetailModal.getDetailFailed', 'Failed to get details') + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  function close(): void {
    deps.closeModal(DETAIL_MODAL_ID);
  }

  function openAbortDialog(executionId: string, options: { refreshDetail?: boolean } = {}): void {
    abortContext = { executionId, refreshDetail: !!options.refreshDetail };
    const note = byId('mcp-tool-abort-note') as HTMLTextAreaElement | null;
    if (note) note.value = '';
    deps.openModal(ABORT_MODAL_ID);
  }

  function closeAbortDialog(): void {
    abortContext = null;
    deps.closeModal(ABORT_MODAL_ID);
  }

  async function sendCancel(executionId: string, note: string, refreshDetail: boolean): Promise<void> {
    if (!executionId) return;
    const conversationId = deps.conversationOfExecution(executionId);
    try {
      const handled = conversationId ? await deps.requestCancelWithContinue(conversationId, note, { executionId }) : false;
      if (!handled) {
        const response = await deps.apiFetch(`/api/monitor/execution/${encodeURIComponent(executionId)}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        if (!response.ok) throw new Error(body.error || body.message || response.statusText);
      }
      deps.alert(t('mcpDetailModal.abortSuccess', 'Cancellation requested; status will update when the tool returns.'));
      if (refreshDetail) await show(executionId);
      await deps.refreshMonitor();
    } catch (error) {
      deps.alert(t('mcpDetailModal.abortFailed', 'Failed to stop tool') + ': ' + (error instanceof Error && error.message ? error.message : String(error)));
    }
  }


  async function cancel(executionId: string, options: { refreshDetail?: boolean } = {}): Promise<void> {
    if (!executionId) return;
    const conversationId = deps.conversationOfExecution(executionId);
    if (conversationId) {
      deps.openInterruptDialog(conversationId, { executionId, refreshDetail: !!options.refreshDetail });
      return;
    }
    openAbortDialog(executionId, options);
  }

  async function abortFromDetail(): Promise<void> {
    const button = byId('detail-abort-btn') as HTMLButtonElement | null;
    const id = button?.dataset.execId;
    if (!id) return;
    await cancel(id, { refreshDetail: true });
  }

  async function submitAbortDialog(): Promise<void> {
    const context = abortContext;
    if (!context?.executionId) {
      closeAbortDialog();
      return;
    }
    const note = ((byId('mcp-tool-abort-note') as HTMLTextAreaElement | null)?.value ?? '').trim();
    closeAbortDialog();
    await sendCancel(context.executionId, note, context.refreshDetail);
  }

  function copyActiveResult(trigger: HTMLElement | null): void {
    const active = doc.querySelector<HTMLElement>('#mcp-detail-modal .detail-result-panel.active .code-block');
    copyBlock(active ? active.id : 'detail-response', trigger);
  }

  function copyBlock(elementId: string, trigger: HTMLElement | null): void {
    const target = byId(elementId);
    const text = target?.textContent ?? '';
    if (!target || !text.trim()) return;
    const button = trigger as HTMLButtonElement | null;
    const originalLabel = button ? (button.dataset.originalLabel || button.textContent?.trim() || '') : '';
    if (button && !button.dataset.originalLabel) button.dataset.originalLabel = originalLabel;
    const restore = () => {
      if (!button) return;
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || originalLabel || 'Copy';
    };
    deps.copyText(text).then(() => {
      if (!button) return;
      button.textContent = 'Copied';
      button.disabled = true;
      deps.setTimer(restore, 1200);
    }, () => {
      restore();
      deps.alert('Copy failed. Select the text and copy it manually.');
    });
  }

  return {
    show,
    close,
    abortFromDetail,
    cancel,
    openAbortDialog,
    closeAbortDialog,
    submitAbortDialog,
    switchResultTab,
    copyActiveResult,
    copyBlock,
  };
}
