// Building the transcript's message elements: the bubble with the formatted text, the time, the copy button, and the
// attachments that hang off an assistant message (the MCP call buttons are attached by the page's own code).

import { escapeHtml } from '../../../ui/format';
import type { AddMessageOptions } from '../types';
import { copyMessage, showCopySuccess, type CopyDependencies } from './copy';
import {
  formatMessageTime, localizeAssistantError, messageMoment, type Translate,
} from './text';
import { updateWelcomeTitle, welcomeText } from './welcome';

export interface MessageMarkdown {
  /** Whether the Markdown renderer is loaded; without it the text is shown escaped. */
  available(): boolean;
  format(text: string): string;
  stripSuspiciousImages(bubble: HTMLElement): void;
}

export interface MessageViewDependencies {
  doc: Document;
  t: Translate;
  locale(): string;
  markdown: MessageMarkdown;
  copy: Omit<CopyDependencies, 'doc' | 't' | 'onCopied'> & { onCopied(button: HTMLElement | null): void };
  setTimer(callback: () => void, ms: number): unknown;
  /** The page's own MCP call buttons for an assistant message. */
  attachMcpCalls(messageDiv: HTMLElement, executionIds: string[]): void;
  /** Keeps the MCP call buttons for later, when the message is still streaming. */
  deferMcpCalls(messageDiv: HTMLElement, executionIds: string[]): void;
  /** Scrolls the transcript for a new message; the page decides how. */
  applyScroll(messagesDiv: HTMLElement, options: AddMessageOptions | null): void;
  /** The welcome subtitle and title, which depend on the project in use. */
  projectName(): string;
  noProjectName(): string;
}

export interface MessageView {
  /** The next number of the transcript's sequence; ids built from it stay unique across messages and progress rows. */
  nextSequence(): number;
  addMessage(role: string, content: string, executionIds?: string[] | null, progressId?: string | null, createdAt?: string | number | Date | null, options?: AddMessageOptions | null): string;
  appendCopyButton(messageDiv: HTMLElement | null): HTMLElement | null;
  ensureMetaFooter(content: HTMLElement | null): HTMLElement | null;
  /** Re-renders the system welcome messages after the language changed. */
  refreshSystemReadyMessages(): void;
  renderWelcomeEmptyState(): HTMLElement | null;
  refreshWelcomeTitle(): void;
  removeMessage(id: string): void;
}

const ERROR_FALLBACK: Record<string, string> = { 'chat.executeFailed': 'Execution failed', 'chat.callOpenAIFailed': 'OpenAI call failed' };

const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

/** Puts each table of a bubble in a scrolling wrapper of its own, unless it has one already. */
export function wrapTablesInBubble(bubble: HTMLElement, doc: Document): void {
  bubble.querySelectorAll('table').forEach(table => {
    if (table.parentElement?.classList.contains('table-wrapper')) return;
    const wrapper = doc.createElement('div');
    wrapper.className = 'table-wrapper';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

export function createMessageView(deps: MessageViewDependencies): MessageView {
  const { doc, t, markdown } = deps;
  const byId = (id: string) => doc.getElementById(id);
  let counter = 0;
  const nextSequence = (): number => ++counter;

  function escapeAndBreak(text: string): string {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function ensureMetaFooter(content: HTMLElement | null): HTMLElement | null {
    if (!content) return null;
    const existing = content.querySelector<HTMLElement>('.message-meta-footer');
    if (existing) return existing;
    const footer = doc.createElement('div');
    footer.className = 'message-meta-footer';
    const timeDiv = content.querySelector<HTMLElement>('.message-time');
    if (timeDiv && timeDiv.parentNode === content) {
      timeDiv.parentNode.insertBefore(footer, timeDiv);
      footer.appendChild(timeDiv);
    } else {
      content.appendChild(footer);
    }
    return footer;
  }

  function appendCopyButton(messageDiv: HTMLElement | null): HTMLElement | null {
    if (!messageDiv?.classList || (!messageDiv.classList.contains('assistant') && !messageDiv.classList.contains('user'))) return null;
    const footer = ensureMetaFooter(messageDiv.querySelector<HTMLElement>('.message-content'));
    if (!footer) return null;

    messageDiv.querySelectorAll('.message-bubble .message-copy-btn').forEach(button => button.remove());
    const existing = footer.querySelector<HTMLElement>('.message-copy-btn');
    if (existing) return existing;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'message-copy-btn';
    button.innerHTML = COPY_ICON + '<span>' + t('common.copy', 'Copy') + '</span>';
    button.title = t('chat.copyMessageTitle', 'Copy message');
    button.setAttribute('aria-label', button.title);
    button.onclick = event => {
      event.stopPropagation();
      copyMessage(messageDiv, button, {
        ...deps.copy,
        doc,
        t,
        onCopied: target => showCopySuccess(target, t, deps.setTimer),
      });
    };
    const deleteButton = footer.querySelector('.message-delete-turn-btn');
    if (deleteButton) footer.insertBefore(button, deleteButton);
    else footer.appendChild(button);
    return button;
  }

  function addMessage(
    role: string,
    content: string,
    executionIds: string[] | null = null,
    progressId: string | null = null,
    createdAt: string | number | Date | null = null,
    options: AddMessageOptions | null = null,
  ): string {
    const messagesDiv = byId('chat-messages');
    if (!messagesDiv) return '';
    const messageDiv = doc.createElement('div');
    const id = 'msg-' + Date.now() + '-' + nextSequence() + '-' + Math.random().toString(36).substr(2, 9);
    messageDiv.id = id;
    messageDiv.className = 'message ' + role;
    messagesDiv.querySelector('.chat-welcome-empty-state')?.remove();

    const contentWrapper = doc.createElement('div');
    contentWrapper.className = 'message-content';
    const bubble = doc.createElement('div');
    bubble.className = 'message-bubble';

    const displayContent = role === 'assistant' ? localizeAssistantError(content, key => t(key, ERROR_FALLBACK[key] ?? key)) : content;
    let formatted: string;
    if (role === 'user') formatted = escapeAndBreak(content);
    else if (markdown.available()) formatted = markdown.format(role === 'assistant' ? displayContent : content);
    else formatted = escapeAndBreak(role === 'assistant' ? displayContent : content);
    bubble.innerHTML = formatted;

    // A resumed run may still hold the server's placeholder text; the node stays for the details and the final answer.
    if (role === 'assistant' && options?.hideAssistantPlaceholder) {
      messageDiv.classList.add('assistant-placeholder-content');
      bubble.hidden = true;
    }
    if (markdown.available()) markdown.stripSuspiciousImages(bubble);
    wrapTablesInBubble(bubble, doc);
    contentWrapper.appendChild(bubble);

    if (role === 'assistant' || role === 'user') messageDiv.dataset.originalContent = content;

    const timeDiv = doc.createElement('div');
    timeDiv.className = 'message-time';
    const moment = messageMoment(createdAt);
    timeDiv.textContent = formatMessageTime(moment, deps.locale());
    try {
      timeDiv.dataset.messageTime = moment.toISOString();
    } catch { /* an invalid date keeps the displayed time only */ }
    const metaFooter = doc.createElement('div');
    metaFooter.className = 'message-meta-footer';
    metaFooter.appendChild(timeDiv);
    contentWrapper.appendChild(metaFooter);
    messageDiv.appendChild(contentWrapper);

    if (role === 'assistant' || role === 'user') appendCopyButton(messageDiv);

    // A streaming placeholder (with a progress id) gets its call buttons when the stream ends.
    if (role === 'assistant' && executionIds && executionIds.length > 0 && !progressId) {
      if (options?.deferMcpButtons) deps.deferMcpCalls(messageDiv, executionIds);
      else deps.attachMcpCalls(messageDiv, executionIds);
    }
    if (options?.systemReadyMessage) messageDiv.setAttribute('data-system-ready-message', '1');

    messagesDiv.appendChild(messageDiv);
    deps.applyScroll(messagesDiv, options);
    return id;
  }

  function renderWelcomeEmptyState(): HTMLElement | null {
    const messagesDiv = byId('chat-messages');
    if (!messagesDiv) return null;
    messagesDiv.querySelectorAll('.chat-welcome-empty-state').forEach(node => node.remove());
    if (messagesDiv.childElementCount) return null;
    const state = doc.createElement('div');
    state.className = 'chat-welcome-empty-state';
    state.setAttribute('role', 'status');
    state.setAttribute('aria-live', 'polite');
    state.innerHTML = '<h2 class="chat-welcome-empty-state-title"></h2><p class="chat-welcome-empty-state-subtitle"></p>';
    updateWelcomeTitle(state.querySelector<HTMLElement>('.chat-welcome-empty-state-title'), deps.projectName(), deps.noProjectName(), t);
    messagesDiv.appendChild(state);
    return state;
  }

  function refreshWelcomeTitle(): void {
    const title = doc.querySelector<HTMLElement>('.chat-welcome-empty-state-title');
    updateWelcomeTitle(title, deps.projectName(), deps.noProjectName(), t);
  }

  function refreshSystemReadyMessages(): void {
    const text = welcomeText(deps.projectName(), deps.noProjectName(), t);
    refreshWelcomeTitle();
    const formatted = markdown.available() ? markdown.format(text) : escapeAndBreak(text);
    doc.querySelectorAll<HTMLElement>('.message.assistant[data-system-ready-message]').forEach(messageDiv => {
      const bubble = messageDiv.querySelector<HTMLElement>('.message-bubble');
      if (!bubble) return;
      bubble.querySelector('.message-copy-btn')?.remove();
      bubble.innerHTML = formatted;
      wrapTablesInBubble(bubble, doc);
      messageDiv.dataset.originalContent = text;
      appendCopyButton(messageDiv);
    });
  }

  return {
    nextSequence,
    addMessage,
    appendCopyButton,
    ensureMetaFooter,
    refreshSystemReadyMessages,
    renderWelcomeEmptyState,
    refreshWelcomeTitle,
    removeMessage(id) {
      byId(id)?.remove();
    },
  };
}
