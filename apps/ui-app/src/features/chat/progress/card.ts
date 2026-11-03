// The progress card of a running task: the card that opens in the conversation when a task starts, its title with the time
// it has run, and the clock that keeps that time up to date while the task runs.

import type { TimelineTranslate } from '../timeline/tool-result';
import { wording } from './tasks';

export interface CardDeps {
  doc: Document;
  t: TimelineTranslate;
  /** The wording of a duration, as the page writes it. */
  formatDuration(milliseconds: number): string;
  /** The conversation the page shows now. */
  currentConversationId(): string | null | undefined;
  /** A number that is unique for each message the page makes. */
  nextSequence(): number;
  messagesContainer(): HTMLElement | null;
  scrollToBottomIfPinned(pinned: boolean): void;
  capturePinned(): boolean;
  startLiveFollow(progressId: string): void;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
}

const clocks = new Map<string, number>();

/** The title of a progress while it runs: the time it has run so far. */
export function progressElapsedText(deps: CardDeps, progressId: string): string {
  const el = deps.doc.getElementById(progressId);
  const startedAt = el && el.dataset ? Number(el.dataset.turnStartedAtMs) : Number.NaN;
  const duration = deps.formatDuration(Number.isFinite(startedAt) ? Date.now() - startedAt : 0);
  return deps.t('chat.turnElapsedRunning', { duration });
}

/** Writes the elapsed title of a progress, and the state of its summary toggle. */
export function syncProgressElapsedSummary(deps: CardDeps, progressId: string): void {
  const el = deps.doc.getElementById(progressId);
  if (!el) return;
  const title = el.querySelector('.progress-title');
  if (title) title.textContent = progressElapsedText(deps, progressId);
  const timeline = deps.doc.getElementById(progressId + '-timeline');
  const summary = el.querySelector('.progress-summary-toggle');
  if (summary) {
    const expanded = !!(timeline && timeline.classList.contains('expanded'));
    summary.classList.toggle('is-expanded', expanded);
    summary.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
}

export function stopProgressElapsedClock(deps: CardDeps, progressId: string): void {
  const timer = clocks.get(progressId);
  if (timer) deps.clearInterval(timer);
  clocks.delete(progressId);
}

/** Starts the clock of a progress: it updates the elapsed title every second, and stops when the card leaves the page. */
export function startProgressElapsedClock(deps: CardDeps, progressId: string): void {
  stopProgressElapsedClock(deps, progressId);
  syncProgressElapsedSummary(deps, progressId);
  clocks.set(progressId, deps.setInterval(() => {
    if (!deps.doc.getElementById(progressId)) {
      stopProgressElapsedClock(deps, progressId);
      return;
    }
    syncProgressElapsedSummary(deps, progressId);
  }, 1000));
}

/** Adds the progress card to the conversation, and returns its id. */
export function addProgressMessage(deps: CardDeps): string {
  const { doc, t } = deps;
  const messagesDiv = deps.messagesContainer();
  const messageDiv = doc.createElement('div');
  const id = 'progress-' + Date.now() + '-' + deps.nextSequence();
  messageDiv.id = id;
  messageDiv.className = 'message assistant progress-message';

  messagesDiv?.querySelector('.chat-welcome-empty-state')?.remove();

  const contentWrapper = doc.createElement('div');
  contentWrapper.className = 'message-content';

  const bubble = doc.createElement('div');
  bubble.className = 'message-bubble progress-container';
  const progressTitleText = wording(t, 'chat.progressInProgress', 'Penetration test in progress...');
  const stopTaskText = wording(t, 'tasks.stopTask', 'Stop task');
  const collapseDetailText = wording(t, 'tasks.collapseDetail', 'Collapse details');
  bubble.innerHTML = `
        <div class="progress-header">
            <button type="button" class="turn-process-summary progress-summary-toggle is-expanded" aria-expanded="true" data-act-click='[["toggleProgressDetails","${id}"]]'>
                <span class="turn-process-leading">
                    <span class="turn-process-status-dot is-running" aria-hidden="true"></span>
                    <span class="progress-title"></span>
                </span>
                <svg class="turn-process-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.5 5.5L12 10l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="progress-actions">
                <button class="progress-stop" id="${id}-stop-btn" data-act-click='[["cancelProgressTask","${id}"]]'>${stopTaskText}</button>
                <button class="progress-toggle" data-act-click='[["toggleProgressDetails","${id}"]]'>${collapseDetailText}</button>
            </div>
        </div>
        <div class="progress-stage" aria-live="polite">${progressTitleText}</div>
        <div class="progress-timeline expanded" id="${id}-timeline"></div>
        <div class="progress-footer">
            <button type="button" class="progress-toggle progress-toggle-bottom" data-act-click='[["toggleProgressDetails","${id}"]]'>${collapseDetailText}</button>
        </div>
    `;

  contentWrapper.appendChild(bubble);
  messageDiv.appendChild(contentWrapper);
  messageDiv.dataset.conversationId = deps.currentConversationId() || '';
  messageDiv.dataset.turnStartedAtMs = String(Date.now());
  messageDiv.dataset.turnStartedAt = new Date().toISOString();
  messagesDiv?.appendChild(messageDiv);
  bubble.classList.add('is-streaming');
  deps.scrollToBottomIfPinned(deps.capturePinned());

  startProgressElapsedClock(deps, id);
  deps.startLiveFollow(id);
  return id;
}
