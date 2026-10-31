import type { Translate } from './model';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type Handler = (element: HTMLElement, event: Event) => unknown;
export type DomEvent = 'click' | 'change' | 'input' | 'keydown' | 'submit' | 'dragstart' | 'dragenter' | 'dragover' | 'dragleave' | 'drop';

/** Domain-local DOM lifetime and declarative event bindings. */
export function createDom(doc: Document, namespace: string, report: (error: unknown) => void, options: { permissions?: Record<string, string>; applyPermissions?: (root: HTMLElement) => void } = {}) {
  const cleanup: (() => void)[] = [];
  const handlers = new Map<string, Handler>();
  let disposed = false;
  function applyPermissions(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[disabled]:not([data-state-disabled])').forEach(node => { node.dataset.stateDisabled = 'true'; node.setAttribute('aria-disabled', 'true'); });
    options.applyPermissions?.(root);
  }
  const el = (id: string): HTMLElement | null => doc.getElementById(id);
  function field(id: string): Field | null {
    const node = el(id); return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ? node : null;
  }
  function on(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler); cleanup.push(() => target.removeEventListener(type, handler));
  }
  function run(handler: Handler, element: HTMLElement, event: Event): void {
    if (disposed) return;
    try { void Promise.resolve(handler(element, event)).catch(report); } catch (error) { report(error); }
  }
  const selects = new Map<HTMLSelectElement, { wrapper: HTMLElement; trigger: HTMLButtonElement; menu: HTMLElement; search?: HTMLInputElement; prefix: string }>();
  function closeSelects(): void {
    for (const reg of selects.values()) { reg.wrapper.classList.remove('open'); reg.trigger.setAttribute('aria-expanded', 'false'); }
  }
  function syncSelect(select: HTMLSelectElement): void {
    const reg = selects.get(select); if (!reg) return;
    const value = reg.trigger.querySelector('span'); if (value) value.textContent = select.selectedOptions[0]?.textContent ?? '';
    reg.trigger.disabled = select.disabled; reg.wrapper.classList.toggle('is-disabled', select.disabled);
    const query = reg.search?.value.trim().toLowerCase() ?? '';
    reg.menu.replaceChildren();
    for (const option of select.options) {
      if (query && !`${option.value} ${option.textContent}`.toLowerCase().includes(query)) continue;
      const button = doc.createElement('button'); button.type = 'button'; button.className = `${reg.prefix}-option`;
      button.setAttribute('role', 'option'); button.dataset.value = option.value; button.title = option.textContent ?? '';
      button.classList.toggle('is-selected', option.value === select.value); button.setAttribute('aria-selected', String(option.value === select.value));
      button.disabled = option.disabled; button.innerHTML = `<span class="${reg.prefix}-check" aria-hidden="true">✓</span><span class="${reg.prefix}-label">${escapeHtml(option.textContent)}</span>`;
      reg.menu.append(button);
    }
  }
  function enhanceSelect(select: HTMLSelectElement, prefix: string, searchable = false, t?: Translate): void {
    if (selects.has(select)) { syncSelect(select); return; }
    for (const [old, reg] of selects) if (!old.isConnected) { reg.wrapper.remove(); selects.delete(old); }
    const wrapper = doc.createElement('div'); wrapper.className = prefix === 'workflow-tool-select' ? prefix : `${prefix}-ui`;
    if (prefix === 'batch-form-select' && select.closest('.bq-inline-edit-controls')) wrapper.classList.add('batch-form-select-ui--inline');
    const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className = `${prefix}-trigger`;
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.innerHTML = `<span class="${prefix}-value"></span><span class="${prefix}-caret" aria-hidden="true">⌄</span>`;
    const dropdown = doc.createElement('div'); dropdown.className = `${prefix}-dropdown`; dropdown.setAttribute('role', 'listbox');
    const menu = doc.createElement('div'); menu.className = `${prefix}-options`;
    let search: HTMLInputElement | undefined;
    if (searchable) {
      search = doc.createElement('input'); search.type = 'search'; search.className = `${prefix}-search-input`;
      search.placeholder = t?.('workflows.config.searchTool') ?? '';
      const searchWrap = doc.createElement('div'); searchWrap.className = `${prefix}-search`; searchWrap.append(search); dropdown.append(searchWrap);
      on(search, 'input', () => syncSelect(select)); on(search, 'click', event => event.stopPropagation());
    }
    dropdown.append(menu); select.before(wrapper); wrapper.append(trigger, dropdown, select);
    const oldTab = select.tabIndex, oldAria = select.getAttribute('aria-hidden');
    select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const nativeClass = prefix === 'tasks-filter-select' ? 'tasks-filter-native-select' : prefix === 'batch-form-select' ? 'batch-form-native-select' : prefix === 'workflow-tool-select' ? 'workflow-tool-native-select' : 'workflow-form-native-select';
    select.classList.add(nativeClass); selects.set(select, { wrapper, trigger, menu, search, prefix });
    on(trigger, 'click', event => {
      event.stopPropagation(); if (select.disabled) return;
      const open = wrapper.classList.contains('open'); closeSelects(); if (open) return;
      wrapper.classList.add('open'); trigger.setAttribute('aria-expanded', 'true');
      const bounds = wrapper.closest('.modal-body')?.getBoundingClientRect();
      if (bounds) {
        const rect = trigger.getBoundingClientRect(); const height = doc.documentElement.clientHeight;
        const above = Math.max(0, rect.top - bounds.top - 8), below = Math.max(0, Math.min(height, bounds.bottom) - rect.bottom - 8);
        const up = below < Math.min(280, dropdown.scrollHeight) && above > below;
        dropdown.style.top = up ? 'auto' : 'calc(100% + 4px)'; dropdown.style.bottom = up ? 'calc(100% + 4px)' : 'auto'; dropdown.style.maxHeight = Math.min(280, up ? above : below) + 'px'; dropdown.style.boxSizing = 'border-box';
      }
      if (search) { search.value = ''; syncSelect(select); search.focus(); }
    });
    on(menu, 'click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-value]') : null;
      if (!button || button.disabled) return; event.stopPropagation();
      if (select.value !== button.dataset.value) { select.value = button.dataset.value ?? ''; select.dispatchEvent(new Event('change', { bubbles: true })); }
      closeSelects(); syncSelect(select);
    });
    on(select, 'change', () => syncSelect(select));
    cleanup.push(() => {
      if (wrapper.isConnected) { wrapper.before(select); wrapper.remove(); }
      select.classList.remove(nativeClass); select.tabIndex = oldTab;
      if (oldAria === null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', oldAria);
    });
    syncSelect(select);
  }
  return {
    doc, el, field, on,
    get disposed(): boolean { return disposed; },
    value: (id: string) => field(id)?.value ?? '',
    checked: (id: string) => { const node = el(id); return node instanceof HTMLInputElement && node.checked; },
    setValue(id: string, value: string): void { const node = field(id); if (node) node.value = value; },
    setChecked(id: string, value: boolean): void { const node = el(id); if (node instanceof HTMLInputElement) node.checked = value; },
    html(id: string, html: string): void { const node = el(id); if (node && !disposed) { node.innerHTML = html; applyPermissions(node); } },
    text(id: string, value: unknown): void { const node = el(id); if (node && !disposed) node.textContent = String(value ?? ''); },
    show(id: string, show: boolean, display = ''): void { const node = el(id); if (node) node.style.display = show ? display : 'none'; },
    disable(id: string, disabled: boolean): void {
      const node = el(id); if (!node) return;
      if (node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node instanceof HTMLSelectElement) node.disabled = disabled;
      node.dataset.stateDisabled = String(disabled); node.setAttribute('aria-disabled', String(disabled));
    },
    action(name: string, handler: Handler): void { handlers.set(name, handler); },
    attr(name: string, event: DomEvent = 'click'): string { const permission = options.permissions?.[name]; return `data-${namespace}-${event}="${escapeHtml(name)}"` + (permission ? ` data-require-permission="${escapeHtml(permission)}"` : ''); },
    applyPermissions,
    mount(): void {
      for (const type of ['click', 'change', 'input', 'keydown', 'submit', 'dragstart', 'dragenter', 'dragover', 'dragleave', 'drop'] as const) {
        const attr = `data-${namespace}-${type}`;
        on(doc, type, event => {
          const target = event.target instanceof Element ? event.target : null;
          const node = target?.closest<HTMLElement>(`[${attr}]`); if (!node || node.matches(':disabled,[aria-disabled="true"]')) return;
          const handler = handlers.get(node.getAttribute(attr) ?? ''); if (handler) run(handler, node, event);
        });
      }
      on(doc, 'click', event => { if (!(event.target instanceof Element) || !event.target.closest('[aria-haspopup="listbox"]')) closeSelects(); });
      on(doc, 'keydown', event => { if (event instanceof KeyboardEvent && event.key === 'Escape') closeSelects(); });
    },
    enhanceSelect, syncSelect, closeSelects,
    enhance(rootId: string, prefix: string): void { el(rootId)?.querySelectorAll('select').forEach(select => enhanceSelect(select, prefix)); },
    dispose(): void { disposed = true; cleanup.reverse().forEach(fn => fn()); cleanup.length = 0; selects.clear(); handlers.clear(); },
  };
}
export type Dom = ReturnType<typeof createDom>;
