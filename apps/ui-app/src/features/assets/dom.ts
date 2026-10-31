import { escapeHtml, type ToastHandle, type ToastOptions } from './contracts';

export function createDOM(doc: Document, signal: AbortSignal) {
  const get = (id: string) => doc.getElementById(id);
  const field = (id: string) => {
    const element = get(id);
    return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element : null;
  };
  return {
    get, field,
    value: (id: string) => field(id)?.value ?? '',
    set(id: string, value: string | number) { const el = field(id); if (el) el.value = String(value); },
    text(id: string, value: string | number) { const el = get(id); if (el) el.textContent = String(value); },
    html(id: string, value: string) { const el = get(id); if (el) el.innerHTML = value; },
    hidden(id: string, hidden: boolean) { const el = get(id); if (el) el.hidden = hidden; },
    busy(id: string, disabled: boolean) {
      const el = get(id);
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        el.disabled = disabled; el.dataset.stateDisabled = String(disabled); el.setAttribute('aria-disabled', String(disabled));
      }
    },
    on<K extends keyof (DocumentEventMap & { languagechange: Event })>(type: K, listener: (event: (DocumentEventMap & { languagechange: Event })[K]) => void) { doc.addEventListener(type, listener as EventListener, { signal }); },
  };
}

export type ActionHandler = (element: HTMLElement, event: Event) => void | Promise<unknown>;
export function bindActions(doc: Document, signal: AbortSignal, handlers: Record<string, ActionHandler>, onError: (error: unknown) => void): void {
  for (const type of ['click', 'change', 'input', 'keydown', 'submit'] as const) {
    doc.addEventListener(type, event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(`[data-assets-${type}]`);
      if (!el || el.getAttribute('aria-disabled') === 'true' || (el instanceof HTMLButtonElement && el.disabled)) return;
      const handler = handlers[el.getAttribute(`data-assets-${type}`) ?? ''];
      if (!handler) return;
      if (type === 'submit') event.preventDefault();
      Promise.resolve(handler(el, event)).catch(onError);
    }, { signal });
  }
}
export function action(name: string, args: Record<string, string | number> = {}, event = 'click'): string {
  return `data-assets-${event}="${escapeHtml(name)}" ` + Object.entries(args).map(([key, value]) => `data-${key}="${escapeHtml(value)}"`).join(' ');
}
export function toast(doc: Document, text: string, options: ToastOptions = {}): ToastHandle {
  if (options.id && options.replace !== false) doc.getElementById(options.id)?.remove();
  const el = doc.createElement('div'); if (options.id) el.id = options.id;
  el.textContent = text;
  el.style.cssText = 'position:fixed;top:24px;right:24px;background:rgba(0,0,0,.85);color:#fff;padding:10px 12px;border-radius:8px;z-index:10000;font-size:13px;max-width:420px;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,.22)';
  doc.body.append(el);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = () => { clearTimeout(timer); el.remove(); };
  if ((options.duration ?? 1200) > 0) timer = setTimeout(remove, options.duration ?? 1200);
  return { remove };
}
export const icon = (kind: 'copy' | 'scan' | 'download' | 'edit' | 'delete' | 'import') => {
  const paths = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    scan: '<path d="M10.5 13.5l3-3M8 8H5a4 4 0 1 0 0 8h3M16 8h3a4 4 0 0 1 0 8h-3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    delete: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>',
    import: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/>',
  };
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`;
};
