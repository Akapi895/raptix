// One row of the conversation list: its title, its time, a menu button, and the click that opens the conversation.

import { conversationTitle, truncateTitle } from './text';

export interface RowConversation {
  id?: string;
  title?: string;
  updatedAt?: string | null;
  _timeText?: string;
  [key: string]: unknown;
}

export interface RowDependencies {
  doc: Document;
  /** The conversation on screen, to mark its row as active. */
  activeId(): string | null;
  timeText(conversation: RowConversation): string;
  openConversation(id: string): void;
  openMenu(event: MouseEvent, id: string, title: string): void;
}

export function createConversationRow(conversation: RowConversation, pinned: boolean, deps: RowDependencies): HTMLElement {
  const { doc } = deps;
  const item = doc.createElement('div');
  item.className = 'conversation-item';
  item.dataset.conversationId = String(conversation.id ?? '');
  if (conversation.id === deps.activeId()) item.classList.add('active');

  const content = doc.createElement('div');
  content.className = 'conversation-content';
  content.tabIndex = 0;
  content.setAttribute('role', 'button');
  content.setAttribute('aria-label', conversationTitle(conversation));
  content.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    deps.openConversation(String(conversation.id ?? ''));
  });

  const titleRow = doc.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.gap = '4px';

  const title = doc.createElement('div');
  title.className = 'conversation-title';
  const fullTitle = conversationTitle(conversation);
  title.textContent = truncateTitle(fullTitle, 60);
  title.title = fullTitle;
  titleRow.appendChild(title);

  if (pinned) {
    const pin = doc.createElement('span');
    pin.className = 'conversation-item-pinned';
    pin.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 5-5 3-3 5-5-5 5-3zM8 16l-5 5"/></svg>';
    pin.title = 'Pinned';
    titleRow.appendChild(pin);
  }
  content.appendChild(titleRow);

  const time = doc.createElement('div');
  time.className = 'conversation-time';
  time.textContent = conversation._timeText || deps.timeText(conversation);
  content.appendChild(time);
  item.appendChild(content);

  const menu = doc.createElement('button');
  menu.type = 'button';
  menu.className = 'conversation-item-menu';
  menu.setAttribute('aria-label', 'Conversation actions: ' + fullTitle);
  menu.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
  menu.onclick = event => deps.openMenu(event, String(conversation.id ?? ''), String(conversation.title || ''));
  item.appendChild(menu);

  item.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    const id = String(item.dataset.conversationId || '').trim();
    if (id) deps.openConversation(id);
  };
  return item;
}
