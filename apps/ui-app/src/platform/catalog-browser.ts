/** Browser-only primitives used by the catalog DOM adapters. No application globals. */
export interface CatalogUI {
  t(key: string, options?: Record<string, unknown>): string;
  notify(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  allow(permission: string): boolean;
  openModal(target: string | HTMLElement, options?: { focus?: boolean; focusEl?: HTMLElement }): void;
  closeModal(target: string | HTMLElement): void;
  isModalOpen(id: string): boolean;
  translate(root: HTMLElement): void;
  afterRender(root: HTMLElement): void;
  navigate(page: string): void;
}
export const catalogBrowser = {
  every: (fn: () => void, ms: number): number => window.setInterval(fn, ms),
  cancelEvery: (id: number | undefined): void => window.clearInterval(id),
  later: (fn: () => void, ms: number): number => window.setTimeout(fn, ms),
  cancelLater: (id: number | undefined): void => window.clearTimeout(id),
  confirm: (message: string): boolean => window.confirm(message),
  alert: (message: string): void => window.alert(message),
  copy: (value: string): Promise<void> => navigator.clipboard.writeText(value),
  hash: (value: string): void => { window.location.hash = value; },
};
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function createSignal() {
  const listeners = new Set<() => void>();
  return { subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, emit() { listeners.forEach(fn => fn()); } };
}
export function dom(document: Document) {
  return {
    el: (id: string): HTMLElement | null => document.getElementById(id),
    field: (id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null => {
      const el = document.getElementById(id);
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el : null;
    },
    value(id: string): string { return this.field(id)?.value ?? ''; },
    set(id: string, value: string): void { const el = this.field(id); if (el) el.value = value; },
    text(id: string, value: unknown): void { const el = this.el(id); if (el) el.textContent = String(value ?? ''); },
    html(id: string, value: string): void { const el = this.el(id); if (el) el.innerHTML = value; },
    show(id: string, visible: boolean, display = ''): void { const el = this.el(id); if (el) el.style.display = visible ? display : 'none'; },
    checked(id: string): boolean { const el = this.el(id); return el instanceof HTMLInputElement && el.checked; },
    check(id: string, checked: boolean): void { const el = this.el(id); if (el instanceof HTMLInputElement) el.checked = checked; },
  };
}
export type DomAction = (element: HTMLElement, event: Event) => void | Promise<unknown>;
/** Explicit static bindings; removes the corresponding shell attribute, never interprets it. */
export function bindStatic(document: Document, selector: string, event: string, action: DomAction, signal: AbortSignal): void {
  document.querySelectorAll<HTMLElement>(selector).forEach(el => {
    el.removeAttribute('on' + event);
    el.addEventListener(event, e => { void action(el, e); }, { signal });
  });
}
export function bindActions(document: Document, domain: string, actions: Record<string, DomAction>, ui: CatalogUI, signal: AbortSignal): void {
  for (const event of ['click', 'change', 'input', 'keydown']) {
    document.addEventListener(event, e => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(`[data-${domain}-${event}]`) : null;
      const name = el?.getAttribute(`data-${domain}-${event}`);
      if (!el || !name || (el instanceof HTMLButtonElement && el.disabled)) return;
      e.stopPropagation();
      Promise.resolve().then(() => actions[name]?.(el, e)).catch(error => ui.notify(errorMessage(error), 'error'));
    }, { signal });
  }
}
export function actionAttribute(domain: string, action: string, id = '', event = 'click'): string {
  return `data-${domain}-${event}="${escapeHtml(action)}" data-id="${escapeHtml(id)}"`;
}
export function pagination(domain: string, page: number, size: number, total: number, pages: number, t: CatalogUI['t']): string {
  if (!total) return '';
  const start = (page - 1) * size + 1, end = Math.min(page * size, total);
  return `<div class="pagination"><div class="pagination-info">${escapeHtml(t('skillsPage.paginationShow', { start, end, total }))}<label class="pagination-page-size">${escapeHtml(t('mcp.perPage'))}<select data-${domain}-change="size">${[10, 20, 50, 100].map(n => `<option ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div><div class="pagination-controls">${[[1, 'firstPage'], [page - 1, 'prevPage'], [page + 1, 'nextPage'], [pages, 'lastPage']].map(([p, key], i) => `<button class="btn-secondary" ${actionAttribute(domain, 'page', String(p))} ${(i < 2 ? page <= 1 : page >= pages) ? 'disabled' : ''}>${escapeHtml(t('skillsPage.' + key))}</button>${i === 1 ? `<span class="pagination-page">${escapeHtml(t('skillsPage.pageOf', { current: page, total: pages }))}</span>` : ''}`).join('')}</div></div>`;
}
/** Styled native-select adapter shared by catalog forms, including keyboard/Escape support. */
export function createSelects(document: Document, signal: AbortSignal) {
  const registrations = new Map<HTMLSelectElement, { wrapper: HTMLElement; trigger: HTMLButtonElement; dropdown: HTMLElement; prefix: string }>();
  function close() { registrations.forEach(r => { r.wrapper.classList.remove('open'); r.trigger.setAttribute('aria-expanded', 'false'); }); }
  function sync(select: HTMLSelectElement) {
    const r = registrations.get(select); if (!r) return;
    r.trigger.querySelector('span')!.textContent = select.selectedOptions[0]?.textContent ?? '';
    r.trigger.disabled = select.disabled;
    r.dropdown.replaceChildren(...Array.from(select.options, opt => {
      const b = document.createElement('button'); b.type = 'button'; b.className = r.prefix + '-select-option';
      b.textContent = (opt.selected ? '✓ ' : '') + opt.textContent; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(opt.selected));
      b.classList.toggle('is-selected', opt.selected); b.disabled = opt.disabled;
      b.addEventListener('click', e => { e.stopPropagation(); select.value = opt.value; select.dispatchEvent(new Event('change', { bubbles: true })); close(); sync(select); r.trigger.focus(); });
      return b;
    }));
  }
  function enhance(id: string, prefix: string) {
    const select = document.getElementById(id); if (!(select instanceof HTMLSelectElement)) return;
    if (!registrations.has(select)) {
      const wrapper = document.createElement('div'), trigger = document.createElement('button'), dropdown = document.createElement('div');
      wrapper.className = prefix + '-select-ui'; trigger.className = prefix + '-select-trigger'; trigger.type = 'button';
      trigger.innerHTML = `<span class="${prefix}-select-value"></span><svg class="${prefix}-select-caret" width="14" height="14" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
      trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); dropdown.className = prefix + '-select-dropdown'; dropdown.setAttribute('role', 'listbox');
      select.before(wrapper); wrapper.append(trigger, dropdown, select); select.classList.add(prefix + '-native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      registrations.set(select, { wrapper, trigger, dropdown, prefix });
      trigger.addEventListener('click', e => { e.stopPropagation(); const open = wrapper.classList.contains('open'); close(); wrapper.classList.toggle('open', !open); trigger.setAttribute('aria-expanded', String(!open)); }, { signal });
      trigger.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); wrapper.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); dropdown.querySelector('button')?.focus(); } }, { signal });
      select.addEventListener('change', () => sync(select), { signal });
    }
    sync(select);
  }
  document.addEventListener('click', close, { signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { signal });
  return { enhance, syncAll() { registrations.forEach((_, select) => { if (!select.isConnected) registrations.delete(select); else sync(select); }); }, close };
}
