import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { session } from './session';
import { storage } from './storage';

export interface AccessBrowser {
  doc: Document;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  confirm(message: string): boolean;
  prompt(message: string, initial?: string): string | null;
  alert(message: string): void;
  copy(text: string): Promise<void>;
  readClipboard(): Promise<string>;
  download(blob: Blob, filename: string): void;
  pickFile(multiple?: boolean): Promise<File[]>;
  terminal(options: ITerminalOptions): { terminal: Terminal; fit: FitAddon };
  listenPage(listener: (page: string) => void): () => void;
  listenResize(listener: () => void): () => void;
  observe(element: Element, listener: () => void): () => void;
  terminalScrollbar(container: HTMLElement): () => void;
}
export function createAccessBrowser(doc: Document = document): AccessBrowser {
  return {
    doc, storage,
    confirm: message => window.confirm(message), prompt: (message, initial) => window.prompt(message, initial), alert: message => window.alert(message),
    async copy(text) {
      if (navigator.clipboard) return navigator.clipboard.writeText(text);
      const input = doc.createElement('textarea'); input.value = text; doc.body.append(input);
      try { input.select(); doc.execCommand('copy'); } finally { input.remove(); }
    },
    readClipboard: () => navigator.clipboard?.readText() ?? Promise.resolve(''),
    download(blob, filename) {
      const link = doc.createElement('a'); const url = URL.createObjectURL(blob);
      link.href = url; link.download = filename; doc.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    pickFile(multiple = false) {
      return new Promise(resolve => {
        const input = doc.createElement('input'); input.type = 'file'; input.multiple = multiple;
        input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
        input.addEventListener('cancel', () => resolve([]), { once: true }); input.click();
      });
    },
    terminal(options) { const terminal = new Terminal(options); const fit = new FitAddon(); terminal.loadAddon(fit); return { terminal, fit }; },
    listenPage(listener) {
      const handle = (event: Event) => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
        if (typeof detail === 'string') listener(detail);
        else if (detail && typeof detail === 'object' && 'pageId' in detail && typeof detail.pageId === 'string') listener(detail.pageId);
      };
      window.addEventListener('pageChanged', handle); return () => window.removeEventListener('pageChanged', handle);
    },
    listenResize(listener) { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); },
    observe(element, listener) { if (typeof ResizeObserver === 'undefined') return () => undefined; const observer = new ResizeObserver(listener); observer.observe(element); return () => observer.disconnect(); },
    terminalScrollbar(container) {
      const events = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      const show = () => { container.classList.add('is-scrollbar-visible'); clearTimeout(timer); timer = setTimeout(() => container.classList.remove('is-scrollbar-visible'), 900); };
      for (const type of ['wheel', 'touchmove']) container.addEventListener(type, show, { passive: true, signal: events.signal });
      container.addEventListener('scroll', show, { capture: true, passive: true, signal: events.signal });
      return () => { events.abort(); clearTimeout(timer); container.classList.remove('is-scrollbar-visible'); };
    },
  };
}

/** EventSource owns reconnects; closing it also cancels its native retry timer. */
export function openAccessEventStream(receive: (value: unknown) => void): { close(): void } {
  const token = session.read()?.token;
  const source = new EventSource('/api/c2/events/stream' + (token ? '?token=' + encodeURIComponent(token) : ''));
  source.addEventListener('message', event => { try { const value: unknown = JSON.parse(event.data); receive(value); } catch { /* Ignore incomplete frames. */ } });
  return { close: () => source.close() };
}
