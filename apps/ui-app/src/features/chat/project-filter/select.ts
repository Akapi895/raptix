// The custom dropdown that replaces a native select of the project filter: a trigger with the chosen name, a popup with
// options (and a search field for projects), and the native select kept hidden as the source of truth. Only one dropdown
// is open at a time, and an outside click or Escape closes them.

export const NONE_VALUE = '__none__';

export interface SelectRegistryEntry {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  dropdown: HTMLElement;
  select: HTMLSelectElement;
  searchInput?: HTMLInputElement;
  optionsList?: HTMLElement;
  filterSearchSeq: number;
  filterSearchTimer: ReturnType<typeof setTimeout> | number | null;
}

export interface CustomSelectDependencies {
  doc: Document;
  t(key: string, fallback: string): string;
  setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> | number;
  clearTimer(handle: ReturnType<typeof setTimeout> | number): void;
  scheduleFrame(callback: () => void): void;
  /** Fills the options for the search of a project select; absent for the plain selects. */
  loadOptions?(selectId: string): void;
  caret: string;
  triggerClass: string;
}

export interface CustomSelects {
  registry: Record<string, SelectRegistryEntry | undefined>;
  initProject(selectId: string): void;
  initSimple(selectId: string): void;
  syncProject(selectId: string): void;
  syncSimple(selectId: string): void;
  close(selectId: string): void;
  closeAll(): void;
  loadProjectOptions(selectId: string): void;
  /** Adds an option for a project the native select does not have yet. */
  ensureNativeOption(select: HTMLSelectElement, value: string, label: string): void;
  optionButton(value: string, label: string, selected: string): HTMLButtonElement;
  statusMessage(list: HTMLElement, className: string, text: string): HTMLElement;
  renderPinnedOptions(reg: SelectRegistryEntry): void;
  dispose(): void;
}

export function createOptionButton(doc: Document, value: string, label: string, selectedValue: string): HTMLButtonElement {
  const item = doc.createElement('button');
  item.type = 'button';
  item.className = 'conversation-project-filter-option';
  item.setAttribute('role', 'option');
  item.setAttribute('data-value', value);
  item.title = label;
  if (value === selectedValue) {
    item.classList.add('is-selected');
    item.setAttribute('aria-selected', 'true');
  } else {
    item.setAttribute('aria-selected', 'false');
  }
  const check = doc.createElement('span');
  check.className = 'conversation-project-filter-check';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = '✓';
  const labelEl = doc.createElement('span');
  labelEl.className = 'conversation-project-filter-option-label';
  labelEl.textContent = label;
  labelEl.title = label;
  item.append(check, labelEl);
  return item;
}

export function createCustomSelects(deps: CustomSelectDependencies): CustomSelects {
  const { doc } = deps;
  const registry: Record<string, SelectRegistryEntry | undefined> = {};
  let documentBound = false;

  function close(selectId: string): void {
    const reg = registry[selectId];
    if (!reg) return;
    reg.wrapper.classList.remove('open');
    reg.trigger.setAttribute('aria-expanded', 'false');
    if (reg.filterSearchTimer) {
      deps.clearTimer(reg.filterSearchTimer);
      reg.filterSearchTimer = null;
    }
    reg.filterSearchSeq += 1;
    if (reg.searchInput) reg.searchInput.value = '';
  }

  function closeAll(): void {
    Object.keys(registry).forEach(close);
  }

  function optionButton(value: string, label: string, selected: string): HTMLButtonElement {
    return createOptionButton(doc, value, label, selected);
  }

  function statusMessage(list: HTMLElement, className: string, text: string): HTMLElement {
    const el = doc.createElement('div');
    el.className = className;
    el.textContent = text;
    list.appendChild(el);
    return el;
  }

  function renderPinnedOptions(reg: SelectRegistryEntry): void {
    const { select, optionsList } = reg;
    if (!optionsList) return;
    optionsList.innerHTML = '';
    Array.prototype.forEach.call(select.options, (option: HTMLOptionElement) => {
      if (option.value === '' || option.value === NONE_VALUE) optionsList.appendChild(optionButton(option.value, option.textContent || '', select.value));
    });
  }

  function ensureSearchUi(reg: SelectRegistryEntry): void {
    if (reg.searchInput && reg.optionsList) return;
    const { dropdown } = reg;
    dropdown.innerHTML = '';
    const wrap = doc.createElement('div');
    wrap.className = 'conversation-project-filter-search';
    const input = doc.createElement('input');
    input.type = 'search';
    input.className = 'conversation-project-filter-search-input';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-i18n', 'chat.filterProjectSearch');
    input.setAttribute('data-i18n-attr', 'placeholder');
    input.placeholder = deps.t('chat.filterProjectSearch', 'Search projects…');
    wrap.appendChild(input);
    dropdown.appendChild(wrap);
    reg.searchInput = input;
    const list = doc.createElement('div');
    list.className = 'conversation-project-filter-options';
    dropdown.appendChild(list);
    reg.optionsList = list;
    reg.filterSearchSeq = 0;
    reg.filterSearchTimer = null;
    const selectId = reg.select.id;
    input.addEventListener('input', () => deps.loadOptions?.(selectId));
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') close(selectId);
    });
  }

  function ensureOptionsUi(reg: SelectRegistryEntry): void {
    if (reg.optionsList) return;
    reg.dropdown.innerHTML = '';
    const list = doc.createElement('div');
    list.className = 'conversation-project-filter-options';
    reg.dropdown.appendChild(list);
    reg.optionsList = list;
  }

  function renderSimpleOptions(reg: SelectRegistryEntry): void {
    ensureOptionsUi(reg);
    const { select, optionsList } = reg;
    if (!optionsList) return;
    optionsList.innerHTML = '';
    Array.prototype.forEach.call(select.options, (option: HTMLOptionElement) => {
      optionsList.appendChild(optionButton(option.value, option.textContent || '', select.value));
    });
  }

  function syncTrigger(reg: SelectRegistryEntry): void {
    const valueSpan = reg.trigger.querySelector<HTMLElement>('.conversation-project-filter-value');
    const selected = reg.select.options[reg.select.selectedIndex];
    const text = selected ? (selected.textContent || '') : '';
    if (valueSpan) {
      valueSpan.textContent = text;
      valueSpan.title = text;
    }
  }

  function syncProject(selectId: string): void {
    const reg = registry[selectId];
    if (!reg) return;
    ensureSearchUi(reg);
    syncTrigger(reg);
  }

  function syncSimple(selectId: string): void {
    const reg = registry[selectId];
    if (reg) syncTrigger(reg);
  }

  /** Builds the wrapper, the trigger and the popup around a native select, once. */
  function enhance(selectId: string): SelectRegistryEntry | null {
    const select = doc.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return null;
    select.dataset.projectCustomSelect = '1';
    select.classList.add('conversation-project-filter-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const wrapper = doc.createElement('div');
    wrapper.className = 'conversation-project-filter-ui';
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = deps.triggerClass;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const valueSpan = doc.createElement('span');
    valueSpan.className = 'conversation-project-filter-value';
    trigger.appendChild(valueSpan);
    trigger.insertAdjacentHTML('beforeend', deps.caret);
    const dropdown = doc.createElement('div');
    dropdown.className = 'conversation-project-filter-dropdown';
    dropdown.setAttribute('role', 'listbox');

    const parent = select.parentNode;
    parent?.insertBefore(wrapper, select);
    wrapper.append(trigger, dropdown, select);
    const reg: SelectRegistryEntry = { wrapper, trigger, dropdown, select, filterSearchSeq: 0, filterSearchTimer: null };
    registry[selectId] = reg;
    return reg;
  }

  function bindDocument(): void {
    if (documentBound) return;
    documentBound = true;
    doc.addEventListener('click', onDocumentClick);
    doc.addEventListener('keydown', onDocumentKey);
  }
  const onDocumentClick = () => closeAll();
  const onDocumentKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAll(); };

  function bindTrigger(reg: SelectRegistryEntry, onOpen: () => void): void {
    reg.trigger.addEventListener('click', event => {
      event.stopPropagation();
      const open = reg.wrapper.classList.contains('open');
      closeAll();
      if (!open) {
        reg.wrapper.classList.add('open');
        reg.trigger.setAttribute('aria-expanded', 'true');
        onOpen();
      }
    });
  }

  function initSimple(selectId: string): void {
    if (doc.getElementById(selectId)?.dataset.projectCustomSelect === '1') {
      syncSimple(selectId);
      return;
    }
    const reg = enhance(selectId);
    if (!reg) return;
    bindTrigger(reg, () => renderSimpleOptions(reg));
    reg.dropdown.addEventListener('click', event => {
      const option = (event.target as Element | null)?.closest<HTMLElement>('.conversation-project-filter-option');
      if (!option) return;
      event.stopPropagation();
      const value = option.getAttribute('data-value');
      if (value === null) return;
      if (reg.select.value !== value) {
        reg.select.value = value;
        reg.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close(selectId);
      syncSimple(selectId);
    });
    bindDocument();
    syncSimple(selectId);
  }

  function initProject(selectId: string): void {
    if (doc.getElementById(selectId)?.dataset.projectCustomSelect === '1') {
      syncProject(selectId);
      return;
    }
    const reg = enhance(selectId);
    if (!reg) return;
    bindTrigger(reg, () => {
      ensureSearchUi(reg);
      if (reg.searchInput) {
        reg.searchInput.value = '';
        deps.loadOptions?.(selectId);
        deps.scheduleFrame(() => reg.searchInput?.focus());
      }
    });
    reg.dropdown.addEventListener('click', event => {
      const option = (event.target as Element | null)?.closest<HTMLElement>('.conversation-project-filter-option');
      if (!option) return;
      event.stopPropagation();
      const value = option.getAttribute('data-value');
      if (value === null) return;
      const label = option.querySelector('.conversation-project-filter-option-label')?.textContent || value;
      ensureNativeOption(reg.select, value, label);
      if (reg.select.value !== value) {
        reg.select.value = value;
        reg.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close(selectId);
      syncProject(selectId);
    });
    bindDocument();
    syncProject(selectId);
  }

  function ensureNativeOption(select: HTMLSelectElement, value: string, label: string): void {
    if (!value || value === NONE_VALUE) return;
    if (Array.prototype.some.call(select.options, (option: HTMLOptionElement) => option.value === value)) return;
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label || value;
    select.appendChild(option);
  }

  function loadProjectOptions(selectId: string): void {
    deps.loadOptions?.(selectId);
  }

  return {
    registry,
    initProject,
    initSimple,
    syncProject,
    syncSimple,
    close,
    closeAll,
    loadProjectOptions,
    ensureNativeOption,
    optionButton,
    statusMessage,
    renderPinnedOptions,
    dispose() {
      closeAll();
      doc.removeEventListener('click', onDocumentClick);
      doc.removeEventListener('keydown', onDocumentKey);
      for (const [id, reg] of Object.entries(registry)) {
        if (!reg) continue;
        if (reg.filterSearchTimer) deps.clearTimer(reg.filterSearchTimer);
        reg.wrapper.before(reg.select); reg.wrapper.remove();
        delete reg.select.dataset.projectCustomSelect;
        reg.select.classList.remove('conversation-project-filter-native');
        reg.select.removeAttribute('aria-hidden'); reg.select.removeAttribute('tabindex');
        delete registry[id];
      }
      documentBound = false;
    },
  };
}
