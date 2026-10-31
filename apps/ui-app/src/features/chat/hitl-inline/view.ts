// The approval that waits inside the timeline: the card under a tool call (or under a workflow step), its countdown, its
// buttons, and the decision it sends. The card's markup is built here with every value escaped; the page only places it.

import { escapeHtml } from '../../../ui/format';
import type { ToolCallView } from '../timeline/tool-call-view';
import { describeHitlApprovalRequest, formatHitlRemaining, getHitlApprovalTiming, hitlApprovalArguments, hitlRemainingPercent, isAgentReviewedHitl, type HitlRecord, type HitlTranslate } from './describe';

export interface HitlInlineDeps {
  doc: Document;
  tr: HitlTranslate;
  now(): number;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** The conversation the page shows now. */
  currentConversationId(): string;
  toolView: ToolCallView;
  /** The tool call item of each interrupt, by interrupt id. */
  interruptItems: Map<string, string>;
  /** Whether the approval is closed: its task has ended, or its interrupt is no longer pending. */
  approvalClosed(conversationId: string, interruptId: string): boolean;
  /** Whether the decision function is loaded on the page. */
  canSubmit(): boolean;
  /** Sends the decision to the server. */
  submitDecision(interruptId: unknown, decision: string, comment: string, editedArgs: unknown, conversationId: string): Promise<boolean>;
  clearDock(interruptId?: unknown): void;
  setProjectApprovalStatus(conversationId: string, pending: boolean): void;
}

export interface ApprovalCardOptions {
  toolName?: string;
  modeLabel?: string;
  mode?: string;
  allowEdit?: boolean;
  argsJSON?: string;
}

const SHIELD = '<svg class="hitl-codex-shield" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.2l6 2.5v4.5c0 3.8-2.35 6.55-6 8.6-3.65-2.05-6-4.8-6-8.6V4.7l6-2.5z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/><path d="M7.5 10l1.55 1.55L12.8 7.8" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The countdown of a request: its time left, and a bar of the share left. Unlimited when the request has no timeout. */
export function buildCountdownHtml(data: HitlRecord, tr: HitlTranslate, now: number): string {
  const timing = getHitlApprovalTiming(data);
  if (!timing.timeoutSeconds || !timing.expiresAt) {
    return '<div class="hitl-approval-countdown hitl-approval-countdown--unlimited">' +
      '<span>' + escapeHtml(tr('hitl.timeoutUnlimited', 'No time limit')) + '</span></div>';
  }
  const remaining = Math.max(0, timing.expiresAt - now);
  const percent = hitlRemainingPercent(timing, now);
  return '<div class="hitl-approval-countdown" data-hitl-expires-at="' + timing.expiresAt + '" data-hitl-timeout="' + timing.timeoutSeconds + '">' +
    '<div class="hitl-approval-countdown-copy"><span>' + escapeHtml(tr('hitl.timeoutAutoReject', 'Automatically rejects at expiry')) + '</span>' +
    '<strong class="hitl-approval-countdown-value">' + formatHitlRemaining(remaining) + '</strong></div>' +
    '<div class="hitl-approval-progress" aria-hidden="true"><span class="hitl-approval-progress-value" style="width:' + percent.toFixed(2) + '%"></span></div>' +
    '</div>';
}

/** The body of an approval card: the question, the request details, and the buttons, or the state it reached once decided. */
export function buildInlineApprovalHtml(data: HitlRecord, opts: ApprovalCardOptions | null | undefined, tr: HitlTranslate, now: number): string {
  const hasToolNameOverride = !!opts && Object.prototype.hasOwnProperty.call(opts, 'toolName');
  const toolName = hasToolNameOverride ? String(opts?.toolName || '') : String(data.toolName || '-');
  const allowEdit = !!opts && opts.allowEdit === true;
  const request = describeHitlApprovalRequest({ ...data, ...(toolName ? { toolName } : {}) }, tr);
  const argsJSON = opts && opts.argsJSON ? opts.argsJSON : request.argsJSON;
  const reviewer = String(data.reviewer || data.decidedBy || '').trim().toLowerCase();
  const audit = reviewer === 'audit_agent' || String(data.status || '') === 'audit_running';
  const status = String(data.status || '').trim().toLowerCase();
  const timedOut = status === 'timeout' || (String(data.decidedBy || '').trim().toLowerCase() === 'system' && /timeout|\u8d85\u65f6/i.test(String(data.comment || data.decisionMessage || '')));
  const cancelled = status === 'cancelled';
  const resolved = !!data.resolved || status === 'decided' || status === 'timeout' || cancelled || data.decision === 'approve' || data.decision === 'reject';
  const editedArgs = data.editedArgs || data.editedArguments;
  const hasEditedArgs = !!editedArgs && typeof editedArgs === 'object' && Object.keys(editedArgs).length > 0;
  const toolHeading = toolName || request.displayTool
    ? '<div class="hitl-codex-tool-row">' + SHIELD + '<span>' + escapeHtml(request.displayTool || toolName) + '</span></div>'
    : '';

  if (resolved) {
    if (cancelled) {
      const statusText = tr('hitl.interruptedApprovalCancelled', 'Task interrupted; approval cancelled');
      const comment = data.comment && data.comment !== 'process restarted' && data.comment !== 'task cancelled'
        ? '<p class="hitl-codex-explainer">' + escapeHtml(data.comment) + '</p>'
        : '';
      return toolHeading + `
                <div class="hitl-codex-state hitl-codex-state--interrupted">
                    <span class="hitl-codex-state-icon" aria-hidden="true">×</span>
                    <strong>${escapeHtml(statusText)}</strong>
                </div>
                ${comment}
            `;
    }
    const ok = !timedOut && data.decision !== 'reject';
    let statusText: string;
    if (timedOut) {
      statusText = tr('hitl.expiredRejected', 'Approval timed out and was rejected');
    } else if (audit) {
      statusText = ok
        ? (hasEditedArgs ? tr('hitl.auditEditedApproved', 'Audit Agent edited parameters and approved') : tr('hitl.auditApproved', 'Audit Agent approved'))
        : tr('hitl.auditRejected', 'Audit Agent rejected');
    } else {
      statusText = ok
        ? (hasEditedArgs ? tr('hitl.humanEditedApproved', 'Edited parameters and allowed') : tr('hitl.humanApproved', 'Allowed once'))
        : tr('hitl.humanRejected', 'Human approval rejected');
    }
    const comment = data.comment ? '<p class="hitl-codex-explainer">' + escapeHtml(data.comment) + '</p>' : '';
    const diff = hasEditedArgs
      ? '<details class="hitl-codex-diff"><summary>' + escapeHtml(tr('hitl.viewEditedArgs', 'View edited parameters')) + '</summary><pre>' + escapeHtml(JSON.stringify(editedArgs, null, 2)) + '</pre></details>'
      : '';
    return toolHeading + `
            <div class="hitl-codex-state hitl-codex-state--${ok ? 'approved' : 'rejected'}">
                <span class="hitl-codex-state-icon" aria-hidden="true">${ok ? '✓' : '×'}</span>
                <strong>${escapeHtml(statusText)}</strong>
            </div>
            ${comment}
            ${diff}
        `;
  }

  if (audit) {
    const mode = opts?.mode || String(data.mode || 'approval').trim().toLowerCase();
    const auditStatus = mode === 'review_edit'
      ? tr('hitl.auditReviewEditing', 'Automatically reviewing and correcting')
      : tr('hitl.auditReviewing', 'Automatic review in progress');
    const explanation = tr('hitl.auditReviewExplanation', 'A carefully prompted review agent is reviewing this request. It will run only after approval.');
    return toolHeading + `
            <div class="hitl-codex-state hitl-codex-state--running">
                <span class="hitl-codex-spinner" aria-hidden="true"></span>
                <strong>${escapeHtml(auditStatus)}</strong>
            </div>
            <p class="hitl-codex-explainer">${escapeHtml(explanation)}</p>
        `;
  }

  const pendingStatus = allowEdit ? tr('hitl.waitingHumanReview', 'Waiting for human review') : tr('hitl.waitingHumanApproval', 'Waiting for human approval');
  const rejectLabel = tr('hitl.reject', 'Reject');
  const approveLabel = allowEdit ? tr('hitl.saveEditedAndAllow', 'Save edits and allow') : tr('hitl.allowOnce', 'Allow once');
  const hasArgs = Object.keys(request.args).length > 0;
  const primary = request.primary
    ? '<div class="hitl-approval-primary hitl-approval-primary--' + request.kind + '"><code>' + escapeHtml(request.primary) + '</code></div>'
    : '';
  const requestDetails = hasArgs
    ? '<details class="hitl-approval-details"' + (allowEdit ? ' open' : '') + '><summary>' + escapeHtml(allowEdit
      ? tr('hitl.editRequestDetails', 'View or edit request parameters')
      : tr('hitl.viewRequestDetails', 'View request details')) + '</summary>' +
      (allowEdit
        ? '<textarea class="hitl-edit-args hitl-inline-edit" spellcheck="false">' + escapeHtml(argsJSON === '{}' ? '' : argsJSON) + '</textarea>'
        : '<pre>' + escapeHtml(argsJSON) + '</pre>') + '</details>'
    : '';
  return `
        ${toolHeading}
        <div class="hitl-approval-heading">
            <span class="hitl-approval-eyebrow">${escapeHtml(pendingStatus)}</span>
            <h3>${escapeHtml(request.question)}</h3>
        </div>
        ${primary}
        ${buildCountdownHtml(data, tr, now)}
        <div class="hitl-inline-body">
            ${requestDetails}
            <details class="hitl-approval-details hitl-approval-comment-details">
                <summary>${escapeHtml(tr('hitl.addApprovalComment', 'Add approval comment (optional)'))}</summary>
                <input class="hitl-config-input hitl-inline-comment" type="text" placeholder="${escapeHtml(tr('hitl.commentPlaceholder', 'e.g. allow read-only command'))}">
            </details>
        </div>
        <div class="hitl-pending-actions hitl-inline-actions">
            <div class="hitl-input-help hitl-inline-status" aria-live="polite"></div>
            <button type="button" class="btn-secondary hitl-inline-reject">${escapeHtml(rejectLabel)} <kbd>Esc</kbd></button>
            <button type="button" class="btn-primary hitl-inline-approve">${escapeHtml(approveLabel)} <kbd>↵</kbd></button>
        </div>
    `;
}

/** The escaped form of a value in an attribute selector. */
export function escapeAttrSelector(value: unknown): string {
  const s = String(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function createHitlInlineView(deps: HitlInlineDeps) {
  const { doc, tr } = deps;
  /** The countdown timer and the data of each card, kept on the side of the element. */
  const timers = new WeakMap<HTMLElement, number>();
  const countdownData = new WeakMap<HTMLElement, HitlRecord>();

  function stopCountdown(panel: HTMLElement | null | undefined): void {
    const timer = panel ? timers.get(panel) : undefined;
    if (panel && timer) {
      deps.clearInterval(timer);
      timers.delete(panel);
    }
  }

  function bindCountdown(panel: HTMLElement | null | undefined, data: HitlRecord): void {
    if (!panel) return;
    stopCountdown(panel);
    countdownData.set(panel, data);
    if (panel.classList.contains('hitl-approval-task-closed')) return;
    const timing = getHitlApprovalTiming(data);
    const countdown = panel.querySelector<HTMLElement>('.hitl-approval-countdown[data-hitl-expires-at]');
    if (!countdown || !timing.expiresAt || !timing.timeoutSeconds) return;
    const value = countdown.querySelector<HTMLElement>('.hitl-approval-countdown-value');
    const progress = countdown.querySelector<HTMLElement>('.hitl-approval-progress-value');
    const update = () => {
      const remaining = Math.max(0, timing.expiresAt - deps.now());
      if (value) value.textContent = formatHitlRemaining(remaining);
      if (progress) progress.style.width = hitlRemainingPercent(timing, deps.now()).toFixed(2) + '%';
      if (remaining <= 0) {
        stopCountdown(panel);
        panel.classList.add('hitl-approval-expired');
        panel.querySelectorAll<HTMLButtonElement>('.hitl-inline-approve, .hitl-inline-reject').forEach(button => {
          button.disabled = true;
        });
        const status = panel.querySelector('.hitl-inline-status');
        if (status) status.textContent = tr('hitl.expiredAutoRejected', 'Approval timed out; rejecting automatically…');
      }
    };
    update();
    timers.set(panel, deps.setInterval(update, 250));
  }

  /** Puts the decision of a tool call's card on the call: its summary, with the arguments the reviewer changed. */
  function renderToolCallSummary(item: HTMLElement | null | undefined, data: HitlRecord | null | undefined): void {
    if (!item || !data || !data.interruptId) return;
    let panel = item.querySelector<HTMLElement>(':scope > .hitl-inline-approval.hitl-tool-approval-summary');
    if (!panel) {
      panel = doc.createElement('div');
      panel.className = 'hitl-inline-approval hitl-tool-approval-summary';
      const header = item.querySelector<HTMLElement>(':scope > .timeline-item-header');
      if (header && header.nextSibling) item.insertBefore(panel, header.nextSibling);
      else item.appendChild(panel);
    }
    const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : {};
    const mode = String(data.mode || 'approval').trim().toLowerCase();
    const allowEdit = mode === 'review_edit';
    const argsObj = payload.argumentsObj && typeof payload.argumentsObj === 'object' ? payload.argumentsObj : {};
    panel.innerHTML = buildInlineApprovalHtml(data, {
      toolName: '',
      mode,
      allowEdit,
      argsJSON: JSON.stringify(argsObj, null, 2),
    }, tr, deps.now());
    panel.dataset.hitlInterruptId = String(data.interruptId);
    panel.dataset.conversationId = String(data.conversationId || deps.currentConversationId() || '').trim();
    panel.classList.toggle('hitl-inline-done', !!data.resolved || String(data.status || '') === 'decided');
    if (!data.resolved && !isAgentReviewedHitl(data)) {
      bindApproval(panel, data, { allowEdit });
      bindCountdown(panel, data);
      setTaskAvailability(panel, panel.dataset.conversationId);
    }
  }

  /** Renders the card of an approval under the item it belongs to: a tool call's summary, or a card in the item's content. */
  function renderApproval(itemId: string, data: HitlRecord): void {
    const item = doc.getElementById(itemId);
    if (!item || !data || !data.interruptId) return;
    if (item.classList.contains('timeline-item-tool_call')) {
      const state = deps.toolView.getDetailState(item);
      state.hitlData = data;
      state.pending = true;
      deps.toolView.setDetailState(item, state);
      deps.interruptItems.set(String(data.interruptId), item.id);
      const existingContent = item.querySelector('.timeline-item-content.tool-call-detail-content');
      if (existingContent) {
        existingContent.remove();
        item.classList.remove('tool-call-detail-expanded');
      }
      renderToolCallSummary(item, data);
      deps.toolView.updateToggleLabel(item);
      return;
    }
    let contentEl = item.querySelector<HTMLElement>('.timeline-item-content');
    if (!contentEl) {
      // Types such as a warning have no content area by default; an inline approval needs one it can act in.
      contentEl = doc.createElement('div');
      contentEl.className = 'timeline-item-content';
      item.appendChild(contentEl);
    }
    contentEl.querySelector('.hitl-inline-approval')?.remove();

    const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : {};
    const toolName = data.toolName || payload.toolName || '-';
    let mode = String(data.mode || '').trim().toLowerCase();
    if (mode === 'feedback' || mode === 'followup') mode = 'approval';
    const allowEdit = mode === 'review_edit';
    const argsObj = payload.argumentsObj && typeof payload.argumentsObj === 'object' ? payload.argumentsObj : {};
    const argsJSON = JSON.stringify(argsObj, null, 2);
    const modeLabel = mode === 'review_edit' ? 'Review & edit' : 'Approval mode';

    const panel = doc.createElement('div');
    panel.className = 'hitl-inline-approval';
    panel.dataset.hitlInterruptId = String(data.interruptId);
    panel.dataset.conversationId = String(data.conversationId || deps.currentConversationId() || '').trim();
    panel.innerHTML = buildInlineApprovalHtml(data, {
      toolName: String(toolName),
      modeLabel,
      mode,
      allowEdit,
      argsJSON,
    }, tr, deps.now());
    contentEl.appendChild(panel);
    if (!isAgentReviewedHitl(data)) {
      bindApproval(panel, data, { allowEdit });
      bindCountdown(panel, data);
      setTaskAvailability(panel, panel.dataset.conversationId);
    }
  }

  /** Records the decision on the card: a tool call keeps it on the call, a card records it on itself. Returns false when no card was found. */
  function resolveDecision(timeline: HTMLElement | null | undefined, data: HitlRecord | null | undefined, decision: string, message: unknown): boolean {
    if (!timeline || !data || !data.interruptId) return false;
    const interruptId = String(data.interruptId);
    let item: HTMLElement | null = null;
    const mappedId = deps.interruptItems.get(interruptId);
    if (mappedId) item = doc.getElementById(mappedId);
    if (!item) item = findToolCallItem(timeline, data);
    if (!item) item = timeline.querySelector<HTMLElement>('[data-hitl-interrupt-id="' + escapeAttrSelector(interruptId) + '"]');
    if (!item) return false;

    if (item.classList.contains('timeline-item-tool_call')) {
      const state = deps.toolView.getDetailState(item);
      const previous = state.hitlData;
      state.hitlData = {
        ...(previous || data),
        resolved: true,
        decision,
        decisionMessage: message || '',
        reviewer: data.reviewer || data.decidedBy || (previous && (previous.reviewer || previous.decidedBy)) || 'human',
        decidedBy: data.decidedBy || (previous && previous.decidedBy) || '',
        status: 'decided',
        comment: data.comment || (previous && previous.comment) || '',
        editedArgs: data.editedArgs || data.editedArguments || (previous && (previous.editedArgs || previous.editedArguments)) || null,
      };
      const edited = state.hitlData.editedArgs;
      if (decision === 'approve' && edited && typeof edited === 'object') {
        state.originalArgs = state.originalArgs || state.args || {};
        state.args = edited as Record<string, unknown>;
        state.argsEditedByHitl = true;
      }
      state.pending = decision === 'approve';
      deps.toolView.setDetailState(item, state);
      const content = item.querySelector('.timeline-item-content.tool-call-detail-content');
      if (content) {
        content.remove();
        item.classList.remove('tool-call-detail-expanded');
      }
      renderToolCallSummary(item, state.hitlData);
      deps.toolView.updateToggleLabel(item);
      return true;
    }

    const panel = item.querySelector<HTMLElement>('.hitl-inline-approval');
    if (panel) {
      stopCountdown(panel);
      panel.classList.add('hitl-inline-done');
      panel.innerHTML = buildInlineApprovalHtml({
        ...data,
        resolved: true,
        decision,
        decisionMessage: message || '',
        status: 'decided',
      }, { toolName: data.toolName ? String(data.toolName) : '' }, tr, deps.now());
      return true;
    }
    return false;
  }

  /** The tool call a decision belongs to: by its tool call id, else by the newest call of the same tool. */
  function findToolCallItem(timeline: HTMLElement | null | undefined, data: HitlRecord | null | undefined): HTMLElement | null {
    if (!timeline || !data) return null;
    const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : {};
    const toolCallId = String(data.toolCallId || payload.toolCallId || '').trim();
    if (toolCallId) {
      const byId = timeline.querySelector<HTMLElement>('[data-tool-call-id="' + escapeAttrSelector(toolCallId) + '"]');
      if (byId && byId.classList.contains('timeline-item-tool_call')) return byId;
    }
    const toolName = String(data.toolName || payload.toolName || '').trim().toLowerCase();
    if (!toolName) return null;
    const shortWant = toolName.indexOf('::') >= 0 ? toolName.split('::').pop() : toolName;
    const calls = timeline.querySelectorAll<HTMLElement>('.timeline-item-tool_call');
    for (let i = calls.length - 1; i >= 0; i--) {
      const call = calls[i];
      if (!call) continue;
      const tn = String(call.dataset.toolName || '').trim().toLowerCase();
      const shortTn = tn.indexOf('::') >= 0 ? tn.split('::').pop() : tn;
      if (tn === toolName || tn.endsWith('::' + shortWant) || shortTn === shortWant) return call;
    }
    return null;
  }

  /** The card a decision leaves behind when it was sent from the dock or from a card that has no tool call. */
  function markDecided(panel: HTMLElement | null | undefined, decision: string, message: string): void {
    if (!panel) return;
    const ok = decision === 'approve';
    panel.classList.add('hitl-inline-done');
    panel.innerHTML = `
        <div class="hitl-codex-state hitl-codex-state--${ok ? 'approved' : 'rejected'}">
            <span class="hitl-codex-state-icon" aria-hidden="true">${ok ? '✓' : '×'}</span>
            <strong>${escapeHtml(ok ? 'Allowed once' : 'Manual approval rejected')}</strong>
        </div>
        ${message ? '<p class="hitl-codex-explainer">' + escapeHtml(message) + '</p>' : ''}
    `;
  }

  /** Wires a card's buttons: the decision goes out with the comment, and the edited arguments when the card allows editing. */
  function bindApproval(panel: HTMLElement, data: HitlRecord, opts: { allowEdit?: boolean }): void {
    const approveBtn = panel.querySelector<HTMLButtonElement>('.hitl-inline-approve');
    const rejectBtn = panel.querySelector<HTMLButtonElement>('.hitl-inline-reject');
    const commentInput = panel.querySelector<HTMLInputElement>('.hitl-inline-comment');
    const editInput = panel.querySelector<HTMLTextAreaElement>('.hitl-inline-edit');
    const statusEl = panel.querySelector<HTMLElement>('.hitl-inline-status');
    const allowEdit = opts.allowEdit === true;
    if (!approveBtn || !rejectBtn || !statusEl) return;

    if (editInput) {
      autoResize(editInput);
      editInput.addEventListener('input', () => autoResize(editInput));
    }

    const setBusy = (busy: boolean) => {
      approveBtn.disabled = busy;
      rejectBtn.disabled = busy;
    };

    const submit = async (decision: string) => {
      setBusy(true);
      let editedArgs: unknown = null;
      if (decision === 'approve' && allowEdit && editInput) {
        const raw = String(editInput.value || '').trim();
        if (raw) {
          try {
            editedArgs = JSON.parse(raw) as unknown;
          } catch {
            statusEl.textContent = 'Invalid JSON arguments';
            setBusy(false);
            return;
          }
        }
        const originalArgs = hitlApprovalArguments(data);
        if (editedArgs && JSON.stringify(editedArgs) === JSON.stringify(originalArgs)) editedArgs = null;
      }
      const comment = commentInput ? String(commentInput.value || '').trim() : '';
      try {
        if (!deps.canSubmit()) {
          statusEl.textContent = 'Approval handler not loaded';
          setBusy(false);
          return;
        }
        const convFollow = String(data.conversationId || deps.currentConversationId() || '');
        const ok = await deps.submitDecision(data.interruptId, decision, comment, decision === 'approve' && allowEdit ? editedArgs : null, convFollow);
        if (!ok) {
          statusEl.textContent = 'Submit failed; try again';
          setBusy(false);
          return;
        }
        const msg = decision === 'approve' ? 'Approved; waiting for execution to continue...' : 'Rejected; feedback sent to the model for the next iteration...';
        const toolItem = panel.closest<HTMLElement>('.timeline-item-tool_call');
        if (toolItem && toolItem.id) {
          const state = deps.toolView.getDetailState(toolItem);
          state.hitlData = {
            ...(state.hitlData || data),
            resolved: true,
            decision,
            decisionMessage: msg,
            reviewer: 'human',
            status: 'decided',
            comment,
            editedArgs,
          };
          if (decision === 'approve' && editedArgs && typeof editedArgs === 'object') {
            state.originalArgs = state.originalArgs || state.args || {};
            state.args = editedArgs as Record<string, unknown>;
            state.argsEditedByHitl = true;
          }
          state.pending = decision === 'approve';
          deps.toolView.setDetailState(toolItem, state);
          renderToolCallSummary(toolItem, state.hitlData);
        } else {
          markDecided(panel, decision, msg);
        }
        panel.classList.add('hitl-inline-done');
        stopCountdown(panel);
        deps.clearDock(data.interruptId);
        deps.setProjectApprovalStatus(String(data.conversationId || deps.currentConversationId() || ''), false);
      } catch (e) {
        statusEl.textContent = 'Submit failed: ' + (e instanceof Error && e.message ? e.message : 'unknown error');
        setBusy(false);
      }
    };

    const bindExplicit = (button: HTMLButtonElement, decision: string) => {
      let pointerArmed = false;
      button.addEventListener('pointerdown', event => {
        pointerArmed = event.isPrimary !== false && (event.button == null || event.button === 0);
      });
      button.addEventListener('pointercancel', () => {
        pointerArmed = false;
      });
      button.onclick = event => {
        const pointerClick = !!event && Number(event.detail || 0) > 0;
        const explicitlyPressed = pointerArmed;
        pointerArmed = false;
        // A mouse or touch click must start on the decision button itself. A keyboard press has no pointer detail and still works.
        // This drops the click that a browser redirects to the decision button at the bottom when a scroll button hides.
        if (pointerClick && !explicitlyPressed) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        void submit(decision);
      };
    };

    bindExplicit(approveBtn, 'approve');
    bindExplicit(rejectBtn, 'reject');
    if (panel.classList.contains('chat-hitl-approval-dock')) {
      panel.onkeydown = event => {
        const target = event.target as HTMLElement | null;
        const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
        const editing = tag === 'input' || tag === 'textarea' || tag === 'summary';
        if (event.key === 'Escape' && !editing) {
          event.preventDefault();
          rejectBtn.click();
        } else if (event.key === 'Enter' && !editing) {
          event.preventDefault();
          approveBtn.click();
        }
      };
    }
  }

  /** Grows a text area to its text. */
  function autoResize(textarea: HTMLTextAreaElement | null | undefined): void {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(textarea.scrollHeight, textarea.offsetHeight || 0) + 'px';
  }

  /**
   * Closes the buttons of a card whose task has ended, and says why. A card whose approval is still open gets its buttons and
   * its wording back.
   */
  function setTaskAvailability(panel: HTMLElement | null | undefined, conversationId: string | null | undefined): void {
    if (!panel) return;
    const id = String(conversationId || panel.dataset.conversationId || '').trim();
    if (id) panel.dataset.conversationId = id;
    const interruptId = String(panel.dataset.hitlInterruptId || '').trim();
    const approvalClosed = deps.approvalClosed(id, interruptId);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('.hitl-inline-approve, .hitl-inline-reject, .workflow-hitl-inline-approve, .workflow-hitl-inline-reject');
    const status = panel.querySelector<HTMLElement>('.hitl-inline-status, .workflow-hitl-inline-status');
    panel.classList.toggle('hitl-approval-task-closed', approvalClosed);
    setInterruptedVisualState(panel, approvalClosed);
    buttons.forEach(button => {
      if (approvalClosed) {
        if (!button.disabled) button.dataset.disabledByClosedTask = '1';
        button.disabled = true;
      } else if (button.dataset.disabledByClosedTask === '1') {
        button.disabled = false;
        delete button.dataset.disabledByClosedTask;
      }
    });
    if (!status) return;
    if (approvalClosed) {
      if (!Object.prototype.hasOwnProperty.call(status.dataset, 'taskAvailableText')) status.dataset.taskAvailableText = status.textContent || '';
      status.textContent = tr('hitl.taskClosedApprovalUnavailable', 'Task ended; approval is unavailable');
    } else if (Object.prototype.hasOwnProperty.call(status.dataset, 'taskAvailableText')) {
      status.textContent = status.dataset.taskAvailableText ?? '';
      delete status.dataset.taskAvailableText;
    }
  }

  /** Shows a card whose task was interrupted: its countdown is replaced by the cancel notice, and it is restored when the task runs again. */
  function setInterruptedVisualState(panel: HTMLElement, interrupted: boolean): void {
    if (!panel || panel.classList.contains('hitl-inline-done')) return;
    const eyebrow = panel.querySelector<HTMLElement>('.hitl-approval-eyebrow');
    const countdown = panel.querySelector<HTMLElement>('.hitl-approval-countdown');
    if (interrupted) {
      stopCountdown(panel);
      panel.classList.add('hitl-approval-interrupted');
      if (eyebrow && !Object.prototype.hasOwnProperty.call(eyebrow.dataset, 'taskAvailableText')) {
        eyebrow.dataset.taskAvailableText = eyebrow.textContent || '';
        eyebrow.textContent = tr('hitl.taskInterrupted', 'Task interrupted');
      }
      if (countdown && !Object.prototype.hasOwnProperty.call(countdown.dataset, 'taskAvailableHtml')) {
        countdown.dataset.taskAvailableHtml = countdown.innerHTML;
        countdown.dataset.taskAvailableClass = countdown.className;
        countdown.dataset.taskAvailableExpiresAt = countdown.dataset.hitlExpiresAt || '';
        countdown.dataset.taskAvailableTimeout = countdown.dataset.hitlTimeout || '';
        countdown.removeAttribute('data-hitl-expires-at');
        countdown.removeAttribute('data-hitl-timeout');
        countdown.className = 'hitl-approval-countdown hitl-approval-countdown--interrupted';
        countdown.innerHTML = '<div class="hitl-codex-state hitl-codex-state--interrupted">' +
          '<span class="hitl-codex-state-icon" aria-hidden="true">×</span>' +
          '<strong>' + escapeHtml(tr('hitl.interruptedApprovalCancelled', 'Task interrupted; approval cancelled')) + '</strong>' +
          '</div>';
      }
      return;
    }
    if (!panel.classList.contains('hitl-approval-interrupted')) return;
    panel.classList.remove('hitl-approval-interrupted');
    if (eyebrow && Object.prototype.hasOwnProperty.call(eyebrow.dataset, 'taskAvailableText')) {
      eyebrow.textContent = eyebrow.dataset.taskAvailableText ?? '';
      delete eyebrow.dataset.taskAvailableText;
    }
    if (countdown && Object.prototype.hasOwnProperty.call(countdown.dataset, 'taskAvailableHtml')) {
      countdown.className = countdown.dataset.taskAvailableClass || 'hitl-approval-countdown';
      countdown.innerHTML = countdown.dataset.taskAvailableHtml ?? '';
      if (countdown.dataset.taskAvailableExpiresAt) countdown.dataset.hitlExpiresAt = countdown.dataset.taskAvailableExpiresAt;
      if (countdown.dataset.taskAvailableTimeout) countdown.dataset.hitlTimeout = countdown.dataset.taskAvailableTimeout;
      delete countdown.dataset.taskAvailableClass;
      delete countdown.dataset.taskAvailableHtml;
      delete countdown.dataset.taskAvailableExpiresAt;
      delete countdown.dataset.taskAvailableTimeout;
      const data = countdownData.get(panel);
      if (data) bindCountdown(panel, data);
    }
  }

  return {
    stopCountdown,
    bindCountdown,
    renderApproval,
    renderToolCallSummary,
    resolveDecision,
    findToolCallItem,
    markDecided,
    bindApproval,
    setTaskAvailability,
    setInterruptedVisualState,
    autoResize,
  };
}

export type HitlInlineView = ReturnType<typeof createHitlInlineView>;
