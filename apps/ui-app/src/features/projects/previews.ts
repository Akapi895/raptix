import { projectsBrowser as browser } from '../../platform/projects-browser';
import type { ProjectsContext } from './context';
import type { ProjectFoldersService } from './folder-service';
import type { Project, ProjectConversation } from './types';

export type FolderProject = Pick<Project, 'id' | 'name' | 'description' | 'scope_json' | 'pinned'> & { unassigned?: boolean };
const clamp = (value: string, max = 220) => { const text = value.replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
export function getProjectScopePreview(project: FolderProject): string {
  const raw = (project.scope_json || '').trim(); if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw), values: string[] = [];
    const append = (value: unknown) => { if (typeof value === 'string' || typeof value === 'number') { const text = String(value).trim(); if (text) values.push(text); } else if (Array.isArray(value)) value.slice(0, 4).forEach(append); };
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>; for (const key of ['targets', 'target', 'domains', 'ips', 'urls', 'scope']) append(record[key]); if (!values.length) append(record.notes);
    } else append(parsed);
    return clamp(values.slice(0, 4).join(' · '));
  } catch { return clamp(raw); }
}
export const folderIcon = (open: boolean) => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${open ? 'M3.5 18V6.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1.25M3.5 18l1.75-6.25A2 2 0 0 1 7.18 10.3H20.5l-2 7.7H3.5Z' : 'M3.5 7a2 2 0 0 1 2-2h4l2 2H18.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Zm0 2.5h17'}" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const infoIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const scopeIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
export function createProjectPreviews(ctx: ProjectsContext, folders: ProjectFoldersService) {
  const { dom, deps } = ctx;
  let openTimer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined;
  let anchor: HTMLElement | null = null, suppressedUntil = 0;
  const created = new Set<HTMLElement>();
  function hide() {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    for (const id of ['project-folder-preview', 'project-conversation-preview']) dom.hidden(id, true);
    anchor?.querySelector('.project-folder-item')?.removeAttribute('aria-controls'); anchor?.querySelector('.project-conversation-item')?.removeAttribute('aria-describedby'); anchor = null;
  }
  const laterHide = () => { clearTimeout(openTimer); clearTimeout(closeTimer); closeTimer = setTimeout(hide, 120); };
  function ensure(kind: 'folder' | 'conversation') {
    const id = `project-${kind}-preview`; let preview = dom.el(id); if (preview) return preview;
    preview = dom.document.createElement('div'); preview.id = id; preview.className = id; preview.hidden = true; preview.setAttribute('role', kind === 'folder' ? 'dialog' : 'tooltip');
    if (kind === 'folder') {
      preview.setAttribute('aria-label', dom.fmt('chat.projectPreviewLabel', 'Project information'));
      preview.innerHTML = `<div class="project-folder-preview-header"><span class="project-folder-preview-icon" aria-hidden="true">${folderIcon(false)}</span><span class="project-folder-preview-title"></span></div><div class="project-folder-preview-stats"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/></svg><span></span></div><div class="project-folder-preview-details"><div class="project-folder-preview-detail project-folder-preview-description">${infoIcon}<span></span></div><div class="project-folder-preview-detail project-folder-preview-scope">${scopeIcon}<span></span></div></div><button type="button" class="project-folder-preview-edit" data-require-permission="project:write">${scopeIcon}<span></span></button>`;
      const current = preview;
      preview.querySelector('button')?.addEventListener('click', () => { const id = current.dataset.projectId; hide(); if (id) ctx.run(() => ctx.showEditProject(id, { fromChatSidebar: true })); });
      preview.addEventListener('mouseenter', () => clearTimeout(closeTimer)); preview.addEventListener('mouseleave', laterHide);
    } else preview.innerHTML = `<div class="project-conversation-preview-header"><span class="project-conversation-preview-title"></span><span class="project-conversation-preview-age"></span></div><div class="project-conversation-preview-meta">${folderIcon(false)}<span class="project-conversation-preview-project"></span></div><div class="project-conversation-preview-meta"><span class="project-conversation-preview-role"></span><span class="project-conversation-preview-separator" aria-hidden="true">·</span><span class="project-conversation-preview-status"></span></div>`;
    dom.document.body.append(preview); created.add(preview); return preview;
  }
  function position(preview: HTMLElement, row: HTMLElement, adjustment: number) {
    const rect = row.getBoundingClientRect(), size = preview.getBoundingClientRect(), viewport = browser.viewport();
    preview.style.left = `${Math.round(rect.right + 10 + size.width > viewport.width - 12 ? Math.max(12, rect.left - size.width - 10) : rect.right + 10)}px`;
    preview.style.top = `${Math.round(Math.min(Math.max(12, rect.top - adjustment), Math.max(12, viewport.height - size.height - 12)))}px`;
  }
  function set(preview: HTMLElement, selector: string, text: string) { const node = preview.querySelector(selector); if (node) node.textContent = text; }
  function showFolder(project: FolderProject, row: HTMLElement, conversations: ProjectConversation[]) {
    if (!row.isConnected || !browser.canPreview()) return; hide(); const preview = ensure('folder'); anchor = row;
    const active = conversations.filter(item => folders.state.runningIds.has(item.id)).length, scope = getProjectScopePreview(project);
    preview.dataset.projectId = project.id; preview.classList.toggle('is-unassigned', !!project.unassigned);
    set(preview, '.project-folder-preview-title', project.name || dom.t('common.untitled'));
    set(preview, '.project-folder-preview-stats span', dom.fmt('chat.projectPreviewStats', `${conversations.length} tasks · ${active} active`, { total: conversations.length, active }));
    set(preview, '.project-folder-preview-description span', clamp(project.description || '') || dom.fmt('chat.projectPreviewNoDescription', 'No project description')); preview.querySelector('.project-folder-preview-description')?.classList.toggle('is-empty', !project.description?.trim());
    const scopeRow = preview.querySelector<HTMLElement>('.project-folder-preview-scope'); if (scopeRow) scopeRow.hidden = !!project.unassigned || !scope;
    set(preview, '.project-folder-preview-scope span', scope ? dom.fmt('chat.projectPreviewScope', `Scope: ${scope}`, { scope }) : '');
    const edit = preview.querySelector<HTMLElement>('.project-folder-preview-edit'); if (edit) edit.hidden = !!project.unassigned;
    set(preview, '.project-folder-preview-edit span', dom.fmt('chat.projectPreviewEdit', 'Edit project')); preview.hidden = false; row.querySelector('.project-folder-item')?.setAttribute('aria-controls', preview.id); position(preview, row, 10); deps.applyRBAC(preview);
  }
  function showConversation(item: ProjectConversation, project: FolderProject, row: HTMLElement) {
    if (!row.isConnected || !browser.canPreview() || Date.now() < suppressedUntil) return; hide(); const preview = ensure('conversation'); anchor = row;
    const running = folders.state.runningIds.has(item.id), approval = folders.state.pending.has(item.id), unread = !running && folders.isUnread(item.id), completed = folders.state.completed.has(item.id);
    set(preview, '.project-conversation-preview-title', item.title || dom.t('projects.untitledConversation'));
    const date = new Date(item.updatedAt || item.updated_at || item.createdAt || item.created_at || '');
    let age = ''; if (!Number.isNaN(date.getTime())) { const pad = (n: number) => String(n).padStart(2, '0'); const parts = { year: String(date.getFullYear()), month: pad(date.getMonth() + 1), day: pad(date.getDate()), hour: pad(date.getHours()), minute: pad(date.getMinutes()) }; age = dom.fmt('chat.conversationPreviewDateTime', `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`, parts); }
    set(preview, '.project-conversation-preview-age', age); const ageElement = preview.querySelector<HTMLElement>('.project-conversation-preview-age'); if (ageElement) ageElement.hidden = !age;
    set(preview, '.project-conversation-preview-project', project.name || dom.t('chat.conversationPreviewNoProject'));
    set(preview, '.project-conversation-preview-role', clamp(item.roleName || item.role_name || dom.fmt('chat.defaultRole', 'Default'), 80));
    set(preview, '.project-conversation-preview-status', dom.t(approval ? 'hitl.waitingApprovalShort' : running ? 'tasks.statusRunning' : unread ? 'chat.conversationPreviewUnread' : completed ? 'chat.conversationPreviewViewed' : 'chat.conversationPreviewConversation'));
    const status = preview.querySelector('.project-conversation-preview-status'); if (status) status.className = 'project-conversation-preview-status' + (approval ? ' is-approval' : running ? ' is-running' : unread ? ' is-unread' : '');
    preview.hidden = false; row.querySelector('.project-conversation-item')?.setAttribute('aria-describedby', preview.id); position(preview, row, 8);
  }
  function bind(row: HTMLElement, button: HTMLElement, show: () => void, conversation: boolean) {
    const schedule = (immediate = false) => { if (conversation && Date.now() < suppressedUntil) return; clearTimeout(openTimer); clearTimeout(closeTimer); openTimer = setTimeout(show, immediate ? 0 : 160); };
    row.addEventListener('mouseenter', () => schedule()); row.addEventListener('mouseleave', laterHide); button.addEventListener('focus', () => schedule(true));
    row.addEventListener('focusout', event => { if (event.relatedTarget instanceof Node && (row.contains(event.relatedTarget) || (!conversation && dom.el('project-folder-preview')?.contains(event.relatedTarget)))) return; laterHide(); });
  }
  const cleanups = [browser.on('resize', hide), browser.on('scroll', hide, true)];
  return { hide, suppress() { suppressedUntil = Date.now() + 700; hide(); },
    bindFolder: (row: HTMLElement, button: HTMLElement, project: FolderProject, conversations: ProjectConversation[]) => bind(row, button, () => showFolder(project, row, conversations), false),
    bindConversation: (row: HTMLElement, button: HTMLElement, item: ProjectConversation, project: FolderProject) => bind(row, button, () => showConversation(item, project, row), true),
    dispose() { hide(); cleanups.forEach(cleanup => cleanup()); created.forEach(element => element.remove()); },
  };
}
