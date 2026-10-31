// The send button while a conversation may be running: it reads "Send" when the conversation is idle and "Stop" while
// a task for it is running, and a click does the matching thing.

import type { LiveChatStream } from '../types';
import type { Translate } from '../composer/attachments';

/**
 * Whether the live stream is the task of the conversation on screen. A stream with a conversation id must match it;
 * a stream without one (a new chat) counts only while its progress bubble is in the transcript.
 */
export function liveTaskIsCurrent(liveConversationId: string | null | undefined, visibleConversationId: string, hasVisibleProgress: boolean): boolean {
  const liveId = String(liveConversationId || '').trim();
  const visibleId = String(visibleConversationId || '').trim();
  if (liveId) return !!visibleId && liveId === visibleId;
  return hasVisibleProgress === true;
}

export interface PrimaryActionDependencies {
  doc: Document;
  t: Translate;
  visibleConversation(): string;
  live(): LiveChatStream | null;
  progressInTranscript(progressId: string): boolean;
  isConversationRunning(conversationId: string): boolean;
  send(): void;
  cancelConversation(conversationId: string): void;
  cancelProgress(progressId: string): void;
}

export interface PrimaryAction {
  isTaskActive(): boolean;
  update(): void;
  onClick(event?: Event): void;
  init(): void;
}

export function createPrimaryAction(deps: PrimaryActionDependencies): PrimaryAction {
  const { doc, t } = deps;

  function isLiveTaskVisible(live: LiveChatStream | null, visibleId: string): boolean {
    if (!live || !live.active) return false;
    const hasVisibleProgress = !!live.progressId && deps.progressInTranscript(live.progressId);
    return liveTaskIsCurrent(live.conversationId, visibleId, hasVisibleProgress);
  }

  function isTaskActive(): boolean {
    const visibleId = deps.visibleConversation();
    if (isLiveTaskVisible(deps.live(), visibleId)) return true;
    return !!visibleId && deps.isConversationRunning(visibleId);
  }

  function update(): void {
    const button = doc.getElementById('chat-send-btn');
    if (!button) return;
    const running = isTaskActive();
    const label = running ? t('tasks.stopTask', 'Stop task') : t('chat.send', 'Send');
    button.classList.toggle('is-task-running', running);
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    const labelElement = button.querySelector('.send-btn-label');
    if (labelElement) labelElement.textContent = label;
  }

  function onClick(event?: Event): void {
    event?.preventDefault();
    if (!isTaskActive()) {
      deps.send();
      return;
    }
    const conversationId = deps.visibleConversation();
    if (conversationId) {
      deps.cancelConversation(conversationId);
      return;
    }
    const live = deps.live();
    if (live?.progressId) deps.cancelProgress(live.progressId);
  }

  function init(): void {
    const button = doc.getElementById('chat-send-btn');
    if (!button) return;
    if (!button.querySelector('.send-btn-stop-icon')) {
      const stopIcon = doc.createElement('span');
      stopIcon.className = 'send-btn-stop-icon';
      stopIcon.setAttribute('aria-hidden', 'true');
      button.appendChild(stopIcon);
    }
    button.onclick = event => onClick(event);
    update();
  }

  return { isTaskActive, update, onClick, init };
}
