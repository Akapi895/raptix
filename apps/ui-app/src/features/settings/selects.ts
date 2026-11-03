import type { Translate } from './contracts';

interface SelectRegistration {
  wrapper: HTMLDivElement; trigger: HTMLButtonElement; value: HTMLSpanElement; menu: HTMLDivElement;
  tabIndex: string | null; ariaHidden: string | null;
}
interface ModelRegistration { wrapper: HTMLDivElement; trigger: HTMLButtonElement; menuList: HTMLDivElement; count: HTMLSpanElement; header: HTMLDivElement; select: HTMLSelectElement; tabIndex: string | null; ariaHidden: string | null; display: string; nativeClass: boolean }
export interface SelectEnvironment { events: EventTarget; viewport(): { width: number; height: number } }
/** Shared floating selects used by roles, skills, tasks, projects, files, HITL and chat. */
export function createSettingsSelects(doc: Document, t: Translate, environment: SelectEnvironment) {
  const registrations = new Map<HTMLSelectElement, SelectRegistration>();
  const models = new Map<string, ModelRegistration>();
  const cleanup: (() => void)[] = []; let bound = false, disposed = false;
  function on(target: EventTarget, name: string, handler: EventListener, capture = false) { target.addEventListener(name, handler, capture); cleanup.push(() => target.removeEventListener(name, handler, capture)); }
  function close(select: HTMLSelectElement) {
    const reg = registrations.get(select); if (!reg) return;
    reg.wrapper.classList.remove('open'); reg.trigger.setAttribute('aria-expanded', 'false');
    if (reg.menu.parentNode !== reg.wrapper) reg.wrapper.appendChild(reg.menu);
    reg.menu.classList.remove('settings-custom-select-menu--floating');
    for (const key of ['left', 'right', 'top', 'bottom', 'width', 'max-height']) reg.menu.style.removeProperty(key);
  }
  function closeAll() { for (const select of registrations.keys()) close(select); }
  function closeModels() { for (const reg of models.values()) { reg.wrapper.classList.remove('open'); reg.trigger.setAttribute('aria-expanded', 'false'); } }
  function position(reg: SelectRegistration) {
    if (!reg.wrapper.classList.contains('open')) return;
    const rect = reg.trigger.getBoundingClientRect(), viewport = environment.viewport(); const edge = 12, gap = 6;
    const width = Math.min(Math.max(rect.width, 150), Math.max(160, viewport.width - edge * 2));
    const left = Math.min(Math.max(edge, rect.left), Math.max(edge, viewport.width - width - edge));
    const below = viewport.height - rect.bottom - gap - edge, above = rect.top - gap - edge;
    const up = below < 180 && above > below;
    Object.assign(reg.menu.style, { left: `${Math.round(left)}px`, right: 'auto', width: `${Math.round(width)}px`, maxHeight: `${Math.max(120, Math.floor((up ? above : below) || 180))}px`, top: up ? 'auto' : `${Math.round(rect.bottom + gap)}px`, bottom: up ? `${Math.round(viewport.height - rect.top + gap)}px` : 'auto' });
  }
  function open(select: HTMLSelectElement) {
    const reg = registrations.get(select); if (!reg || select.disabled) return;
    closeAll(); closeModels(); reg.wrapper.classList.add('open'); reg.trigger.setAttribute('aria-expanded', 'true'); reg.menu.classList.add('settings-custom-select-menu--floating'); doc.body.appendChild(reg.menu); position(reg);
  }
  function sync(select: HTMLSelectElement | null) {
    if (!select) return; const reg = registrations.get(select); if (!reg) return;
    reg.value.textContent = select.options[select.selectedIndex]?.textContent || ''; reg.trigger.disabled = select.disabled; reg.wrapper.classList.toggle('is-disabled', select.disabled); reg.menu.replaceChildren();
    for (const [index, option] of [...select.options].entries()) {
      const item = doc.createElement('button'); item.type = 'button'; item.className = 'settings-custom-select-option'; item.setAttribute('role', 'option'); item.dataset.index = String(index); item.setAttribute('aria-selected', String(option.selected)); item.disabled = option.disabled; item.classList.toggle('is-selected', option.selected); item.classList.toggle('is-disabled', option.disabled);
      const check = doc.createElement('span'); check.className = 'settings-custom-select-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
      const label = doc.createElement('span'); label.className = 'settings-custom-select-label'; label.textContent = option.textContent; item.append(check, label);
      if (select.id === 'ai-channel-select' && option.dataset.probeStatus) {
        const status = option.dataset.probeStatus; item.classList.add('settings-custom-select-option--probe', `probe-${status}`);
        const badge = doc.createElement('span'); badge.className = `settings-custom-select-status ${status}`;
        const dot = doc.createElement('span'); dot.className = 'settings-custom-select-status-dot'; dot.setAttribute('aria-hidden', 'true');
        const message = doc.createElement('span'); message.className = 'settings-custom-select-status-text'; message.textContent = option.dataset.probeMessage || status; badge.append(dot, message); item.append(badge);
      }
      reg.menu.append(item);
    }
  }
  function refresh() {
    for (const [select, reg] of registrations) {
      if (!select.isConnected) { close(select); reg.menu.remove(); registrations.delete(select); } else sync(select);
    }
  }
  function bind() {
    if (bound || disposed) return; bound = true;
    on(doc, 'click', () => { closeAll(); closeModels(); });
    on(doc, 'keydown', event => { if (event instanceof KeyboardEvent && event.key === 'Escape') { closeAll(); closeModels(); } });
    const reposition = () => { for (const reg of registrations.values()) position(reg); };
    on(doc, 'scroll', reposition, true); on(environment.events, 'resize', reposition); on(environment.events, 'hashchange', () => { closeAll(); closeModels(); });
  }
  function enhance(select: HTMLSelectElement) {
    if (disposed) return;
    if (registrations.has(select)) { sync(select); return; }
    if (select.dataset.settingsCustomSelect === '1' || select.classList.contains('model-pick-native') || select.id.startsWith('audit-filter-') || select.getAttribute('aria-hidden') === 'true' || select.style.display === 'none') return;
    const parent = select.parentNode; if (!parent) return;
    const wrapper = doc.createElement('div'); wrapper.className = 'settings-custom-select'; if (select.id.startsWith('openai-reasoning-')) wrapper.classList.add('settings-custom-select--compact'); wrapper.style.width = select.style.width; wrapper.style.minWidth = select.style.minWidth;
    const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className = 'settings-custom-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const value = doc.createElement('span'); value.className = 'settings-custom-select-value'; const caret = doc.createElement('span'); caret.className = 'settings-custom-select-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = '▾'; trigger.append(value, caret);
    const menu = doc.createElement('div'); menu.className = 'settings-custom-select-menu'; menu.setAttribute('role', 'listbox');
    const reg = { wrapper, trigger, value, menu, tabIndex: select.getAttribute('tabindex'), ariaHidden: select.getAttribute('aria-hidden') }; registrations.set(select, reg);
    select.dataset.settingsCustomSelect = '1'; select.classList.add('settings-native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true'); parent.insertBefore(wrapper, select); wrapper.append(trigger, menu, select);
    on(trigger, 'click', event => { event.stopPropagation(); if (wrapper.classList.contains('open')) close(select); else open(select); });
    on(trigger, 'keydown', event => {
      if (!(event instanceof KeyboardEvent) || select.disabled) return;
      const enabled = [...select.options].filter(option => !option.disabled); if (!enabled.length) return;
      const current = Math.max(0, enabled.indexOf(select.options[select.selectedIndex]!)); let next = current;
      if (event.key === 'ArrowDown') next = Math.min(enabled.length - 1, current + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
      else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = enabled.length - 1;
      else if (event.key === 'Escape') { close(select); return; }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(select); return; } else return;
      event.preventDefault(); const option = enabled[next]; if (option && select.value !== option.value) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); } sync(select);
    });
    on(menu, 'click', event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.settings-custom-select-option') : null;
      if (!item || item.disabled) return; event.stopPropagation(); const option = select.options[Number(item.dataset.index)];
      if (option && !option.disabled && select.value !== option.value) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
      sync(select); close(select); trigger.focus();
    });
    on(select, 'change', () => sync(select)); sync(select); bind();
  }
  function init(root?: ParentNode | null) { (root || doc.getElementById('page-settings'))?.querySelectorAll<HTMLSelectElement>('select').forEach(enhance); bind(); refresh(); }
  function pagination(root?: ParentNode | null) {
    root?.querySelectorAll<HTMLSelectElement>('.pagination-page-size select').forEach(select => {
      if (select.dataset.projectsCustomSelect === '1') return; enhance(select); const reg = registrations.get(select); if (!reg) return;
      reg.wrapper.classList.add('pagination-custom-select'); const label = select.labels?.[0] || select.closest('.pagination-page-size');
      const labelText = label ? [...label.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' ').trim() : '';
      const name = select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim() || labelText; if (name) reg.trigger.setAttribute('aria-label', name);
    }); bind(); refresh();
  }
  function syncModel(id: string) {
    const reg = models.get(id); if (!reg) return;
    const { select, wrapper, menuList, count, header, trigger } = reg; const placeholder = t('settingsBasic.modelsListSelectPlaceholder'); menuList.replaceChildren();
    for (const option of [...select.options].filter(option => option.value)) {
      const item = doc.createElement('div'); item.className = 'model-pick-option'; item.setAttribute('role', 'option'); item.dataset.value = option.value; item.classList.toggle('is-selected', option.selected); item.setAttribute('aria-selected', String(option.selected));
      const check = doc.createElement('span'); check.className = 'model-pick-option-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓'; const label = doc.createElement('span'); label.className = 'model-pick-option-label'; label.textContent = option.textContent; item.append(check, label); menuList.append(item);
    }
    const selected = select.options[select.selectedIndex]; const label = trigger.querySelector('.model-pick-trigger-label'); if (label) label.textContent = selected?.value ? selected.textContent : placeholder;
    const length = menuList.children.length; count.textContent = String(length); count.style.display = length ? '' : 'none'; header.textContent = length ? `${placeholder} · ${length}` : placeholder;
    trigger.disabled = select.disabled; wrapper.classList.toggle('is-disabled', select.disabled); wrapper.style.display = length ? '' : 'none'; select.style.display = 'none';
  }
  function enhanceModel(id: string) {
    if (models.has(id)) { syncModel(id); return; } const select = doc.getElementById(id); if (!(select instanceof HTMLSelectElement) || !select.parentNode || disposed) return;
    const wrapper = doc.createElement('div'); wrapper.className = 'model-pick-dropdown'; wrapper.style.display = 'none';
    const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className = 'model-pick-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const label = doc.createElement('span'); label.className = 'model-pick-trigger-label'; const meta = doc.createElement('span'); meta.className = 'model-pick-trigger-meta'; const count = doc.createElement('span'); count.className = 'model-pick-count';
    const caret = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); caret.setAttribute('class', 'model-pick-caret'); caret.setAttribute('viewBox', '0 0 16 16'); caret.setAttribute('aria-hidden', 'true'); caret.innerHTML = '<path fill="currentColor" d="M4.47 6.47a.75.75 0 0 1 1.06 0L8 8.94l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06z"/>'; meta.append(count, caret); trigger.append(label, meta);
    const menu = doc.createElement('div'); menu.className = 'model-pick-menu'; const header = doc.createElement('div'); header.className = 'model-pick-menu-header'; const menuList = doc.createElement('div'); menuList.className = 'model-pick-menu-list'; menuList.setAttribute('role', 'listbox'); menu.append(header, menuList);
    const reg = { wrapper, trigger, menuList, header, count, select, tabIndex: select.getAttribute('tabindex'), ariaHidden: select.getAttribute('aria-hidden'), display: select.style.display, nativeClass: select.classList.contains('model-pick-native') }; models.set(id, reg);
    const parent = select.parentNode; parent.insertBefore(wrapper, parent.querySelector('.model-pick-fetch-link')); wrapper.append(trigger, menu, select); select.dataset.modelPickEnhanced = '1'; select.classList.add('model-pick-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    on(trigger, 'click', event => { event.stopPropagation(); if (select.disabled) return; const opened = wrapper.classList.contains('open'); closeModels(); closeAll(); if (!opened) { wrapper.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); } });
    on(menuList, 'click', event => { const item = event.target instanceof Element ? event.target.closest<HTMLElement>('.model-pick-option') : null; if (!item?.dataset.value || select.disabled) return; event.stopPropagation(); if (select.value !== item.dataset.value) { select.value = item.dataset.value; select.dispatchEvent(new Event('change', { bubbles: true })); } closeModels(); syncModel(id); });
    on(select, 'change', () => syncModel(id)); bind(); syncModel(id);
  }
  function restore(select: HTMLSelectElement, name: string, value: string | null) { if (value === null) select.removeAttribute(name); else select.setAttribute(name, value); }
  return { init, pagination, enhance, sync, refresh, close, closeAll, open, closeModels, enhanceModel, syncModel,
    modelVisible(id: string, visible: boolean) { const reg = models.get(id); if (!reg) return; if (visible) syncModel(id); else reg.wrapper.style.display = 'none'; },
    dispose() {
      if (disposed) return; disposed = true; cleanup.splice(0).forEach(fn => fn()); closeAll(); closeModels();
      for (const [select, reg] of registrations) { reg.menu.remove(); reg.wrapper.parentNode?.insertBefore(select, reg.wrapper); reg.wrapper.remove(); select.classList.remove('settings-native-select'); delete select.dataset.settingsCustomSelect; restore(select, 'tabindex', reg.tabIndex); restore(select, 'aria-hidden', reg.ariaHidden); }
      for (const reg of models.values()) { reg.wrapper.parentNode?.insertBefore(reg.select, reg.wrapper); reg.wrapper.remove(); if (!reg.nativeClass) reg.select.classList.remove('model-pick-native'); delete reg.select.dataset.modelPickEnhanced; restore(reg.select, 'tabindex', reg.tabIndex); restore(reg.select, 'aria-hidden', reg.ariaHidden); reg.select.style.display = reg.display; }
      registrations.clear(); models.clear();
    },
  };
}
export type SettingsSelects = ReturnType<typeof createSettingsSelects>;
