import type { ProjectsDom } from './dom';

export function createProjectsSelects(dom: ProjectsDom, onChange: Record<string, () => void>) {
  const entries = new Map<string, { select: HTMLSelectElement; wrapper: HTMLElement; trigger: HTMLButtonElement; dropdown: HTMLElement }>();
  const close = () => entries.forEach(({ wrapper, trigger }) => { wrapper.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); });
  function sync(select: HTMLSelectElement) {
    const entry = entries.get(select.id); if (!entry) return;
    entry.dropdown.replaceChildren();
    for (const option of select.options) {
      const button = dom.document.createElement('button'); button.type = 'button'; button.className = 'projects-filter-select-option';
      button.setAttribute('role', 'option'); button.dataset.value = option.value;
      button.classList.toggle('is-selected', option.value === select.value); button.setAttribute('aria-selected', String(option.value === select.value));
      const check = dom.document.createElement('span'); check.className = 'projects-filter-select-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
      const label = dom.document.createElement('span'); label.className = 'projects-filter-select-label'; label.textContent = option.textContent;
      button.append(check, label); entry.dropdown.append(button);
    }
    const label = entry.trigger.querySelector('.projects-filter-select-value'); if (label) label.textContent = select.selectedOptions[0]?.textContent ?? '';
    entry.trigger.disabled = select.disabled; entry.wrapper.classList.toggle('is-disabled', select.disabled);
  }
  function refresh() {
    entries.forEach((entry, id) => { if (!entry.select.isConnected) entries.delete(id); });
    dom.el('page-projects')?.querySelectorAll<HTMLSelectElement>('select.projects-filter-select-native, #projects-page-size-pagination').forEach(select => {
      if (entries.get(select.id)?.select === select) { sync(select); return; }
      const wrapper = dom.document.createElement('div'); wrapper.className = 'projects-filter-select-ui' + (select.id === 'projects-page-size-pagination' ? ' projects-filter-select-ui--compact' : '');
      const trigger = dom.document.createElement('button'); trigger.type = 'button'; trigger.className = 'projects-filter-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = '<span class="projects-filter-select-value"></span><svg class="projects-filter-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const dropdown = dom.document.createElement('div'); dropdown.className = 'projects-filter-select-dropdown'; dropdown.setAttribute('role', 'listbox');
      select.before(wrapper); wrapper.append(trigger, dropdown, select); select.classList.add('projects-filter-native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      entries.set(select.id, { select, wrapper, trigger, dropdown });
      trigger.addEventListener('click', event => { event.stopPropagation(); if (select.disabled) return; const open = wrapper.classList.contains('open'); close(); if (!open) { wrapper.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); } });
      dropdown.addEventListener('click', event => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-value]') : null; if (!target) return; event.stopPropagation(); if (select.value !== target.dataset.value) { select.value = target.dataset.value ?? ''; select.dispatchEvent(new Event('change', { bubbles: true })); } close(); sync(select); });
      select.addEventListener('change', () => { sync(select); onChange[select.id]?.(); }); sync(select);
    });
  }
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  dom.document.addEventListener('click', close); dom.document.addEventListener('keydown', keydown);
  return { refresh, syncAll: () => entries.forEach(entry => sync(entry.select)), dispose() { dom.document.removeEventListener('click', close); dom.document.removeEventListener('keydown', keydown); } };
}
