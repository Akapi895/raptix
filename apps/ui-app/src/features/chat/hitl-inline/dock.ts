// The approval dock: the card that sits above the composer while the conversation on the screen waits for a decision. It is
// shown only for the conversation it belongs to, and it is cleared when the decision is made.

import { hitlApprovalArguments, isAgentReviewedHitl, type HitlRecord, type HitlTranslate } from './describe';
import { buildInlineApprovalHtml, type HitlInlineView } from './view';

export interface DockDeps {
  doc: Document;
  tr: HitlTranslate;
  now(): number;
  /** The conversation the page shows now. */
  currentConversationId(): string;
  view: HitlInlineView;
}

const DOCK_ID = 'chat-hitl-approval-dock';

/** Puts the scrolling part of the dock's card into one region, so that the buttons stay below it. */
export function wrapScrollRegion(doc: Document, dock: HTMLElement | null | undefined): void {
  if (!dock) return;
  const actions = Array.prototype.find.call(dock.children, (child: Element) => child.classList && child.classList.contains('hitl-inline-actions')) as Element | undefined;
  if (!actions) return;
  const scrollRegion = doc.createElement('div');
  scrollRegion.className = 'chat-hitl-approval-scroll-region';
  while (dock.firstChild && dock.firstChild !== actions) scrollRegion.appendChild(dock.firstChild);
  dock.insertBefore(scrollRegion, actions);
}

/** Hides the dock, unless it is showing another interrupt than the one given. */
export function clearDock(deps: DockDeps, interruptId?: unknown): void {
  const dock = deps.doc.getElementById(DOCK_ID);
  if (!dock) return;
  if (interruptId && dock.dataset.hitlInterruptId && dock.dataset.hitlInterruptId !== String(interruptId)) return;
  deps.view.stopCountdown(dock);
  dock.hidden = true;
  dock.innerHTML = '';
  dock.removeAttribute('data-hitl-interrupt-id');
  dock.removeAttribute('data-conversation-id');
  dock.removeAttribute('tabindex');
  dock.onkeydown = null;
  dock.closest('.chat-input-container')?.classList.remove('has-hitl-approval');
}

/**
 * Shows an approval in the dock. Nothing is shown for an approval of another conversation, nor for one an agent reviews,
 * since no person has to act on it.
 */
export function renderDock(deps: DockDeps, data: HitlRecord | null | undefined): boolean {
  const dock = deps.doc.getElementById(DOCK_ID) as HTMLElement | null;
  if (!dock || !data || !data.interruptId) return false;
  const conversationId = String(data.conversationId || '').trim();
  const currentId = String(deps.currentConversationId() || '').trim();
  // A task that has not yet got its conversation id must not let a late approval of another running conversation take the input.
  if (conversationId && conversationId !== currentId) return false;
  if (isAgentReviewedHitl(data)) return false;
  let mode = String(data.mode || 'approval').trim().toLowerCase();
  if (mode === 'feedback' || mode === 'followup') mode = 'approval';
  const allowEdit = mode === 'review_edit';
  dock.dataset.hitlInterruptId = String(data.interruptId);
  dock.dataset.conversationId = conversationId || currentId;
  dock.setAttribute('tabindex', '-1');
  dock.innerHTML = buildInlineApprovalHtml(data, {
    mode,
    allowEdit,
    argsJSON: JSON.stringify(hitlApprovalArguments(data), null, 2),
  }, deps.tr, deps.now());
  wrapScrollRegion(deps.doc, dock);
  dock.hidden = false;
  dock.closest('.chat-input-container')?.classList.add('has-hitl-approval');
  deps.view.bindApproval(dock, data, { allowEdit });
  deps.view.bindCountdown(dock, data);
  deps.view.setTaskAvailability(dock, dock.dataset.conversationId);
  return true;
}
