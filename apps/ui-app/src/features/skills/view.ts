import type { Actions } from '../../ui/actions';
import { capabilityState, capabilityTable, openCapabilityModal } from '../../ui/capabilities';
import { escapeAttr as a, escapeHtml as h } from '../../ui/format';
import { closeAppModal, isAppModalOpen, syncAppModalBodyLock } from '../../ui/modal';
import type { Skill, SkillsState } from './model';

export interface SkillsViewDeps {
  doc: Document;
  t(key: string, params?: Record<string, string | number>): string;
  initPaginationSelects?(root: HTMLElement): void;
}
/** DOM only. API calls, editor state, debounce and refresh timers belong to service/controller. */
export function createSkillsView({ doc, t, initPaginationSelects }: SkillsViewDeps) {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T | null;
  let resize: ResizeObserver | undefined;
  const text = (id: string, value: string | number) => { const node = byId(id); if (node) node.textContent = String(value); };
  const show = (id: string, visible: boolean, display = 'block') => { const node = byId(id); if (node) node.style.display = visible ? display : 'none'; };
  const setValue = (id: string, value: string) => { const node = byId<HTMLInputElement | HTMLTextAreaElement>(id); if (node) node.value = value; };
  const disabled = (id: string, value: boolean) => { const node = byId<HTMLInputElement>(id); if (node) node.disabled = value; };
  const button = (label: string, action: string, extra = '') => `<button type="button" class="${action === 'viewEdit' ? 'btn-primary' : 'btn-secondary'}${['view', 'edit', 'delete'].includes(action) ? ` btn-small${action === 'delete' ? ' btn-danger' : ''}` : ''}" data-action="skills.${action}" ${extra}>${h(label)}</button>`;

  function render(state: Readonly<SkillsState>): void {
    const list = byId('skills-list');
    if (list) list.innerHTML = state.skills.length ? capabilityTable('Installed skill packages', ['Skill', 'Version', 'Tags', 'Package', 'Actions'], state.skills.map(skill => {
      const id = a(skill.id || skill.name);
      const meta = [skill.file_count !== undefined ? t('skills.cardFiles', { count: skill.file_count }) : '', skill.script_count !== undefined ? t('skills.cardScripts', { count: skill.script_count }) : ''].filter(Boolean);
      const tags = (skill.tags ?? []).filter(Boolean);
      return `<tr class="skill-card"><td class="cap-primary-cell"><strong>${h(skill.name || skill.id || '')}</strong><p class="cap-row-description">${h(skill.description || t('skills.noDescription'))}</p></td><td>${h(skill.version || '—')}</td><td><div class="cap-tags">${tags.length ? tags.map(tag => `<span>${h(tag)}</span>`).join('') : '—'}</div></td><td>${meta.length ? meta.map(value => `<div>${h(value)}</div>`).join('') : '<span title="Package counts are not reported by the server">Not reported</span>'}</td><td><div class="cap-row-actions">${button(t('common.view'), 'view', `data-id="${id}"`)}${button(t('common.edit'), 'edit', `data-id="${id}" data-require-permission="skills:write"`)}${button(t('common.delete'), 'delete', `data-id="${id}" data-require-permission="skills:delete"`)}</div></td></tr>`;
    }).join('')) : capabilityState(t(state.search ? 'skills.noMatch' : 'skills.noSkills'), state.search ? 'Try another keyword or clear the search.' : 'Create a skill to add reusable instructions and package files.', state.search ? button('Clear search', 'clear') : '');
    text('skills-current-count', state.skills.length);
    text('skills-file-count', state.skills.length && state.skills.every(skill => skill.file_count !== undefined) ? state.skills.reduce((sum, skill) => sum + (skill.file_count ?? 0), 0) : '—');
    text('skills-script-count', state.skills.length && state.skills.every(skill => skill.script_count !== undefined) ? state.skills.reduce((sum, skill) => sum + (skill.script_count ?? 0), 0) : '—');
    const total = byId('skills-management-stats')?.querySelector('.skill-stat-value'); if (total) total.textContent = String(state.total);
    const clear = byId('skills-search-clear'); if (clear) clear.style.display = state.search ? 'block' : 'none';
    const pagination = byId('skills-pagination'); resize?.disconnect();
    if (!pagination) return;
    if (state.search || !state.total) { pagination.innerHTML = ''; return; }
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const nav = (key: string, page: number, off: boolean) => button(t(`skillsPage.${key}`), 'page', `data-page="${page}" ${off ? 'disabled data-state-disabled="true" aria-disabled="true"' : ''}`);
    pagination.innerHTML = `<div class="pagination"><div class="pagination-info"><span>${h(t('skillsPage.paginationShow', { start: (state.page - 1) * state.pageSize + 1, end: Math.min(state.page * state.pageSize, state.total), total: state.total }))}</span><label class="pagination-page-size">${h(t('skillsPage.perPageLabel'))}<select id="skills-page-size-pagination" data-change="skills.pageSize">${[10, 20, 50, 100].map(size => `<option value="${size}" ${size === state.pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label></div>${pages > 1 ? `<div class="pagination-controls">${nav('firstPage', 1, state.page === 1)}${nav('prevPage', state.page - 1, state.page === 1)}<span class="pagination-page">${h(t('skillsPage.pageOf', { current: state.page, total: pages }))}</span>${nav('nextPage', state.page + 1, state.page >= pages)}${nav('lastPage', pages, state.page >= pages)}</div>` : ''}</div>`;
    initPaginationSelects?.(pagination);
    const align = () => { pagination.style.width = list && list.scrollHeight > list.clientHeight && list.clientWidth > 0 ? `${list.clientWidth}px` : '100%'; };
    align();
    if (list && typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(align); resize.observe(list); }
    pagination.style.display = 'block'; pagination.style.visibility = 'visible';
  }
  function renderTree(state: Readonly<SkillsState>): void {
    const tree = byId('skill-package-tree'); const editor = state.editor;
    if (!tree || !editor) return;
    const rows = editor.files.filter(file => file.path && file.path !== '.').sort((x, y) => x.path.localeCompare(y.path));
    tree.innerHTML = rows.length ? rows.map(file => {
      const indent = 8 + (file.path.replace(/\/$/, '').match(/\//g)?.length ?? 0) * 14;
      return `<div class="skill-tree-row ${file.is_dir ? 'skill-tree-dir' : `skill-tree-file${file.path === editor.path ? ' is-selected' : ''}`}" style="padding-left:${indent}px" ${file.is_dir ? `title="${a(t('skillModal.folderHint'))}"` : `data-action="skills.file" data-path="${a(file.path)}" role="button" tabindex="0" data-keydown="skills.fileKey" title="${a(t('skillModal.clickToEdit'))}"`}><span class="skill-tree-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="${file.is_dir ? 'M3 7V4h6l3 3h9v13H3Z' : 'M5 3h9l5 5v13H5ZM14 3v6h5'}"/></svg></span><span class="skill-tree-label">${h(file.path + (file.is_dir && !file.path.endsWith('/') ? '/' : ''))}</span></div>`;
    }).join('') : `<div class="empty-state" style="padding:8px">${h(t('skillModal.noPackageFiles'))}</div>`;
  }
  function editor(state: Readonly<SkillsState>, open = false): void {
    const value = state.editor; if (!value) return;
    text('skill-modal-title', t(value.id ? 'skills.editSkill' : 'skills.addSkill'));
    setValue('skill-name', value.name); setValue('skill-description', value.description);
    setValue(value.id ? 'skill-content' : 'skill-content-add', value.content);
    disabled('skill-name', !!value.id || value.loading);
    disabled('skill-description', value.path !== 'SKILL.md' || value.loading);
    disabled('skill-content', value.loading);
    show('skill-package-editor', !!value.id); show('skill-add-editor', !value.id);
    show('skill-body-hint-edit', value.path === 'SKILL.md'); text('skill-active-path', value.path);
    renderTree(state); busy(state.saving || value.loading);
    if (open) openCapabilityModal(byId('skill-modal'), { focus: !value.loading });
  }
  function busy(value: boolean): void {
    const node = byId('skill-modal')?.querySelector<HTMLButtonElement>('.btn-primary');
    if (node) { node.disabled = value; node.dataset.stateDisabled = String(value); node.setAttribute('aria-disabled', String(value)); node.textContent = t(value ? 'skills.saving' : 'common.save'); }
    const editor = byId('skill-modal');
    for (const input of editor?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea') ?? []) {
      const locked = value || (input.id === 'skill-name' && byId('skill-package-editor')?.style.display !== 'none') || (input.id === 'skill-description' && byId('skill-active-path')?.textContent !== 'SKILL.md');
      input.disabled = locked; input.dataset.stateDisabled = String(locked); input.setAttribute('aria-disabled', String(locked));
    }
  }
  function summary(skill: Skill, id: string): void {
    closeSummary(); const modal = doc.createElement('div'); modal.id = 'skill-view-modal'; modal.className = 'modal capabilities-modal';
    modal.innerHTML = `<div class="modal-content" style="max-width:900px;max-height:90vh"><div class="modal-header"><h2>${h(t('skills.viewSkillTitle', { name: skill.name || id }))}</h2><span class="modal-close" data-action="skills.closeView">&times;</span></div><div class="modal-body" style="overflow-y:auto;max-height:calc(90vh - 120px)">${skill.version ? `<div><strong>${h(t('skills.versionLabel'))}</strong> ${h(skill.version)}</div>` : ''}${skill.description ? `<div style="margin-bottom:16px"><strong>${h(t('skills.descriptionLabel'))}</strong> ${h(skill.description)}</div>` : ''}${skill.scripts?.length ? `<div><strong>${h(t('skills.scriptsHeading'))}</strong><ul>${skill.scripts.map(script => `<li><code>${h(script.rel_path ?? script.RelPath ?? '')}</code> ${h(script.description ?? script.Description ?? '')}</li>`).join('')}</ul></div>` : ''}<div><strong>${h(t('skills.pathLabel'))}</strong> ${h(skill.path ?? '')}</div><div><strong>${h(t('skills.modTimeLabel'))}</strong> ${h(skill.mod_time ?? skill.updated_at ?? '')}</div><div><strong>${h(t('skills.contentLabel'))}</strong> <span style="opacity:.8;font-size:12px">${h(t('skills.summaryHint'))}</span></div><pre id="skill-view-body" style="padding:16px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word;border:1px solid var(--border-color)">${h(skill.content ?? '')}</pre></div><div class="modal-footer">${button(t('skills.loadFullBody'), 'full', `data-id="${a(id)}"`)}${button(t('common.close'), 'closeView')}${button(t('common.edit'), 'viewEdit', `data-id="${a(id)}"`)}</div></div>`;
    doc.body.appendChild(modal); openCapabilityModal(modal);
  }
  function closeSummary(): void { const modal = byId('skill-view-modal'); if (modal) { closeAppModal(modal); modal.remove(); syncAppModalBodyLock(); } }
  function monitor(state: Readonly<SkillsState>): void {
    const stats = state.stats; const rate = (success: number, failed: number) => success + failed > 0 ? `${(success / (success + failed) * 100).toFixed(1)}%` : '—';
    const target = byId('skills-stats');
    if (target) target.innerHTML = [['totalSkillsCount', stats.total, 'total'], ['totalCallsCount', stats.totalCalls, 'calls'], ['successfulCalls', stats.totalSuccess, 'success'], ['failedCalls', stats.totalFailed, 'failed'], ['successRate', rate(stats.totalSuccess, stats.totalFailed), 'rate']].map(([key, value, cls]) => `<div class="monitor-stat-card skills-stat-card skills-stat-card--${cls}"><div class="monitor-stat-label">${h(t(`skills.${key}`))}</div><div class="monitor-stat-value${cls === 'success' ? ' is-success' : cls === 'failed' ? ' is-danger' : ''}">${value}</div></div>`).join('');
    const list = byId('skills-monitor-list'); if (!list) return;
    const rows = [...stats.stats].sort((x, y) => y.total_calls - x.total_calls || x.skill_name.localeCompare(y.skill_name));
    list.innerHTML = rows.length ? capabilityTable('Recorded skill usage', ['Skill', 'Calls', 'Successful', 'Failed', 'Completed success rate', 'Last call'], rows.map(stat => `<tr><td><strong>${h(stat.skill_name)}</strong></td><td>${stat.total_calls}</td><td>${stat.success_calls}</td><td>${stat.failed_calls}</td><td title="Successful / (successful + failed); no completed outcomes is shown as a dash">${rate(stat.success_calls, stat.failed_calls)}</td><td>${h(stat.last_call_time || 'Not recorded')}</td></tr>`).join('')) : capabilityState(t('skills.noCallRecords'), 'Usage will appear after an agent invokes a skill.');
  }
  function error(id: string, message: string): void { const node = byId(id); if (node) node.innerHTML = capabilityState(message, 'Check your connection and refresh to try again.', '', true); }
  function bind(actions: Actions): () => void {
    const restore: (() => void)[] = [];
    const fields: [string, string][] = [['skill-name', 'name'], ['skill-description', 'description'], ['skill-content', 'content'], ['skill-content-add', 'content']];
    for (const [id, field] of fields) { const node = byId(id); if (node) { node.dataset.input = 'skills.field'; node.dataset.field = field; restore.push(() => { delete node.dataset.input; delete node.dataset.field; }); } }
    const newFile = byId('skill-new-file-btn'); if (newFile) { newFile.dataset.action = 'skills.newFile'; restore.push(() => { delete newFile.dataset.action; }); }
    const unbind = actions.bind(doc);
    return () => { unbind(); restore.forEach(fn => fn()); resize?.disconnect(); closeSummary(); closeAppModal(byId('skill-modal')); };
  }
  return { render, renderTree, editor, busy, summary, closeSummary, monitor, error, bind,
    value: (id: string) => byId<HTMLInputElement>(id)?.value ?? '',
    clearSearch: () => { setValue('skills-search', ''); show('skills-search-clear', false); },
    closeEditor: () => { closeAppModal(byId('skill-modal')); },
    editorOpen: () => isAppModalOpen(byId('skill-modal')),
    isPageActive: () => byId('page-skills-management')?.classList.contains('active') ?? false,
    fullBody: (value: string) => text('skill-view-body', value),
    clearNewPath: () => setValue('skill-new-file-path', ''),
  };
}
export type SkillsView = ReturnType<typeof createSkillsView>;
