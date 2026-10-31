// The approvals of a workflow run: the card under the workflow step that waits, the decision it sends to the run, and the
// restore of those cards when the conversation is opened again. The run's pending approval is read from the server.

import { escapeHtml } from '../../../ui/format';
import { escapeAttrSelector } from './view';

export interface WorkflowRunRecord {
  id?: unknown;
  workflowRunId?: unknown;
  workflow_run_id?: unknown;
  pending_hitl_json?: unknown;
  pendingHitlJson?: unknown;
  pendingHitlJSON?: unknown;
  pending_hitl_node_id?: unknown;
  pendingHitlNodeId?: unknown;
  conversation_id?: unknown;
  conversationId?: unknown;
  [key: string]: unknown;
}

export interface WorkflowHitlData {
  workflowRunId: string;
  nodeId: string;
  label: string;
  prompt: string;
  conversationId: string;
}

export interface WorkflowHitlDeps {
  doc: Document;
  request(path: string, init?: RequestInit): Promise<Response>;
  currentConversationId(): string;
  setTaskAvailability(panel: HTMLElement, conversationId: string): void;
  addTimelineItem(timeline: HTMLElement, type: string, options: { title: string; message: string; data: WorkflowHitlData }): string;
  /** Fills a message's process details from the server, when they are not loaded yet. */
  loadProcessDetails(clientMessageId: string, backendMessageId: string): Promise<void>;
  expandProcessDetails(clientMessageId: string): void;
  logError(message: string, error: unknown): void;
}

/** The pending approval of a run, as the server keeps it: an object, or its JSON text. */
export function parseWorkflowHitlPendingJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const o = JSON.parse(String(raw)) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The approval a run waits for, or null when the run has no id. */
export function workflowHitlDataFromRun(run: WorkflowRunRecord | null | undefined): WorkflowHitlData | null {
  if (!run) return null;
  const runId = run.id || run.workflowRunId || run.workflow_run_id;
  if (!runId) return null;
  const pending = parseWorkflowHitlPendingJson(run.pending_hitl_json || run.pendingHitlJson || run.pendingHitlJSON);
  const nested = pending.pendingHitl && typeof pending.pendingHitl === 'object' ? (pending.pendingHitl as Record<string, unknown>) : pending;
  const nodeFallback = run.pending_hitl_node_id || run.pendingHitlNodeId || '';
  return {
    workflowRunId: String(runId),
    nodeId: String(nested.nodeId || nodeFallback || ''),
    label: String(nested.label || nested.nodeId || nodeFallback || runId),
    prompt: String(nested.prompt || ''),
    conversationId: String(run.conversation_id || run.conversationId || ''),
  };
}

/** The timeline item of a run's approval: the one that names the run, else the newest one that is not yet decided. */
export function findWorkflowHitlTimelineItem(container: HTMLElement | null | undefined, runId: unknown): HTMLElement | null {
  if (!container || !runId) return null;
  const rid = String(runId).trim();
  const byRun = container.querySelector<HTMLElement>('[data-workflow-run-id="' + escapeAttrSelector(rid) + '"]');
  if (byRun) return byRun;
  const items = container.querySelectorAll<HTMLElement>('.timeline-item-workflow_hitl_waiting');
  for (let i = items.length - 1; i >= 0; i--) {
    const el = items[i];
    if (el && !el.querySelector('.workflow-hitl-inline-approval.hitl-inline-done')) return el;
  }
  return items.length ? items[items.length - 1] ?? null : null;
}

/** Puts the approval card under a workflow step, and sends the run's decision when a button is pressed. */
export function renderWorkflowApproval(deps: WorkflowHitlDeps, itemId: string, data: WorkflowHitlData | null | undefined): void {
  const item = deps.doc.getElementById(itemId);
  if (!item || !data) return;
  // The live event carries the run id under its snake_case name; a restored run carries the camel-case one.
  const runId = data.workflowRunId || (data as { workflow_run_id?: unknown }).workflow_run_id;
  if (!runId) return;
  let contentEl = item.querySelector<HTMLElement>('.timeline-item-content');
  if (!contentEl) {
    contentEl = deps.doc.createElement('div');
    contentEl.className = 'timeline-item-content';
    item.appendChild(contentEl);
  }
  contentEl.querySelector('.workflow-hitl-inline-approval')?.remove();

  const label = data.label || data.nodeId || runId;
  const prompt = data.prompt || '';
  const panel = deps.doc.createElement('div');
  panel.className = 'workflow-hitl-inline-approval hitl-inline-approval';
  panel.dataset.conversationId = String(data.conversationId || deps.currentConversationId() || '').trim();
  panel.innerHTML = `
        <div class="hitl-inline-header">
            <div class="hitl-inline-title">
                <span class="hitl-inline-icon" aria-hidden="true">!</span>
                <span>Workflow approval</span>
            </div>
            <div class="hitl-inline-badges">
                <span class="hitl-tool-badge">${escapeHtml(label)}</span>
                <span class="hitl-mode-tag hitl-mode-tag--approval">Approval mode</span>
            </div>
        </div>
        <div class="hitl-inline-body">
            ${prompt ? `<div class="hitl-inline-note">${escapeHtml(prompt)}</div>` : '<div class="hitl-inline-note">The workflow is paused, waiting for your confirmation to continue.</div>'}
            <label class="hitl-inline-field">
                <span class="hitl-context-label">Note (optional)</span>
                <input class="hitl-config-input workflow-hitl-inline-comment" type="text" placeholder="Review note">
            </label>
        </div>
        <div class="hitl-pending-actions hitl-inline-actions">
            <div class="hitl-input-help workflow-hitl-inline-status" aria-live="polite"></div>
            <button class="btn-secondary workflow-hitl-inline-reject">Reject</button>
            <button class="btn-primary workflow-hitl-inline-approve">Approve</button>
        </div>
    `;
  contentEl.appendChild(panel);

  const approveBtn = panel.querySelector<HTMLButtonElement>('.workflow-hitl-inline-approve');
  const rejectBtn = panel.querySelector<HTMLButtonElement>('.workflow-hitl-inline-reject');
  const commentInput = panel.querySelector<HTMLInputElement>('.workflow-hitl-inline-comment');
  const statusEl = panel.querySelector<HTMLElement>('.workflow-hitl-inline-status');
  if (!approveBtn || !rejectBtn || !commentInput || !statusEl) return;

  const setBusy = (busy: boolean) => {
    approveBtn.disabled = busy;
    rejectBtn.disabled = busy;
  };

  const submit = async (approved: boolean) => {
    setBusy(true);
    const comment = String(commentInput.value || '').trim();
    try {
      const response = await deps.request(`/api/workflows/runs/${encodeURIComponent(String(runId))}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, comment }),
      });
      const body = response && typeof response.json === 'function' ? (await response.json()) as { error?: string; streamResuming?: boolean } : null;
      if (!response || !response.ok) {
        statusEl.textContent = body && body.error ? body.error : 'Submit failed; try again';
        setBusy(false);
        return;
      }
      if (body && body.streamResuming) {
        statusEl.textContent = approved ? 'Approved; the workflow is continuing…' : 'Rejected';
        panel.classList.add('hitl-inline-done');
        return;
      }
      statusEl.textContent = approved ? 'Approved; the workflow continues' : 'Rejected';
      panel.classList.add('hitl-inline-done');
    } catch (e) {
      statusEl.textContent = 'Submit failed: ' + (e instanceof Error && e.message ? e.message : 'unknown error');
      setBusy(false);
    }
  };

  approveBtn.onclick = () => { void submit(true); };
  rejectBtn.onclick = () => { void submit(false); };
  deps.setTaskAvailability(panel, panel.dataset.conversationId ?? '');
}

/**
 * After a refresh or a change of conversation: the runs that wait for approval get their approval card back under the step
 * they stopped at. The message's process details are loaded first, when they were not yet.
 */
export async function restoreWorkflowApprovals(deps: WorkflowHitlDeps, conversationId: string): Promise<void> {
  if (!conversationId) return;
  const current = deps.currentConversationId();
  if (current && current !== conversationId) return;
  try {
    const resp = await deps.request('/api/workflows/runs/pending?conversationId=' + encodeURIComponent(conversationId));
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({})) as { runs?: WorkflowRunRecord[] };
    const runs = Array.isArray(data.runs) ? data.runs : [];
    if (!runs.length) return;

    // The approval belongs to the newest assistant message that the server has saved.
    let msgEl: HTMLElement | null = deps.doc.querySelector<HTMLElement>('#chat-messages [data-backend-message-id]');
    const nodes = deps.doc.querySelectorAll<HTMLElement>('#chat-messages .message.assistant');
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node && node.dataset && node.dataset.backendMessageId) {
        msgEl = node;
        break;
      }
    }
    if (!msgEl || !msgEl.id) return;
    const clientMsgId = msgEl.id;
    const backendMsgId = msgEl.dataset.backendMessageId ?? '';
    const detailsContainer = deps.doc.getElementById('process-details-' + clientMsgId);
    if (!detailsContainer) return;

    if (detailsContainer.dataset.lazyNotLoaded === '1' && detailsContainer.dataset.loaded !== '1') {
      try {
        detailsContainer.dataset.loading = '1';
        await deps.loadProcessDetails(clientMsgId, backendMsgId);
      } catch (e) {
        console.error('Failed to load process details (workflow HITL resume):', e);
      } finally {
        detailsContainer.dataset.loading = '0';
      }
    }

    deps.expandProcessDetails(clientMsgId);

    for (const run of runs) {
      const hitlData = workflowHitlDataFromRun(run);
      if (!hitlData) continue;
      let hitlItemEl = findWorkflowHitlTimelineItem(detailsContainer, hitlData.workflowRunId);
      if (!hitlItemEl) {
        const timeline = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
        if (timeline) {
          const itemId = deps.addTimelineItem(timeline, 'workflow_hitl_waiting', {
            title: '🧑‍⚖️ Workflow awaiting approval',
            message: hitlData.label || '',
            data: hitlData,
          });
          hitlItemEl = deps.doc.getElementById(itemId);
        }
      }
      if (hitlItemEl && hitlItemEl.id) renderWorkflowApproval(deps, hitlItemEl.id, hitlData);
    }
  } catch (e) {
    deps.logError('restoreWorkflowHitlInlineForConversation failed', e);
  }
}
