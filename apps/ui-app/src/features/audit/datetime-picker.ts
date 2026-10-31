import type { AuditDependencies } from './types';
import { createAuditLabels, escapeAuditHtml } from './labels';

export interface DateParts { y: number; m: number; d: number; h: number; mi: number }
const pad2 = (value: number): string => String(value).padStart(2, '0');
export const partsToStorage = (parts: DateParts | null): string => parts ? `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}T${pad2(parts.h)}:${pad2(parts.mi)}` : '';
export function parseStorage(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]), h: Number(match[4]), mi: Number(match[5]) } : null;
}
const dateParts = (date: Date): DateParts => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes() });
export function buildMonthGrid(year: number, month: number): (Pick<DateParts, 'y' | 'm' | 'd'> & { inMonth: boolean })[] {
  const cursor = new Date(year, month - 1, 1);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  return Array.from({ length: 42 }, () => {
    const cell = { y: cursor.getFullYear(), m: cursor.getMonth() + 1, d: cursor.getDate(), inMonth: cursor.getMonth() === month - 1 };
    cursor.setDate(cursor.getDate() + 1); return cell;
  });
}
interface Field { wrap: HTMLElement; input: HTMLInputElement; clear: HTMLButtonElement }
export function createAuditDatetimePicker(document: Document, dependencies: Pick<AuditDependencies, 'translate' | 'getLocale' | 'viewport'>) {
  const registry = new Map<string, Field>();
  const events = new AbortController();
  const { t } = createAuditLabels(dependencies);
  let popover: HTMLDivElement | null = null;
  let activeFieldId: string | null = null;
  let draft: DateParts | null = null;
  let viewYear = 0, viewMonth = 0;
  let disposed = false;
  let mounted = false;
  const fieldId = (inputId: string) => inputId === 'audit-filter-since' ? 'audit-filter-since-field' : 'audit-filter-until-field';
  function refreshDisplay(id: string): void {
    const field = registry.get(id);
    if (!field) return;
    const parts = parseStorage(field.wrap.dataset.value || '');
    let display = '';
    if (parts) {
      try { display = new Date(parts.y, parts.m - 1, parts.d, parts.h, parts.mi).toLocaleString(dependencies.getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
      catch { display = partsToStorage(parts).replace('T', ' '); }
    }
    field.input.value = display;
    field.input.placeholder = t('settingsAudit.datetimePlaceholder', null, 'Select date & time');
    field.clear.hidden = !parts;
  }
  function applyValue(id: string | null, value: string): void {
    const field = id ? registry.get(id) : undefined;
    if (!field || !id) return;
    field.wrap.dataset.value = value; refreshDisplay(id);
  }
  function close(): void { if (popover) popover.hidden = true; activeFieldId = null; draft = null; }
  function scrollSelected(list: HTMLElement): void { list.querySelector<HTMLElement>('.is-selected')?.scrollIntoView?.({ block: 'center' }); }
  function renderCalendar(): void {
    if (!popover || !draft) return;
    const locale = dependencies.getLocale();
    let title: string;
    try { title = new Date(viewYear, viewMonth - 1, 1).toLocaleString(locale, { month: 'long', year: 'numeric' }); }
    catch { title = `${viewYear}-${pad2(viewMonth)}`; }
    const label = popover.querySelector('.audit-dt-month-label');
    if (label) label.textContent = title;
    const headers = locale.startsWith('ru') ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const calendar = popover.querySelector('.audit-dt-calendar');
    if (calendar) calendar.innerHTML = '<div class="audit-dt-weekdays">' + headers.map(header => `<span>${escapeAuditHtml(header)}</span>`).join('') + '</div><div class="audit-dt-days">' + buildMonthGrid(viewYear, viewMonth).map(cell => {
      const selected = draft && cell.y === draft.y && cell.m === draft.m && cell.d === draft.d;
      return `<button type="button" class="audit-dt-day${cell.inMonth ? '' : ' is-other-month'}${selected ? ' is-selected' : ''}" data-action="audit.date-day" data-day="1" data-y="${cell.y}" data-m="${cell.m}" data-d="${cell.d}">${cell.d}</button>`;
    }).join('') + '</div>';
  }
  function renderTimes(): void {
    if (!popover || !draft) return;
    for (const part of ['hour', 'minute'] as const) {
      const list = popover.querySelector<HTMLElement>(`[data-part="${part}"] .audit-dt-time-list`);
      if (!list) continue;
      const selected = part === 'hour' ? draft.h : draft.mi;
      list.innerHTML = Array.from({ length: part === 'hour' ? 24 : 60 }, (_, value) => `<button type="button" class="audit-dt-time-item${value === selected ? ' is-selected' : ''}" data-action="audit.date-time" data-part="${part}" data-time="${value}">${pad2(value)}</button>`).join('');
      scrollSelected(list);
    }
  }
  function render(): void {
    if (!popover || !draft) return;
    const labels = [
      ['.audit-dt-hour-label', 'pickerHour', 'Hour'], ['.audit-dt-minute-label', 'pickerMinute', 'Min'],
      ['[data-action="audit.date-clear"]', 'pickerClear', 'Clear'], ['[data-action="audit.date-today"]', 'pickerToday', 'Today'], ['[data-action="audit.date-confirm"]', 'pickerConfirm', 'OK'],
    ];
    for (const [selector, key, fallback] of labels) {
      if (!selector || !key || !fallback) continue;
      const element = popover.querySelector(selector); if (element) element.textContent = t('settingsAudit.' + key, null, fallback);
    }
    renderCalendar(); renderTimes();
  }
  function ensurePopover(): HTMLDivElement {
    if (popover) return popover;
    popover = document.createElement('div');
    popover.className = 'audit-dt-popover'; popover.hidden = true; popover.setAttribute('role', 'dialog');
    popover.innerHTML = '<div class="audit-dt-popover-inner"><div class="audit-dt-head">' +
      '<button type="button" class="audit-dt-nav" data-action="audit.date-prev" data-nav="prev" aria-label="prev">&lsaquo;</button><span class="audit-dt-month-label"></span>' +
      '<button type="button" class="audit-dt-nav" data-action="audit.date-next" data-nav="next" aria-label="next">&rsaquo;</button></div>' +
      '<div class="audit-dt-body"><div class="audit-dt-calendar"></div><div class="audit-dt-time">' +
      '<div class="audit-dt-time-col" data-part="hour"><span class="audit-dt-time-label audit-dt-hour-label"></span><div class="audit-dt-time-list"></div></div>' +
      '<div class="audit-dt-time-col" data-part="minute"><span class="audit-dt-time-label audit-dt-minute-label"></span><div class="audit-dt-time-list"></div></div></div></div>' +
      '<div class="audit-dt-footer"><button type="button" class="audit-dt-footer-btn" data-action="audit.date-clear"></button><button type="button" class="audit-dt-footer-btn" data-action="audit.date-today"></button>' +
      '<button type="button" class="audit-dt-footer-btn audit-dt-footer-btn--primary" data-action="audit.date-confirm"></button></div></div>';
    document.body.append(popover);
    popover.addEventListener('click', event => {
      event.stopPropagation();
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
      if (!button) return;
      switch (button.dataset.action) {
        case 'audit.date-prev': case 'audit.date-next': {
          const date = new Date(viewYear, viewMonth - 1 + (button.dataset.nav === 'prev' ? -1 : 1), 1);
          viewYear = date.getFullYear(); viewMonth = date.getMonth() + 1; render(); break;
        }
        case 'audit.date-day':
          if (draft) {
            draft.y = Number(button.dataset.y); draft.m = Number(button.dataset.m); draft.d = Number(button.dataset.d);
            if (viewYear !== draft.y || viewMonth !== draft.m) { viewYear = draft.y; viewMonth = draft.m; renderCalendar(); }
            else {
              const selected = draft;
              popover?.querySelectorAll<HTMLElement>('.audit-dt-day').forEach(day => day.classList.toggle('is-selected', Number(day.dataset.y) === selected.y && Number(day.dataset.m) === selected.m && Number(day.dataset.d) === selected.d));
            }
          }
          break;
        case 'audit.date-time':
          if (draft) {
            if (button.dataset.part === 'hour') draft.h = Number(button.dataset.time); else draft.mi = Number(button.dataset.time);
            // Keep focus and time-column scroll positions when selecting a time.
            popover?.querySelectorAll<HTMLElement>('.audit-dt-time-item').forEach(item => item.classList.toggle('is-selected', Number(item.dataset.time) === (item.dataset.part === 'hour' ? draft?.h : draft?.mi)));
            popover?.querySelectorAll<HTMLElement>('.audit-dt-time-list').forEach(scrollSelected);
          }
          break;
        case 'audit.date-clear': applyValue(activeFieldId, ''); close(); break;
        case 'audit.date-today':
          if (draft) { const now = dateParts(new Date()); draft.y = now.y; draft.m = now.m; draft.d = now.d; viewYear = now.y; viewMonth = now.m; render(); }
          break;
        case 'audit.date-confirm': applyValue(activeFieldId, partsToStorage(draft)); close(); break;
      }
    }, { signal: events.signal });
    return popover;
  }
  function open(id: string): void {
    if (disposed) return;
    const field = registry.get(id); if (!field) return;
    const panel = ensurePopover();
    activeFieldId = id; draft = parseStorage(field.wrap.dataset.value || '') || dateParts(new Date());
    viewYear = draft.y; viewMonth = draft.m; render();
    const rect = field.wrap.getBoundingClientRect(), viewport = dependencies.viewport();
    panel.style.width = '320px';
    panel.style.left = (rect.left + 320 > viewport.width - 12 ? Math.max(12, viewport.width - 332) : rect.left) + 'px';
    panel.style.top = (rect.bottom + 346 > viewport.height - 12 ? Math.max(12, rect.top - 346) : rect.bottom + 6) + 'px';
    panel.hidden = false;
  }
  function bindField(id: string): void {
    if (registry.has(id) || disposed) return;
    const wrap = document.getElementById(id);
    const input = wrap?.querySelector<HTMLInputElement>('.audit-datetime-input');
    const openButton = wrap?.querySelector<HTMLButtonElement>('.audit-datetime-open-btn');
    const clear = wrap?.querySelector<HTMLButtonElement>('.audit-datetime-clear-btn');
    if (!wrap || !input || !openButton || !clear) return;
    registry.set(id, { wrap, input, clear }); wrap.dataset.auditDtBound = '1';
    input.dataset.action = 'audit.date-open'; openButton.dataset.action = 'audit.date-toggle'; clear.dataset.action = 'audit.date-field-clear';
    wrap.addEventListener('click', event => {
      const action = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]')?.dataset.action : undefined;
      if (!action?.startsWith('audit.date-')) return;
      event.preventDefault(); event.stopPropagation();
      if (action === 'audit.date-field-clear') applyValue(id, '');
      else if (action === 'audit.date-toggle' && popover && !popover.hidden && activeFieldId === id) close();
      else open(id);
    }, { signal: events.signal });
    refreshDisplay(id);
  }
  function mount(): void {
    if (mounted || disposed) return; mounted = true;
    document.addEventListener('click', event => {
    if (!popover || popover.hidden || !(event.target instanceof Node) || popover.contains(event.target)) return;
    if (activeFieldId && registry.get(activeFieldId)?.wrap.contains(event.target)) return;
    close();
  }, { signal: events.signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, { signal: events.signal });
  document.addEventListener('languagechange', () => { if (popover && !popover.hidden) render(); registry.forEach((_, id) => refreshDisplay(id)); }, { signal: events.signal });
  }
  return {
    init(): void { mount(); bindField('audit-filter-since-field'); bindField('audit-filter-until-field'); registry.forEach((_, id) => refreshDisplay(id)); },
    getValue(inputId: string): string { return registry.get(fieldId(inputId))?.wrap.dataset.value || ''; },
    setValue(inputId: string, date: Date): void { if (!Number.isNaN(date.getTime())) applyValue(fieldId(inputId), partsToStorage(dateParts(date))); },
    clearAll(): void { registry.forEach((_, id) => applyValue(id, '')); close(); },
    dispose(): void { disposed = true; events.abort(); close(); popover?.remove(); popover = null; registry.forEach(field => { delete field.wrap.dataset.auditDtBound; }); registry.clear(); },
  };
}
export type AuditDatetimePicker = ReturnType<typeof createAuditDatetimePicker>;
