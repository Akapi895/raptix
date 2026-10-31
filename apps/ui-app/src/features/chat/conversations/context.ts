// The conversation's context menu and what it does: rename (in an in-app dialog, since embedded browsers block prompts),
// pin, export as Markdown, open the vulnerabilities of the conversation, the attack chain, and delete.

import { attackChainEntry, placeContextMenu, type Point } from './menu-placement';
import { conversationToMarkdown, markdownFileName, type ExportConversation } from './markdown';

export const RENAME_MODAL_ID = 'conversation-rename-modal';
const SUBMENU_HIDE_DELAY_MS = 120;

export interface ContextMenuDependencies {
  doc: Document;
  t(key: string, fallback: string): string;
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  locale(): string;
  alert(text: string): void;
  confirm(text: string): boolean;
  requirePermission(permission: string): boolean;
  openModal(id: string, options?: { focusEl?: HTMLElement | null }): void;
  closeModal(id: string): void;
  applyTranslations(root: HTMLElement): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  viewport(): Point & { width: number; height: number };
  isRunning(conversationId: string): boolean;
  reloadList(): Promise<void>;
  refreshProjectFolders(): Promise<void>;
  updateActiveTaskTitle(conversationId: string, title: string): void;
  deleteConversation(conversationId: string, skipConfirm: boolean): Promise<void>;
  showAttackChain(conversationId: string): void;
  isPinned(conversationId: string): Promise<boolean>;
  notifyPinChanged(conversationId: string, pinned: boolean): void;
  download(blob: Blob, fileName: string): void;
  navigateHash(hash: string): void;
  fetchConversation(conversationId: string, includeDetails: boolean): Promise<ExportConversation>;
}

export interface ContextMenuController {
  /** Opens the menu for a conversation at the pointer of the event. */
  open(event: MouseEvent, conversationId: string, title: string): Promise<void>;
  close(): void;
  rename(): void;
  closeRename(): void;
  saveRename(): Promise<void>;
  pin(): Promise<void>;
  downloadMarkdown(includeToolDetails: boolean): Promise<void>;
  openVulnerabilities(): void;
  openAttackChain(): void;
  deleteFromMenu(): void;
  hideSubmenu(): void;
  /** Keeps the submenu open: cancels a hide that is waiting to run. */
  cancelSubmenuHide(): void;
  showSubmenu(): void;
  leaveSubmenu(event: MouseEvent | null): void;
}

export function createContextMenu(deps: ContextMenuDependencies): ContextMenuController {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);
  let conversationId: string | null = null;
  let conversationTitle = '';
  let renameTargetId: string | null = null;
  let submenuTimer: unknown = null;

  function clearSubmenuTimer(): void {
    if (!submenuTimer) return;
    deps.clearTimer(submenuTimer);
    submenuTimer = null;
  }

  function setPinText(pinned: boolean): void {
    const element = byId('pin-conversation-menu-text');
    if (!element) return;
    element.textContent = pinned ? t('contextMenu.unpinConversation', 'Unpin') : t('contextMenu.pinConversation', 'Pin conversation');
  }

  async function refreshPinText(id: string | null): Promise<void> {
    if (!id) {
      setPinText(false);
      return;
    }
    try {
      setPinText(await deps.isPinned(id));
    } catch (error) {
      console.error('Failed to get conversation pin status:', error);
    }
  }

  function setAttackChainEntry(id: string | null): void {
    const item = byId('attack-chain-menu-item') as HTMLElement | null;
    if (!item) return;
    const entry = attackChainEntry(id ?? '', id ? deps.isRunning(id) : false, {
      running: 'A task is running in this conversation; generate the attack chain later',
      view: t('chat.viewAttackChainCurrentConv', 'View attack chain of current conversation'),
      selectFirst: t('chat.viewAttackChainSelectConv', 'Please select a conversation to view attack chain'),
    });
    item.style.opacity = entry.enabled ? '1' : '0.5';
    item.style.cursor = entry.enabled ? 'pointer' : 'not-allowed';
    item.onclick = entry.enabled ? () => deps.showAttackChain(id as string) : null;
    item.title = entry.title;
  }

  function close(): void {
    const menu = byId('conversation-context-menu');
    if (menu) menu.style.display = 'none';
    const submenu = byId('download-markdown-submenu');
    if (submenu) submenu.style.display = 'none';
  }

  async function open(event: MouseEvent, id: string, title: string): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    conversationId = id;
    conversationTitle = title;
    const menu = byId('conversation-context-menu') as HTMLElement | null;
    if (!menu) return;
    const submenu = byId('download-markdown-submenu') as HTMLElement | null;
    if (submenu) submenu.style.display = 'none';
    clearSubmenuTimer();
    setPinText(false);
    setAttackChainEntry(id);

    // The menu shows first; the pin state follows, so a slow request does not look like a dead click.
    menu.style.display = 'block';
    menu.style.visibility = 'visible';
    menu.style.opacity = '1';
    void menu.offsetHeight;
    const size = menu.getBoundingClientRect();
    const placed = placeContextMenu({ x: event.clientX, y: event.clientY }, { width: size.width, height: size.height }, deps.viewport());
    menu.style.left = placed.left + 'px';
    menu.style.top = placed.top + 'px';
    if (submenu) {
      submenu.style.left = placed.submenuSide === 'left' ? 'auto' : '100%';
      submenu.style.right = placed.submenuSide === 'left' ? '100%' : 'auto';
      submenu.style.marginLeft = placed.submenuSide === 'left' ? '0' : '4px';
      submenu.style.marginRight = placed.submenuSide === 'left' ? '4px' : '0';
    }
    const closeOnOutsideClick = (clickEvent: MouseEvent) => {
      const submenuEl = byId('download-markdown-submenu');
      const target = clickEvent.target as Node | null;
      const inside = (target && menu.contains(target)) || (target && submenuEl?.contains(target));
      if (!inside) {
        close();
        doc.removeEventListener('click', closeOnOutsideClick);
      }
    };
    deps.setTimer(() => doc.addEventListener('click', closeOnOutsideClick), 0);
    void refreshPinText(id);
  }

  function hideSubmenu(): void {
    clearSubmenuTimer();
    submenuTimer = deps.setTimer(() => {
      const submenu = byId('download-markdown-submenu');
      if (submenu) submenu.style.display = 'none';
      submenuTimer = null;
    }, SUBMENU_HIDE_DELAY_MS);
  }

  function showSubmenu(): void {
    clearSubmenuTimer();
    const submenu = byId('download-markdown-submenu');
    if (submenu) submenu.style.display = 'block';
  }

  function leaveSubmenu(event: MouseEvent | null): void {
    const submenu = byId('download-markdown-submenu');
    const related = event?.relatedTarget as Node | null | undefined;
    if (submenu && related && submenu.contains(related)) return;
    hideSubmenu();
  }

  function ensureRenameModal(): HTMLElement {
    const existing = byId(RENAME_MODAL_ID) as HTMLElement | null;
    if (existing) return existing;
    const modal = doc.createElement('div');
    modal.id = RENAME_MODAL_ID;
    modal.className = 'modal-overlay projects-modal-overlay';
    modal.style.display = 'none';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'conversation-rename-title');
    modal.innerHTML = `
        <div class="projects-modal-dialog">
            <div class="projects-modal-header">
                <div class="projects-modal-header-text">
                    <div>
                        <h3 id="conversation-rename-title" data-i18n="chat.renameConversationTitle">Rename conversation</h3>
                        <p class="projects-modal-subtitle" data-i18n="chat.renameConversationSubtitle">The new name syncs to project folders and recent conversations</p>
                    </div>
                </div>
                <button type="button" class="projects-modal-close" data-conversation-rename-close aria-label="Close" data-i18n="common.close" data-i18n-attr="aria-label" data-i18n-skip-text="true">&times;</button>
            </div>
            <div class="projects-modal-body">
                <div class="projects-form-field">
                    <label for="conversation-rename-input" data-i18n="chat.conversationTitleLabel">Conversation name</label>
                    <input type="text" id="conversation-rename-input" class="form-input" maxlength="200" autocomplete="off" data-i18n="chat.conversationTitlePlaceholder" data-i18n-attr="placeholder" placeholder="Enter a conversation name">
                </div>
            </div>
            <div class="projects-modal-footer">
                <button class="btn-secondary" type="button" data-conversation-rename-close data-i18n="common.cancel">Cancel</button>
                <button class="btn-primary" type="button" id="conversation-rename-submit" data-i18n="contextMenu.rename">Rename</button>
            </div>
        </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal) closeRename();
    });
    modal.querySelectorAll('[data-conversation-rename-close]').forEach(button => button.addEventListener('click', () => closeRename()));
    modal.querySelector('#conversation-rename-submit')?.addEventListener('click', () => { void saveRename(); });
    modal.querySelector('#conversation-rename-input')?.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter') {
        event.preventDefault();
        void saveRename();
      } else if (key === 'Escape') {
        closeRename();
      }
    });
    doc.body.appendChild(modal);
    deps.applyTranslations(modal);
    return modal;
  }

  function rename(): void {
    const id = conversationId;
    if (!id) return;
    renameTargetId = id;
    ensureRenameModal();
    const input = byId('conversation-rename-input') as HTMLInputElement | null;
    if (input) input.value = conversationTitle || '';
    close();
    deps.openModal(RENAME_MODAL_ID, { focusEl: input });
    if (input) input.select();
  }

  function closeRename(): void {
    renameTargetId = null;
    deps.closeModal(RENAME_MODAL_ID);
  }

  async function saveRename(): Promise<void> {
    const id = renameTargetId;
    const input = byId('conversation-rename-input') as HTMLInputElement | null;
    const title = (input?.value || '').trim();
    if (!id || !title) {
      input?.focus();
      return;
    }
    const submit = byId('conversation-rename-submit') as HTMLButtonElement | null;
    if (submit) submit.disabled = true;
    try {
      const response = await deps.apiFetch(`/api/conversations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error || 'Update failed');
      }
      doc.querySelectorAll<HTMLElement>('[data-conversation-id]').forEach(item => {
        if (item.dataset.conversationId !== id) return;
        item.querySelectorAll<HTMLElement>('.conversation-title, .project-conversation-title').forEach(element => {
          element.textContent = title;
          element.title = title;
        });
      });
      deps.updateActiveTaskTitle(id, title);
      await deps.reloadList();
      await deps.refreshProjectFolders();
      closeRename();
    } catch (error) {
      console.error('Failed to rename conversation:', error);
      deps.alert(t('chat.renameFailed', 'Rename failed') + ': ' + (error instanceof Error && error.message ? error.message : 'Unknown error'));
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function pin(): Promise<void> {
    const id = conversationId;
    if (!id) return;
    close();
    try {
      const response = await deps.apiFetch(`/api/conversations/${id}`);
      if (!response.ok) throw new Error('Failed to load the conversation');
      const conversation = await response.json() as { pinned?: boolean };
      const pinned = !conversation.pinned;
      const update = await deps.apiFetch(`/api/conversations/${id}/pinned`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
      if (!update.ok) throw new Error('Failed to update the pin status');
      deps.notifyPinChanged(id, pinned);
      void deps.reloadList();
    } catch (error) {
      console.error('Failed to pin conversation:', error);
      deps.alert('Pin failed: ' + (error instanceof Error && error.message ? error.message : 'Unknown error'));
    }
  }

  async function downloadMarkdown(includeToolDetails: boolean): Promise<void> {
    const id = conversationId;
    if (!id) return;
    try {
      const conversation = await deps.fetchConversation(id, includeToolDetails);
      const markdown = conversationToMarkdown(conversation, { includeToolDetails }, deps.locale());
      deps.download(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), markdownFileName(conversation, { includeToolDetails }));
    } catch (error) {
      console.error('Failed to download conversation Markdown:', error);
      deps.alert(t('chat.downloadConversationFailed', 'Failed to download conversation') + ': ' + (error instanceof Error && error.message ? error.message : 'unknown error'));
    }
    close();
  }

  function openVulnerabilities(): void {
    const id = conversationId;
    close();
    if (!id) return;
    deps.navigateHash('vulnerabilities?conversation_id=' + encodeURIComponent(id));
  }

  function openAttackChain(): void {
    const id = conversationId;
    if (!id) return;
    close();
    deps.showAttackChain(id);
  }

  function deleteFromMenu(): void {
    if (!deps.requirePermission('chat:delete')) return;
    const id = conversationId;
    if (!id) return;
    if (deps.confirm(t('chat.deleteConversationConfirm', 'Delete this conversation? Chat messages cannot be recovered, but recorded vulnerabilities will remain in the vulnerability library.'))) {
      void deps.deleteConversation(id, true);
    }
    close();
  }

  return {
    open,
    close,
    rename,
    closeRename,
    saveRename,
    pin,
    downloadMarkdown,
    openVulnerabilities,
    openAttackChain,
    deleteFromMenu,
    hideSubmenu,
    showSubmenu,
    leaveSubmenu,
    cancelSubmenuHide: clearSubmenuTimer,
  };
}
