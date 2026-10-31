// The approvals that wait, as the conversation list shows them: a badge with the words and the time left on the conversation
// that waits. The badge is drawn into the row of its conversation, and the badges are kept up to date on a timer.

import { escapeAttrSelector } from './view';
import { formatHitlRemaining, getHitlApprovalTiming, isAgentReviewedHitl, type HitlRecord, type HitlTranslate } from './describe';

export interface SidebarDeps {
  doc: Document;
  tr: HitlTranslate;
  now(): number;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** The conversation the page shows now. */
  currentConversationId(): string;
  /** Tells the project list that a conversation waits for approval, or no longer does. */
  setProjectApprovalStatus(conversationId: string, pending: boolean, data: HitlRecord | null): void;
}

/** The waiting approvals, by conversation id, and the timer that keeps their badges up to date. */
export function createHitlSidebar(deps: SidebarDeps) {
  const { doc } = deps;
  const state = new Map<string, HitlRecord>();
  let timer = 0;

  const rowOf = (conversationId: string): Element | null =>
    doc.querySelector('.project-conversation-item[data-conversation-id="' + escapeAttrSelector(conversationId) + '"]');

  /** Draws or updates the badge of one conversation: its label, its time left, and a bar of the share left. */
  function render(conversationId: string, data: HitlRecord | null | undefined): boolean {
    const id = String(conversationId || '').trim();
    if (!id) return false;
    const button = rowOf(id);
    if (!button) return false;
    const label = button.querySelector('.project-conversation-label');
    if (!label) return false;
    let group = label.querySelector('.project-task-status-group');
    if (!group) {
      group = doc.createElement('span');
      group.className = 'project-task-status-group';
      label.appendChild(group);
    }
    let status = group.querySelector<HTMLElement>('.project-task-status--approval');
    if (!status) {
      status = doc.createElement('span');
      status.className = 'project-task-status project-task-status--approval';
      status.innerHTML = '<span class="project-approval-label"></span><span class="project-approval-time"></span>' +
        '<span class="project-approval-progress"><span class="project-approval-progress-value"></span></span>';
      group.insertBefore(status, group.firstChild);
    }
    const text = deps.tr('hitl.waitingApprovalShort', 'Waiting for approval');
    const labelEl = status.querySelector('.project-approval-label');
    if (labelEl) labelEl.textContent = text;
    status.setAttribute('aria-label', text);
    status.title = text;
    const timing = getHitlApprovalTiming(data || {});
    const timeEl = status.querySelector('.project-approval-time');
    const progressEl = status.querySelector<HTMLElement>('.project-approval-progress');
    const valueEl = status.querySelector<HTMLElement>('.project-approval-progress-value');
    if (!timing.timeoutSeconds || !timing.expiresAt) {
      if (timeEl) timeEl.textContent = '';
      if (progressEl) progressEl.hidden = true;
      return true;
    }
    if (progressEl) progressEl.hidden = false;
    const remaining = Math.max(0, timing.expiresAt - deps.now());
    const percent = Math.max(0, Math.min(100, (remaining / (timing.timeoutSeconds * 1000)) * 100));
    if (timeEl) timeEl.textContent = formatHitlRemaining(remaining).replace(/^0/, '');
    if (valueEl) valueEl.style.width = percent.toFixed(2) + '%';
    status.setAttribute('role', 'progressbar');
    status.setAttribute('aria-valuemin', '0');
    status.setAttribute('aria-valuemax', '100');
    status.setAttribute('aria-valuenow', String(Math.round(percent)));
    status.classList.toggle('is-expired', remaining <= 0);
    return true;
  }

  /** Takes the badge of a conversation off its row, and the group with it when the group is empty. */
  function remove(conversationId: string): void {
    const id = String(conversationId || '').trim();
    if (!id) return;
    const status = rowOf(id)?.querySelector('.project-task-status--approval');
    const group = status?.closest('.project-task-status-group');
    status?.remove();
    if (group && !group.children.length) group.remove();
  }

  function syncAll(): void {
    state.forEach((data, conversationId) => render(conversationId, data));
    if (!state.size && timer) {
      deps.clearInterval(timer);
      timer = 0;
    }
  }

  function ensureTimer(): void {
    if (!timer) timer = deps.setInterval(syncAll, 500);
  }

  /** A pending approval shows its badge and keeps it up to date; a resolved one takes it off. */
  function update(data: HitlRecord | null | undefined, pending: boolean): void {
    const conversationId = String((data && data.conversationId) || deps.currentConversationId() || '').trim();
    if (!conversationId) return;
    if (pending && isAgentReviewedHitl(data)) return;
    if (pending) {
      state.set(conversationId, data || { conversationId });
      render(conversationId, data || {});
      ensureTimer();
    } else {
      state.delete(conversationId);
      remove(conversationId);
      syncAll();
    }
    deps.setProjectApprovalStatus(conversationId, pending, pending ? (data ?? null) : null);
  }

  /** Makes the badges match the approvals the server still reports: a conversation that is no longer waiting loses its badge. */
  function syncState(items: HitlRecord[] | null | undefined): void {
    const nextByConversation = new Map<string, HitlRecord>();
    (Array.isArray(items) ? items : []).forEach(item => {
      if (isAgentReviewedHitl(item)) return;
      const conversationId = String(item && item.conversationId || '').trim();
      if (conversationId && !nextByConversation.has(conversationId)) nextByConversation.set(conversationId, item);
    });
    state.forEach((_item, conversationId) => {
      if (!nextByConversation.has(conversationId)) {
        state.delete(conversationId);
        remove(conversationId);
      }
    });
    nextByConversation.forEach((item, conversationId) => state.set(conversationId, item));
    syncAll();
    if (state.size) ensureTimer();
  }

  return {
    state,
    render,
    remove,
    syncAll,
    update,
    syncState,
  };
}

export type HitlSidebar = ReturnType<typeof createHitlSidebar>;
