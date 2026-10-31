// The batch manager's dialog: it loads every conversation, draws one row each, keeps the checkboxes and the "select all"
// box in step, and deletes the checked conversations one by one.

import { projectIdOf, projectLabelOf, selectAllState, titleWithCount, truncateName, truncateProject, filterBatchConversations, type BatchConversation } from './manage';

export const BATCH_MODAL_ID = 'batch-manage-modal';
export const BATCH_SELECT_ID = 'batch-project-filter';

export interface BatchDependencies {
  doc: Document;
  t(key: string, fallback: string, values?: Record<string, unknown>): string;
  locale(): string;
  projectNames(): Record<string, string>;
  fetchAllConversations(search: string): Promise<BatchConversation[]>;
  prefetchProjectNames(conversations: BatchConversation[]): Promise<void>;
  initProjectSelect(selectId: string): void;
  refreshProjectSelect(selectId: string): Promise<void>;
  /** The project the conversation list is narrowed to; empty when it shows every project. */
  sidebarProjectFilter(): string;
  closeProjectSelects(): void;
  isModalOpen(id: string): boolean;
  openModal(id: string, options?: { focus?: boolean }): void;
  closeModal(id: string): void;
  requirePermission(permission: string): boolean;
  confirm(text: string): boolean;
  alert(text: string): void;
  deleteConversation(conversationId: string, skipConfirm: boolean): Promise<void>;
  logError(message: string, error: unknown): void;
}

export interface BatchManager {
  show(): Promise<void>;
  close(): void;
  apply(): void;
  filter(): void;
  toggleSelectAll(): void;
  syncSelectAll(): void;
  deleteSelected(): Promise<void>;
  /** A conversation was deleted elsewhere; the dialog, if open, drops it too. */
  forget(conversationId: string): void;
}

export function createBatchManager(deps: BatchDependencies): BatchManager {
  const { doc, t } = deps;
  const byId = (id: string) => doc.getElementById(id);
  let all: BatchConversation[] = [];

  const texts = () => ({
    noProject: t('batchManageModal.noProject', 'No project'),
    unknownProject: t('batchManageModal.unknownProject', 'Unknown project'),
  });

  function labelOf(conversation: BatchConversation): string {
    return projectLabelOf(conversation, deps.projectNames(), texts());
  }

  function updateTitle(count: number): void {
    const title = byId('batch-manage-title');
    if (!title) return;
    const template = t('batchManageModal.title', 'Manage conversations · {{count}} total', { count: '__C__' });
    title.innerHTML = titleWithCount(template, count);
  }

  function syncSelectAll(): void {
    const selectAll = byId('batch-select-all') as HTMLInputElement | null;
    if (!selectAll) return;
    const total = doc.querySelectorAll('.batch-conversation-checkbox').length;
    const checked = doc.querySelectorAll('.batch-conversation-checkbox:checked').length;
    const state = selectAllState(total, checked);
    selectAll.checked = state.checked;
    selectAll.indeterminate = state.indeterminate;
  }

  function renderRows(filtered: BatchConversation[]): void {
    const list = byId('batch-conversations-list');
    if (!list) return;
    list.innerHTML = '';
    filtered.forEach(conversation => {
      const row = doc.createElement('div');
      row.className = 'batch-conversation-row';
      row.dataset.conversationId = String(conversation.id ?? '');

      const checkbox = doc.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'batch-conversation-checkbox theme-checkbox';
      checkbox.dataset.conversationId = String(conversation.id ?? '');
      checkbox.addEventListener('change', () => syncSelectAll());
      const checkboxCol = doc.createElement('div');
      checkboxCol.className = 'batch-table-col-checkbox';
      checkboxCol.appendChild(checkbox);

      const name = doc.createElement('div');
      name.className = 'batch-table-col-name';
      const fullTitle = conversation.title || t('batchManageModal.unnamedConversation', 'Unnamed conversation');
      name.textContent = truncateName(fullTitle);
      name.title = fullTitle;

      const project = doc.createElement('div');
      project.className = 'batch-table-col-project';
      const label = labelOf(conversation);
      project.textContent = truncateProject(label);
      project.title = label;
      if (!projectIdOf(conversation)) project.classList.add('is-unbound');

      const time = doc.createElement('div');
      time.className = 'batch-table-col-time';
      const moment = conversation.updatedAt ? new Date(conversation.updatedAt) : new Date();
      time.textContent = moment.toLocaleString(deps.locale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

      const action = doc.createElement('div');
      action.className = 'batch-table-col-action';
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'batch-delete-btn';
      remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const deleteLabel = t('contextMenu.deleteConversation', 'Delete conversation');
      remove.title = deleteLabel;
      remove.setAttribute('aria-label', deleteLabel);
      remove.onclick = event => {
        event.stopPropagation();
        void deps.deleteConversation(String(conversation.id ?? ''), false);
      };
      action.appendChild(remove);

      row.append(checkboxCol, name, project, time, action);
      list.appendChild(row);
    });
    syncSelectAll();
  }

  function apply(): void {
    const filtered = filterBatchConversations(all, (byId('batch-search-input') as HTMLInputElement | null)?.value ?? '', (byId('batch-project-filter') as HTMLSelectElement | null)?.value ?? '', labelOf);
    updateTitle(filtered.length);
    renderRows(filtered);
  }

  async function show(): Promise<void> {
    try {
      deps.initProjectSelect(BATCH_SELECT_ID);
      all = await deps.fetchAllConversations('');
      await deps.prefetchProjectNames(all);
      await deps.refreshProjectSelect(BATCH_SELECT_ID);
      const sidebar = deps.sidebarProjectFilter();
      const batchSelect = byId(BATCH_SELECT_ID) as HTMLSelectElement | null;
      const names = deps.projectNames();
      if (batchSelect && sidebar && (sidebar === '__none__' || names[sidebar])) batchSelect.value = sidebar;
      const search = byId('batch-search-input') as HTMLInputElement | null;
      if (search) search.value = '';
      apply();
      deps.openModal(BATCH_MODAL_ID, { focus: false });
    } catch (error) {
      deps.logError('Failed to load conversation list:', error);
      deps.initProjectSelect(BATCH_SELECT_ID);
      all = [];
      await deps.refreshProjectSelect(BATCH_SELECT_ID);
      apply();
      deps.openModal(BATCH_MODAL_ID, { focus: false });
    }
  }

  function close(): void {
    deps.closeProjectSelects();
    deps.closeModal(BATCH_MODAL_ID);
    const selectAll = byId('batch-select-all') as HTMLInputElement | null;
    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
    const search = byId('batch-search-input') as HTMLInputElement | null;
    if (search) search.value = '';
    const project = byId(BATCH_SELECT_ID) as HTMLSelectElement | null;
    if (project) project.value = '';
    all = [];
  }

  function toggleSelectAll(): void {
    const selectAll = byId('batch-select-all') as HTMLInputElement | null;
    if (selectAll) selectAll.indeterminate = false;
    doc.querySelectorAll<HTMLInputElement>('.batch-conversation-checkbox').forEach(box => {
      box.checked = selectAll ? selectAll.checked : false;
    });
  }

  async function deleteSelected(): Promise<void> {
    if (!deps.requirePermission('chat:delete')) return;
    const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>('.batch-conversation-checkbox:checked'));
    if (boxes.length === 0) {
      deps.alert(t('batchManageModal.confirmDeleteNone', 'Please select at least one conversation to delete'));
      return;
    }
    const count = boxes.length;
    if (!deps.confirm(t('batchManageModal.confirmDeleteN', 'Delete {{count}} selected conversation(s)? Chat messages cannot be recovered, but recorded vulnerabilities will remain in the vulnerability library.', { count }))) return;
    const ids = boxes.map(box => box.dataset.conversationId ?? '');
    try {
      for (const id of ids) {
        await deps.deleteConversation(id, true);
      }
      const selectAll = byId('batch-select-all') as HTMLInputElement | null;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
    } catch (error) {
      deps.logError('Delete failed:', error);
      deps.alert(t('batchManageModal.deleteFailed', 'Delete failed') + ': ' + (error instanceof Error && error.message ? error.message : 'Unknown error'));
    }
  }

  function forget(conversationId: string): void {
    if (!deps.isModalOpen(BATCH_MODAL_ID)) return;
    all = all.filter(conversation => conversation.id !== conversationId);
    apply();
  }

  return {
    show,
    close,
    apply,
    filter: () => apply(),
    toggleSelectAll,
    syncSelectAll,
    deleteSelected,
    forget,
  };
}
