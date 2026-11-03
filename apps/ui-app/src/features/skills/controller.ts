import { createActions } from '../../ui/actions';
import { messageOf } from './model';
import type { SkillsService } from './service';
import type { SkillsView } from './view';

export interface SkillsControllerDeps {
  service: SkillsService;
  view: SkillsView;
  doc: Document;
  t(key: string, params?: Record<string, string | number>): string;
  can(permission: string): boolean;
  confirm(message: string): boolean;
  notify(message: string, type: 'success' | 'error' | 'info' | 'warning'): void;
  afterRender?(root: HTMLElement): void;
}
export function createSkillsController(deps: SkillsControllerDeps) {
  const { service, view, doc, t, notify } = deps;
  let disposed = false; let active = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false; let unbind: (() => void) | undefined;
  let viewVersion = 0;
  const report = (key: string, error: unknown) => { if (!disposed) notify(`${t(key)}: ${t(messageOf(error))}`, 'error'); };
  const paint = () => { if (disposed) return; view.render(service.state); const list = doc.getElementById('skills-list'); if (list) deps.afterRender?.(list); };
  const api = {
    async load(page = 1, pageSize: number | null = service.state.pageSize): Promise<void> {
      clearTimeout(searchTimer);
      view.clearSearch();
      try { if (await service.load(page, pageSize ?? service.state.pageSize)) paint(); }
      catch (error) { if (!disposed) { report('skills.loadListFailed', error); view.error('skills-list', `${t('skills.loadFailedShort')}: ${t(messageOf(error))}`); } }
    },
    async search(): Promise<void> {
      clearTimeout(searchTimer);
      const keyword = view.value('skills-search').trim();
      try { if (await service.load(1, service.state.pageSize, keyword)) paint(); }
      catch (error) { if (!disposed) { report('skills.searchFailed', error); view.error('skills-list', `${t('skills.searchFailed')}: ${t(messageOf(error))}`); } }
    },
    async refresh(): Promise<void> { await api.load(service.state.page, service.state.pageSize); if (!disposed) notify(t('skills.refreshed'), 'success'); },
    add(): void { if (service.state.saving || !deps.can('skills:write')) return; service.beginCreate(); view.editor(service.state, true); },
    close(): void { if (service.state.saving) return; service.closeEditor(); view.closeEditor(); },
    async edit(id: string): Promise<void> {
      if (service.state.saving || !deps.can('skills:write')) return;
      const pending = service.beginEdit(id); view.editor(service.state, true);
      try { if (await pending) view.editor(service.state); }
      catch (error) { if (!disposed && service.state.editor?.id === id) { api.close(); report('skills.loadDetailFailed', error); } }
    },
    async file(path: string, fresh = false): Promise<void> {
      const editor = service.state.editor; if (!editor || service.state.saving) return;
      if (editor.descriptionDirty && path !== 'SKILL.md') { notify(t('skillModal.saveDescriptionFirst'), 'error'); return; }
      if (!fresh && editor.fileDirty && !deps.confirm(t('skillModal.unsavedSwitch'))) return;
      try { if (await service.selectFile(path, fresh)) view.editor(service.state); }
      catch (error) { if (!disposed) report('skills.loadDetailFailed', error); }
    },
    async save(): Promise<void> {
      if (!deps.can('skills:write')) return;
      try {
        const pending = service.save(); view.busy(service.state.saving);
        const result = await pending; if (disposed || result === 'busy') return;
        notify(t(result === 'created' ? 'skills.createdSuccess' : 'skills.saveSuccess'), 'success');
        if (result === 'created') view.closeEditor(); else view.editor(service.state);
        await api.load(service.state.page, service.state.pageSize);
      } catch (error) { if (!disposed) report('skills.saveFailed', error); }
      finally { if (!disposed) view.busy(false); }
    },
    async remove(id: string): Promise<void> {
      if (!deps.can('skills:delete')) return;
      try {
        const roles = await service.boundRoles(id); if (disposed) return;
        if (!deps.confirm(t(roles.length ? 'skills.deleteConfirmWithRoles' : 'skills.deleteConfirm', { name: id, count: roles.length, roles: roles.join(', ') }))) return;
        const affected = await service.remove(id); if (disposed) return;
        notify(t(affected.length ? 'skills.deleteSuccessWithRoles' : 'skills.deleteSuccess', { count: affected.length, roles: affected.join(', ') }), 'success');
        await api.load(Math.min(service.state.page, Math.max(1, Math.ceil((service.state.total - 1) / service.state.pageSize))), service.state.pageSize);
      } catch (error) { if (!disposed) report('skills.deleteFailed', error); }
    },
    async view(id: string): Promise<void> {
      const version = ++viewVersion;
      try { const skill = await service.detail(id, 'summary'); if (!disposed && version === viewVersion) view.summary(skill, id); }
      catch (error) { if (!disposed) report('skills.viewFailed', error); }
    },
    closeView(): void { viewVersion++; view.closeSummary(); },
    async monitor(): Promise<void> {
      try { await service.loadMonitor(); if (!disposed) view.monitor(service.state); }
      catch (error) { if (!disposed) { report('skills.loadStatsFailed', error); for (const id of ['skills-stats', 'skills-monitor-list']) view.error(id, `${t('skills.loadStatsErrorShort')}: ${t(messageOf(error))}`); } }
    },
    async refreshMonitor(): Promise<void> { await api.monitor(); if (!disposed) notify(t('skills.refreshed'), 'success'); },
    async clearStats(): Promise<void> {
      if (!deps.can('skills:delete') || !deps.confirm(t('skills.clearStatsConfirm'))) return;
      try { await service.clearStats(); if (disposed) return; notify(t('skills.statsCleared'), 'success'); await api.monitor(); }
      catch (error) { if (!disposed) report('skills.clearStatsFailed', error); }
    },
    activate(): void {
      if (active || disposed) return; active = true;
      const actions = createActions();
      const register = (name: string, fn: (el: HTMLElement, event: Event) => void) => actions.register(`skills.${name}`, fn);
      register('refresh', () => { void api.refresh(); }); register('add', api.add); register('close', api.close); register('save', () => { void api.save(); });
      register('clear', () => { void api.load(1); });
      register('searchInput', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { void api.search(); }, 300); });
      register('searchKey', (_el, event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void api.search(); } });
      register('page', el => { void api.load(Number(el.dataset.page)); });
      register('pageSize', el => { void service.changePageSize(Number((el as HTMLSelectElement).value)).then(changed => { if (changed) { view.clearSearch(); paint(); } }).catch(error => report('skills.loadListFailed', error)); });
      register('view', el => { void api.view(el.dataset.id ?? ''); }); register('edit', el => { void api.edit(el.dataset.id ?? ''); }); register('delete', el => { void api.remove(el.dataset.id ?? ''); });
      register('closeView', api.closeView); register('viewEdit', el => { api.closeView(); void api.edit(el.dataset.id ?? ''); });
      register('full', el => {
        const version = viewVersion; const button = el as HTMLButtonElement; button.disabled = true;
        void service.detail(el.dataset.id ?? '', 'full').then(skill => { if (!disposed && version === viewVersion) view.fullBody(skill.content ?? ''); }).catch(error => { if (!disposed) report('skills.loadFullFailed', error); }).finally(() => { button.disabled = false; });
      });
      register('file', el => { void api.file(el.dataset.path ?? ''); });
      register('fileKey', (el, event) => { if (['Enter', ' '].includes((event as KeyboardEvent).key)) { event.preventDefault(); void api.file(el.dataset.path ?? ''); } });
      register('newFile', () => { const path = view.value('skill-new-file-path').trim(); if (!path) { notify(t('skillModal.newFilePathRequired'), 'error'); return; } void api.file(path, true); view.clearNewPath(); });
      register('field', el => { const field = el.dataset.field; if (field === 'name' || field === 'description' || field === 'content') service.updateEditor(field, (el as HTMLInputElement).value); });
      register('refreshMonitor', () => { void api.refreshMonitor(); }); register('clearStats', () => { void api.clearStats(); });
      unbind = view.bind(actions);
      doc.addEventListener('languagechange', language);
      doc.addEventListener('click', backdrop);
      refreshTimer = setInterval(() => {
        if (disposed || refreshing || !view.isPageActive() || service.state.saving || service.state.editor || view.editorOpen() || service.state.search || view.value('skills-search').trim()) return;
        refreshing = true; void api.load(service.state.page).finally(() => { refreshing = false; });
      }, 5000);
    },
    dispose(): void { if (disposed) return; disposed = true; viewVersion++; clearTimeout(searchTimer); clearInterval(refreshTimer); unbind?.(); doc.removeEventListener('languagechange', language); doc.removeEventListener('click', backdrop); service.dispose(); },
  };
  function language(): void { paint(); view.renderTree(service.state); view.monitor(service.state); }
  function backdrop(event: Event): void { if (event.target === doc.getElementById('skill-modal')) api.close(); if (event.target === doc.getElementById('skill-view-modal')) api.closeView(); }
  return api;
}
