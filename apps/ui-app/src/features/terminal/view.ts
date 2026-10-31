import type { ITerminalOptions } from '@xterm/xterm';
import type { TerminalRenderer, TerminalFit } from '../../platform/terminal-browser';
import { createTerminalConnection, type TerminalConnectionOptions } from './service';

export interface TerminalDependencies {
  translate(key: string, options?: Record<string, string | number>): string;
  terminalURL(): string;
  listenResize(listener: () => void): () => void;
  socketFactory: TerminalConnectionOptions['factory'];
  createTerminal(options: ITerminalOptions): { terminal: TerminalRenderer; fit: TerminalFit };
  allow(permission: string): boolean;
}
interface Tab {
  id: number;
  terminal: TerminalRenderer;
  fit: TerminalFit;
  connection: ReturnType<typeof createTerminalConnection>;
  observer?: ResizeObserver;
  timer?: ReturnType<typeof setTimeout>;
  frame?: number;
  events: AbortController;
  pane: HTMLElement;
  button: HTMLElement;
}

export function createTerminalView(document: Document, deps: TerminalDependencies) {
  const tabs: Tab[] = [];
  const events = new AbortController();
  let currentId = 1;
  let unlisten: (() => void) | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let disposed = false;
  const tr = deps.translate;
  function fit(tab: Tab): void {
    try { tab.fit.fit(); tab.terminal.scrollToBottom(); } catch { /* Hidden panes have no dimensions. */ }
  }
  function switchTerminalTab(id: number): void {
    if (disposed || !tabs.some(tab => tab.id === id)) return;
    currentId = id;
    for (const tab of tabs) {
      tab.button.classList.toggle('active', tab.id === id);
      tab.pane.classList.toggle('active', tab.id === id);
      if (tab.frame !== undefined) cancelAnimationFrame(tab.frame);
      if (tab.id === id) {
        fit(tab); tab.terminal.focus();
        tab.frame = requestAnimationFrame(() => { if (!disposed && currentId === tab.id) { fit(tab); tab.terminal.focus(); } });
      }
    }
  }
  function refreshLabels(): void {
    for (const tab of tabs) {
      tab.button.dataset.tabId = String(tab.id);
      tab.pane.id = `terminal-pane-${tab.id}`;
      const container = tab.pane.querySelector<HTMLElement>('.terminal-container');
      if (container) { container.id = `terminal-container-${tab.id}`; container.title = tr('settingsTerminal.containerClickTitle'); }
      const label = tab.button.querySelector('.terminal-tab-label');
      if (label) label.textContent = tr('settingsTerminal.terminalTab', { n: tab.id });
      const close = tab.button.querySelector<HTMLElement>('.terminal-tab-close');
      if (close) { close.title = tr('settingsTerminal.closeTabTitle'); close.style.display = tabs.length > 1 ? '' : 'none'; }
    }
  }
  function create(pane: HTMLElement, button: HTMLElement): void {
    const container = pane.querySelector<HTMLElement>('.terminal-container');
    if (!container) return;
    const { terminal, fit: addon } = deps.createTerminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace', lineHeight: 1.2,
      smoothScrollDuration: 0, scrollSensitivity: 1, fastScrollSensitivity: 5, scrollback: 1000,
      theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0d1117', selectionBackground: 'rgba(88, 166, 255, 0.3)', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#e6edf3', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' },
    });
    terminal.open(container);
    terminal.write(tr('settingsTerminal.welcomeLine') + '\r\n');
    const connection = createTerminalConnection({
      url: deps.terminalURL, factory: deps.socketFactory,
      opened: () => terminal.focus(),
      output: data => terminal.write(data, () => terminal.scrollToBottom()),
      closed: () => terminal.writeln('\r\n\x1b[2m' + tr('settingsTerminal.sessionClosed') + '\x1b[0m'),
      error: error => terminal.writeln('\r\n\x1b[31m' + tr(error instanceof Error ? 'settingsTerminal.connectFailed' : 'settingsTerminal.connectionError', { msg: String(error) }) + '\x1b[0m'),
    });
    const tab: Tab = { id: tabs.length + 1, terminal, fit: addon, connection, pane, button, events: new AbortController() };
    tabs.push(tab);
    container.tabIndex = 0;
    container.addEventListener('click', () => switchTerminalTab(tab.id), { signal: tab.events.signal });
    terminal.onData(data => { if (data === '\x0c') terminal.clear(); connection.send(data); });
    terminal.onResize(size => connection.resize(size.cols, size.rows));
    if (typeof ResizeObserver !== 'undefined') {
      tab.observer = new ResizeObserver(() => { clearTimeout(tab.timer); tab.timer = setTimeout(() => fit(tab), 50); });
      tab.observer.observe(container);
    }
    fit(tab);
    connection.resize(terminal.cols, terminal.rows);
    connection.connect();
    refreshLabels();
    switchTerminalTab(tab.id);
    tab.timer = setTimeout(() => fit(tab), 100);
  }
  function addTerminalTab(): void {
    if (disposed || !deps.allow('terminal:execute')) return;
    initTerminal();
    if (!tabs.length) return;
    const buttons = document.querySelector('.terminal-tabs');
    const panes = document.querySelector('.terminal-panes');
    if (!buttons || !panes) return;
    const button = document.createElement('div');
    button.className = 'terminal-tab';
    button.innerHTML = '<span class="terminal-tab-label" data-action="terminal.switch"></span><button type="button" class="terminal-tab-close" data-action="terminal.remove">×</button>';
    buttons.insertBefore(button, buttons.querySelector('.terminal-tab-new'));
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.innerHTML = '<div class="terminal-container"></div>';
    panes.appendChild(pane);
    create(pane, button);
  }
  function release(tab: Tab): void {
    clearTimeout(tab.timer);
    if (tab.frame !== undefined) cancelAnimationFrame(tab.frame);
    tab.events.abort(); tab.observer?.disconnect(); tab.connection.dispose(); tab.terminal.dispose();
  }
  function removeTerminalTab(id: number): void {
    if (disposed || tabs.length <= 1 || !deps.allow('terminal:execute')) return;
    const index = tabs.findIndex(tab => tab.id === id);
    const tab = tabs[index];
    if (!tab) return;
    const selected = tabs.find(item => item.id === currentId);
    release(tab); tab.button.remove(); tab.pane.remove(); tabs.splice(index, 1);
    tabs.forEach((item, i) => { item.id = i + 1; });
    refreshLabels();
    switchTerminalTab(selected && selected !== tab ? selected.id : tabs[Math.max(0, index - 1)]!.id);
  }
  function initTerminal(): void {
    if (disposed) return;
    if (tabs.length) { tabs.forEach(fit); tabs.find(tab => tab.id === currentId)?.terminal.focus(); return; }
    const pane = document.getElementById('terminal-pane-1');
    const button = document.querySelector<HTMLElement>('.terminal-tab[data-tab-id="1"]');
    if (!pane || !button) return;
    create(pane, button);
  }
  return {
    initTerminal, addTerminalTab, removeTerminalTab, switchTerminalTab,
    activate(): void {
      if (active || disposed) return;
      active = true;
      document.querySelector('.terminal-tabs')?.addEventListener('click', event => {
        const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
        if (!element || (element instanceof HTMLButtonElement && element.disabled)) return;
        const action = element.dataset.action;
        const id = Number(element.closest<HTMLElement>('.terminal-tab')?.dataset.tabId);
        if (action === 'terminal.add') addTerminalTab();
        else if (action === 'terminal.remove') { event.stopPropagation(); removeTerminalTab(id); }
        else if (action === 'terminal.switch') switchTerminalTab(id);
      }, { signal: events.signal });
      document.addEventListener('languagechange', refreshLabels, { signal: events.signal });
      unlisten = deps.listenResize(() => {
        clearTimeout(resizeTimer); resizeTimer = setTimeout(() => tabs.forEach(fit), 150);
      });
    },
    terminalClear(): void { const tab = tabs.find(tab => tab.id === currentId); tab?.terminal.clear(); tab?.terminal.focus(); },
    dispose(): void { disposed = true; events.abort(); unlisten?.(); clearTimeout(resizeTimer); tabs.forEach(release); tabs.length = 0; },
  };
}
