interface SelectRegistration { select: HTMLSelectElement; wrapper: HTMLDivElement; trigger: HTMLButtonElement; dropdown: HTMLDivElement }
export function createAuditSelects(document: Document) {
  const registry = new Map<string, SelectRegistration>();
  const events = new AbortController();
  let mounted = false;
  const closeAll = (): void => { registry.forEach(({ wrapper }) => wrapper.classList.remove('open')); };
  function sync(id: string): void {
    const entry = registry.get(id); if (!entry) return;
    const { select, dropdown, trigger, wrapper } = entry;
    dropdown.replaceChildren();
    for (const option of select.options) {
      const item = document.createElement('div'); item.className = 'audit-custom-select-option';
      item.setAttribute('role', 'option'); item.dataset.value = option.value; item.dataset.action = 'audit.select-option';
      if (option.value === select.value) { item.classList.add('is-selected'); item.setAttribute('aria-selected', 'true'); }
      const check = document.createElement('span'); check.className = 'audit-custom-select-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
      const label = document.createElement('span'); label.className = 'audit-custom-select-label'; label.textContent = option.textContent;
      item.append(check, label); dropdown.append(item);
    }
    const value = trigger.querySelector('.audit-custom-select-value');
    if (value) value.textContent = select.options[select.selectedIndex]?.textContent || '';
    trigger.disabled = select.disabled; wrapper.classList.toggle('is-disabled', select.disabled);
  }
  function enhance(id: string): void {
    if (registry.has(id)) { sync(id); return; }
    const select = document.getElementById(id);
    if (!(select instanceof HTMLSelectElement) || !select.parentNode) return;
    select.dataset.auditCustom = '1'; select.classList.add('audit-native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const wrapper = document.createElement('div'); wrapper.className = 'audit-custom-select';
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'audit-custom-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.dataset.action = 'audit.select-toggle';
    const value = document.createElement('span'); value.className = 'audit-custom-select-value';
    const caret = document.createElement('span'); caret.className = 'audit-custom-select-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = '▾'; trigger.append(value, caret);
    const dropdown = document.createElement('div'); dropdown.className = 'audit-custom-select-dropdown'; dropdown.setAttribute('role', 'listbox');
    select.parentNode.insertBefore(wrapper, select); wrapper.append(trigger, dropdown, select);
    registry.set(id, { select, wrapper, trigger, dropdown });
    trigger.addEventListener('click', event => {
      event.stopPropagation(); if (select.disabled) return;
      const open = wrapper.classList.contains('open'); closeAll(); if (!open) wrapper.classList.add('open');
    }, { signal: events.signal });
    dropdown.addEventListener('click', event => {
      const option = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action="audit.select-option"]') : null;
      if (!option) return;
      event.stopPropagation(); wrapper.classList.remove('open');
      const value = option.dataset.value || '';
      if (select.value !== value) { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }
      sync(id);
    }, { signal: events.signal });
    sync(id);
  }
  return {
    init(): void {
      if (!mounted) { mounted = true; document.addEventListener('click', closeAll, { signal: events.signal }); }
      ['audit-filter-category', 'audit-filter-action', 'audit-filter-result'].forEach(enhance);
    }, sync,
    dispose(): void {
      events.abort();
      registry.forEach(({ select, wrapper }) => {
        wrapper.before(select); wrapper.remove(); delete select.dataset.auditCustom;
        select.classList.remove('audit-native-select'); select.removeAttribute('tabindex'); select.removeAttribute('aria-hidden');
      }); registry.clear();
    },
  };
}
