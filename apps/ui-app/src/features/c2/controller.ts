import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { AccessBrowser } from '../../platform/access-browser';
import { createActions } from '../../ui/actions';
import { closeAppModal, openAppModal } from '../../ui/modal';
import { joinFilePath, listenerCallbackHost, listenerConfig, onelinerKinds, parentFilePath, parseLsLine, sessionSupportsUpload, timePresetToSince, type C2FileEntry, type C2Listener, type ListenerDraft, type ProfileDraft } from './model';
import type { C2Service } from './service';
import { escapeHtml, type C2View } from './view';

export interface C2ControllerDependencies {
  browser: AccessBrowser;
  t(key: string, options?: Record<string, string | number>): string;
  notify(message: string, type: 'success' | 'error' | 'info' | 'warning'): void;
  can(permission: string): boolean;
  ensureProjects(): Promise<unknown>;
  currentPage(): string;
  activeProject?(): string;
}
export function createC2Controller(deps: C2ControllerDependencies, service: C2Service, view: C2View) {
  const { browser } = deps; const { doc } = browser; const state = service.state;
  const actions = createActions(); const events = new AbortController();
  let unbind: (() => void) | undefined; let unsubscribe: (() => void) | undefined; let unpage: (() => void) | undefined; let unresize: (() => void) | undefined;
  let active = false; let disposed = false; let sessionRendered = ''; let currentTab = 'terminal';
  let terminal: Terminal | undefined; let fit: FitAddon | undefined; let unobserve: (() => void) | undefined;
  let unscrollbar: (() => void) | undefined;
  let line = ''; let cursor = 0; let historyIndex = -1; let fileVersion = 0; let listenerEditId = ''; let sleepSessionId = '';
  let renderedPage = '';
  let profileEditId = ''; let sessionTasksPage = 1; let sessionTasksTotal = 0; let sessionTasksVersion = 0;
  let sessionLoads = ''; let freshnessTimer: ReturnType<typeof setInterval> | undefined;
  view.mountWorkspaces();
  let listenersSnapshot: C2Listener[] | undefined; let sessionsSnapshot = state.sessions; let tasksSnapshot = state.tasks; let eventsSnapshot = state.events; let profilesSnapshot = state.profiles;
  const value = (id: string) => { const el = doc.getElementById(id); return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? el.value : ''; };
  const assign = (id: string, text: string) => { const el = doc.getElementById(id); if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.value = text; };
  const report = (error: unknown) => { if (!disposed) { const message = error instanceof Error ? error.message : String(error); const text = deps.t(message); deps.notify(text, 'error'); const inline = view.element('c2-form-error'); if (inline && view.element('c2-modal')?.style.display !== 'none') { inline.hidden = false; inline.textContent = text; } } };
  const run = (operation: () => void | Promise<unknown>) => { try { const promise = operation(); if (promise) void promise.catch(report); } catch (error) { report(error); } };
  function register(name: string, handler: (el: HTMLElement, event: Event) => void | Promise<unknown>): void {
    actions.register('c2.' + name, (el, event) => {
      event.stopPropagation(); if (event.type === 'click' && !(event.target instanceof Element && event.target.closest('input,select,textarea,label'))) event.preventDefault();
      if (el.dataset.c2Busy === 'true') return;
      run(async () => { const button = el instanceof HTMLButtonElement ? el : null; const disabled = button?.disabled; const operation = handler(el, event); if (!operation) return; el.dataset.c2Busy = 'true'; if (button) button.disabled = true; el.setAttribute('aria-busy', 'true'); try { await operation; } finally { delete el.dataset.c2Busy; el.removeAttribute('aria-busy'); if (button?.isConnected) button.disabled = disabled || button.dataset.stateDisabled === 'true'; } });
    });
  }
  function destroyTerminal(): void { unobserve?.(); unobserve = undefined; unscrollbar?.(); unscrollbar = undefined; terminal?.dispose(); terminal = undefined; fit = undefined; line = ''; cursor = 0; }
  function fitTerminal(): void { try { fit?.fit(); } catch { /* Hidden pane. */ } }
  function initTerminal(): void {
    destroyTerminal(); const session = service.selectedSession(); const container = view.element('c2-terminal-container'); if (!session || !container) return;
    if (session.implantUuid?.startsWith('curl_')) { container.innerHTML = `<div class="c2-terminal-unavailable"><h3>${view.t('c2.sessions.curlBeaconTitle')}</h3><p>${view.t('c2.sessions.curlBeaconBody')}</p></div>`; return; }
    const created = browser.terminal({ cursorBlink: true, cursorStyle: 'block', fontSize: 14, fontFamily: 'Menlo, Monaco, "Courier New", "PingFang SC", "Microsoft YaHei", monospace', lineHeight: 1.3, scrollback: 5000, theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0d1117', selectionBackground: 'rgba(88,166,255,.3)' } });
    terminal = created.terminal; fit = created.fit; const term = terminal; term.open(container); term.write(service.terminalLog(session.id) || '$ '); historyIndex = service.terminalHistory(session.id).length;
    const redraw = () => term.write('\r\x1b[2K$ ' + line + (cursor < line.length ? `\x1b[${line.length - cursor}D` : ''));
    term.onData(data => {
      if (disposed) return;
      if (data === '\x03') { line = ''; cursor = 0; term.write('^C' + (state.terminalBusy ? ' (' + deps.t('c2.sessions.termCtrlC') + ')' : '') + '\r\n$ '); return; }
      if (data === '\x0c') { clearTerminal(); return; }
      if (service.state.terminalBusy) return;
      if (data === '\x16') { run(async () => { const text = await browser.readClipboard(); if (text) paste(text); }); return; }
      if (data.length > 1 && !data.startsWith('\x1b')) { paste(data); return; }
      if (data === '\r') { const command = line.trim(); line = ''; cursor = 0; term.write('\r\n'); if (command) run(() => executeInTerminal(command)); else term.write('$ '); return; }
      if (data === '\x1b[A' || data === '\x1b[B') { const history = service.terminalHistory(session.id); historyIndex = Math.max(0, Math.min(history.length, historyIndex + (data.endsWith('A') ? -1 : 1))); line = history[historyIndex] || ''; cursor = line.length; redraw(); return; }
      if (data === '\x7f') { if (cursor > 0) { line = line.slice(0, cursor - 1) + line.slice(cursor); cursor--; redraw(); } return; }
      if (data === '\x1b[D') { if (cursor) { cursor--; term.write(data); } return; } if (data === '\x1b[C') { if (cursor < line.length) { cursor++; term.write(data); } return; }
      if (data === '\x1b[3~') { line = line.slice(0, cursor) + line.slice(cursor + 1); redraw(); return; }
      if (data === '\x01' || data === '\x1b[H') { cursor = 0; redraw(); return; } if (data === '\x05' || data === '\x1b[F') { cursor = line.length; redraw(); return; }
      if (data === '\x15') { line = ''; cursor = 0; redraw(); return; }
      if (data === '\x0b') { line = line.slice(0, cursor); redraw(); return; }
      if (data === '\x17' || data === '\x1b\x7f') { let index = cursor; while (index > 0 && /\s/.test(line[index - 1]!)) index--; while (index > 0 && !/\s/.test(line[index - 1]!)) index--; line = line.slice(0, index) + line.slice(cursor); cursor = index; redraw(); return; }
      if (data === '\x1b[1;3D' || data === '\x1bb') { while (cursor > 0 && /\s/.test(line[cursor - 1]!)) cursor--; while (cursor > 0 && !/\s/.test(line[cursor - 1]!)) cursor--; redraw(); return; }
      if (data === '\x1b[1;3C' || data === '\x1bf') { while (cursor < line.length && /\s/.test(line[cursor]!)) cursor++; while (cursor < line.length && !/\s/.test(line[cursor]!)) cursor++; redraw(); return; }
      const printable = Array.from(data).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join(''); if (!printable) return;
      line = line.slice(0, cursor) + printable + line.slice(cursor); cursor += printable.length; redraw();
    });
    let lastPaste = ''; let lastPasteAt = 0;
    function paste(text: string): void {
      if (text === lastPaste && Date.now() - lastPasteAt < 80) return; lastPaste = text; lastPasteAt = Date.now();
      const parts = (line.slice(0, cursor) + text.replace(/\r\n?/g, '\n') + line.slice(cursor)).split('\n'); const tail = parts.pop() || '';
      if (!parts.length) { line = tail; cursor = line.length; redraw(); return; }
      line = ''; cursor = 0;
      run(async () => { for (const command of parts) if (command.trim()) { if (terminal !== term) return; term.write(command + '\r\n'); await executeInTerminal(command.trim()); } if (terminal === term) { line = tail; cursor = line.length; redraw(); } });
    }
    term.attachCustomKeyEventHandler(event => { if (event.type !== 'keydown') return true; if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'v' || event.shiftKey && event.key === 'Insert') { event.preventDefault(); run(async () => paste(await browser.readClipboard())); return false; } return true; });
    unobserve = browser.observe(container, fitTerminal); unscrollbar = browser.terminalScrollbar(container); fitTerminal(); term.focus();
  }
  async function executeInTerminal(command: string): Promise<void> {
    if (!deps.can('c2:write')) return; const sessionId = state.selectedSessionId; const term = terminal; if (!sessionId || !term) return;
    if (command === 'clear' || command === 'cls') { clearTerminal(); return; }
    service.appendTerminalLog(sessionId, command + '\r\n');
    await service.executeCommand(command, (text, error) => { const message = error ? deps.t(text) : text; const output = message.replace(/\r?\n/g, '\r\n') + '\r\n'; service.appendTerminalLog(sessionId, output); if (terminal === term && state.selectedSessionId === sessionId) { term.write((error ? '\x1b[31m' : '') + output + (error ? '\x1b[0m' : '')); term.scrollToBottom(); } });
    service.appendTerminalLog(sessionId, '$ '); if (terminal === term) { term.write('$ '); term.focus(); historyIndex = service.terminalHistory(sessionId).length; }
  }
  function clearTerminal(): void { if (state.terminalBusy) return; terminal?.clear(); terminal?.write('\r\x1b[2K$ '); line = ''; cursor = 0; if (state.selectedSessionId) service.clearTerminalLog(state.selectedSessionId); }
  async function copyTerminal(): Promise<void> { const selection = terminal?.getSelection(); if (selection) await browser.copy(selection); else deps.notify(deps.t('c2.sessions.termNoSelection'), 'warning'); }
  async function selectSession(id: string): Promise<void> {
    if (!state.sessions.some(session => session.id === id)) return;
    if (sessionRendered === id && view.element('c2-tab-' + currentTab)) return;
    fileVersion++; sessionTasksPage = 1; sessionLoads = '';
    sessionRendered = id; state.terminalFeedback = ''; state.terminalTaskId = ''; service.selectSession(id); view.renderSessions(); const session = service.selectedSession(); if (!session) return;
    view.renderSessionDetail(session, currentTab); view.renderSessionConnection(session); initTerminal(); updateUpload();
    await loadCurrentTab();
  }
  function switchTab(tab: string): void {
    if (!['terminal', 'files', 'tasks', 'info'].includes(tab)) return; currentTab = tab;
    doc.querySelectorAll<HTMLElement>('.c2-session-tab').forEach(el => { el.classList.toggle('active', el.dataset.tab === tab); if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    doc.querySelectorAll<HTMLElement>('.c2-tab-panel').forEach(el => { const selected = el.id === 'c2-tab-' + tab; el.classList.toggle('active', selected); el.hidden = !selected; });
    if (tab === 'terminal') { fitTerminal(); terminal?.focus(); }
    run(loadCurrentTab);
  }
  async function loadCurrentTab(): Promise<void> {
    const id = state.selectedSessionId; if (!id) return;
    if (currentTab === 'files' && sessionLoads !== id) { sessionLoads = id; await loadFiles('.'); }
    if (currentTab === 'tasks') await loadSessionTasks(id);
  }
  async function loadFiles(path = state.currentPath): Promise<void> {
    const id = state.selectedSessionId; if (!id) return; const version = ++fileVersion;
    view.set('c2-file-list', `<div class="c2-loading">${view.t('c2.files.loading')}</div>`);
    let output: string;
    try { output = await service.loadFileList(id, path); }
    catch (error) { if (version === fileVersion && state.selectedSessionId === id) { view.set('c2-file-list', `<div class="c2-error" role="alert"><strong>${view.t('c2.files.loadFailed', { path })}</strong><p>${escapeHtml(deps.t(error instanceof Error ? error.message : String(error)))}</p><button type="button" class="btn-secondary btn-sm" data-action="c2.file-path" data-path="${escapeHtml(path)}">${view.t('c2.common.retry')}</button></div>`); } return; }
    if (disposed || version !== fileVersion || state.selectedSessionId !== id) return;
    state.fileList = output.split(/\r?\n/).map(parseLsLine).filter((entry): entry is C2FileEntry => Boolean(entry)); view.renderFiles();
    if (!state.implantPwd) void service.refreshPwd(id).then(() => { if (!disposed && version === fileVersion && state.selectedSessionId === id) view.renderBreadcrumbs(service.remotePath(state.currentPath, '')); }).catch(() => undefined);
  }
  async function loadSessionTasks(id: string): Promise<void> {
    const version = ++sessionTasksVersion; view.set('c2-session-tasks-list', `<div class="c2-loading" role="status">${view.t('c2.common.loading')}</div>`);
    try { const data = await service.sessionTasks(id, sessionTasksPage); if (disposed || state.selectedSessionId !== id || version !== sessionTasksVersion) return;
      sessionTasksTotal = data.total ?? data.tasks?.length ?? 0; const max = Math.max(1, Math.ceil(sessionTasksTotal / 25)); if (sessionTasksPage > max) { sessionTasksPage = max; return loadSessionTasks(id); }
      view.renderSessionTasks(id, data.tasks || [], sessionTasksTotal, sessionTasksPage);
      const prev = doc.querySelector<HTMLButtonElement>('[data-action="c2.session-tasks-prev"]'); const next = doc.querySelector<HTMLButtonElement>('[data-action="c2.session-tasks-next"]'); if (prev) prev.disabled = sessionTasksPage <= 1; if (next) next.disabled = sessionTasksPage >= max;
    } catch (error) { if (!disposed && state.selectedSessionId === id && version === sessionTasksVersion) view.set('c2-session-tasks-list', `<div class="c2-error" role="alert">${view.t('c2.tasks.loadFailed')}<p>${escapeHtml(deps.t(error instanceof Error ? error.message : String(error)))}</p>${view.action('session-tasks-refresh', view.t('common.retry'), id)}</div>`); }
  }
  function updateUpload(): void {
    const button = view.element('c2-file-upload-btn'); const supported = sessionSupportsUpload(service.selectedSession());
    if (button instanceof HTMLButtonElement) { const disabled = state.fileUploadBusy || !supported || !deps.can('c2:write'); button.disabled = disabled; button.dataset.stateDisabled = String(disabled); button.setAttribute('aria-disabled', String(disabled)); }
    const hint = view.element('c2-file-upload-hint'); if (hint) { hint.hidden = supported; hint.textContent = supported ? '' : deps.t('c2.files.uploadUnsupported'); }
    const progress = view.element('c2-file-upload-progress'); if (progress) progress.hidden = !state.uploadProgress.visible;
    const fill = view.element('c2-file-upload-progress-fill'); if (fill) fill.style.width = state.uploadProgress.percent + '%'; const label = view.element('c2-file-upload-progress-label'); if (label) label.textContent = `${state.uploadProgress.filename} ${state.uploadProgress.percent}%`;
  }
  async function upload(file: File): Promise<void> { await service.uploadFile(file); deps.notify(deps.t('c2.files.uploadOk'), 'success'); await loadFiles(); }
  async function download(filename: string): Promise<void> { const blob = await service.downloadFile(filename); if (blob) browser.download(blob, filename); }
  function formDraft(): ListenerDraft {
    const existing = state.listeners.find(listener => listener.id === listenerEditId);
    const legacy = doc.querySelector<HTMLInputElement>('#c2-listener-legacy-shell');
    const config = listenerConfig(existing); if (legacy && (existing?.type || value('c2-listener-type')) === 'tcp_reverse') config.allow_legacy_shell = legacy.checked;
    const legacyConfig = existing || Object.keys(config).length ? { config } : {};
    return { name: value('c2-listener-name').trim(), ...(existing ? {} : { type: value('c2-listener-type') }), bind_host: value('c2-listener-host') || '127.0.0.1', bind_port: Number(value('c2-listener-port')), callback_host: value('c2-listener-callback-host').trim(), remark: value('c2-listener-remark'), project_id: value('c2-listener-project-id').trim(), profile_id: value('c2-listener-profile-id').trim(), ...legacyConfig };
  }
  function syncListenerType(): void {
    const existing = state.listeners.find(listener => listener.id === listenerEditId); const type = existing?.type || value('c2-listener-type');
    const profile = view.element('c2-listener-profile-group'); if (profile) profile.style.display = ['http_beacon', 'https_beacon'].includes(type) ? '' : 'none';
    if (!['http_beacon', 'https_beacon'].includes(type) && !existing) assign('c2-listener-profile-id', '');
    const legacy = view.element('c2-listener-legacy-shell-group'); if (legacy) legacy.style.display = type === 'tcp_reverse' ? '' : 'none';
  }
  async function openListener(id?: string): Promise<void> {
    if (!deps.can('c2:write')) return; await Promise.all([service.loadProfiles(), deps.ensureProjects()]); if (disposed) return;
    const listener = id ? state.listeners.find(item => item.id === id) : undefined; if (id && !listener) return;
    listenerEditId = id || ''; view.listenerForm(listener); const legacy = doc.querySelector<HTMLInputElement>('#c2-listener-legacy-shell'); if (legacy) legacy.checked = listenerConfig(listener).allow_legacy_shell === true;
    if (!listener) { assign('c2-listener-type', 'http_beacon'); assign('c2-listener-port', ''); assign('c2-listener-project-id', deps.activeProject?.() || ''); }
    syncListenerType(); refreshFormSelects(); openAppModal('c2-modal');
  }
  function validateListenerForm(creating: boolean): boolean {
    const checks: [string, string, (text: string) => boolean][] = [
      ['c2-listener-name', 'c2.listeners.nameRequired', text => Boolean(text.trim())],
      ...(creating ? [['c2-listener-type', 'c2.listeners.typeRequired', (text: string) => Boolean(text)] as [string, string, (text: string) => boolean]] : []),
      ['c2-listener-port', 'c2.listeners.portInvalid', text => /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 65535],
    ];
    let first: HTMLInputElement | HTMLSelectElement | undefined; let message = '';
    for (const [id, key, valid] of checks) {
      const input = view.element(id); if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) continue;
      const invalid = !valid(input.value); input.setAttribute('aria-invalid', String(invalid)); input.setCustomValidity(invalid ? deps.t(key) : '');
      if (invalid && !first) { first = input; message = deps.t(key); }
    }
    if (first) { deps.notify(message, 'error'); first.focus(); first.reportValidity(); return false; }
    return true;
  }
  async function saveListener(id = listenerEditId): Promise<void> { if (!validateListenerForm(!id)) return; await service.saveListener(formDraft(), id || undefined); closeModal(); deps.notify(deps.t(id ? 'c2.listeners.toastUpdated' : 'c2.listeners.toastCreated'), 'success'); }
  function closeModal(): void { closeAppModal('c2-modal'); view.element('c2-modal')?.querySelector('.c2-modal')?.classList.remove('c2-modal--wide', 'c2-modal--sleep'); listenerEditId = ''; sleepSessionId = ''; profileEditId = ''; }
  async function removeListener(id: string): Promise<void> { if (!browser.confirm(deps.t('c2.listeners.confirmDelete'))) return; await service.listenerAction(id, 'delete'); }
  function editSleep(id: string): void {
    const session = state.sessions.find(item => item.id === id); if (!session || !deps.can('c2:write')) return; sleepSessionId = id;
    const box = view.element('c2-modal')?.querySelector('.c2-modal'); box?.classList.add('c2-modal--sleep'); box?.classList.remove('c2-modal--wide');
    const seconds = session.sleepSeconds ?? 5; const jitter = session.jitterPercent ?? 0;
    view.set('c2-modal-content', `<div class="c2-sleep-modal"><div class="c2-sleep-modal__header"><div class="c2-sleep-modal__title-wrap"><div class="c2-sleep-modal__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div><h3 class="c2-sleep-modal__title">${view.t('c2.sessions.sleepModalTitle')}</h3><p class="c2-sleep-modal__host">${escapeHtml(session.hostname || session.id)}</p></div></div>${view.action('modal-close', '&times;', '', 'c2-modal-close')}</div>
      <div class="c2-sleep-modal__current">${view.t('c2.sessions.sleepModalCurrent', { sec: seconds, jitter })}</div><div class="c2-sleep-modal__body">
      <div class="c2-sleep-field"><div class="c2-sleep-field__head"><label for="c2-sleep-seconds">${view.t('c2.sessions.promptSleepSeconds')}</label><span class="c2-sleep-field__value"><span id="c2-sleep-seconds-display">${seconds}</span>s</span></div><div class="c2-sleep-field__control"><input type="range" id="c2-sleep-seconds-range" class="c2-sleep-range" min="1" max="300" step="1" value="${seconds}" data-input="c2.sleep-range"><input type="number" id="c2-sleep-seconds" class="c2-sleep-number" min="1" max="3600" value="${seconds}" data-input="c2.sleep-sync" data-change="c2.sleep-sync"></div><div class="c2-sleep-presets"><span class="c2-sleep-presets__label">${view.t('c2.sessions.sleepModalPresets')}</span>${[5, 10, 30, 60, 120, 300].map(preset => `<button type="button" class="c2-sleep-preset${preset === seconds ? ' is-active' : ''}" data-c2-sleep-preset="${preset}" data-action="c2.sleep-preset" data-seconds="${preset}">${preset}s</button>`).join('')}</div></div>
      <div class="c2-sleep-field"><div class="c2-sleep-field__head"><label for="c2-sleep-jitter">${view.t('c2.sessions.promptJitterPercent')}</label><span class="c2-sleep-field__value"><span id="c2-sleep-jitter-display">${jitter}</span>%</span></div><div class="c2-sleep-field__control"><input type="range" id="c2-sleep-jitter-range" class="c2-sleep-range" min="0" max="100" step="1" value="${jitter}" data-input="c2.sleep-range"><input type="number" id="c2-sleep-jitter" class="c2-sleep-number" min="0" max="100" value="${jitter}" data-input="c2.sleep-sync" data-change="c2.sleep-sync"></div></div>
      <div class="c2-sleep-modal__preview" id="c2-sleep-preview" role="status"></div><p class="c2-sleep-modal__hint">${view.t('c2.sessions.sleepModalHint')}</p></div><div class="c2-sleep-modal__footer">${view.action('modal-close', view.t('common.cancel'))}<button type="button" class="btn-primary" id="c2-sleep-submit-btn" data-action="c2.sleep-submit">${view.t('common.save')}</button></div></div>`);
    sleepPreview(); openAppModal('c2-modal');
  }
  function sleepPreview(): void {
    const seconds = Number(value('c2-sleep-seconds')); const jitter = Math.max(0, Math.min(100, Number(value('c2-sleep-jitter')) || 0));
    const preview = view.element('c2-sleep-preview'); if (preview) preview.textContent = Number.isFinite(seconds) && seconds >= 1 ? deps.t('c2.sessions.sleepModalPreview', { min: Math.max(1, Math.round(seconds * (1 - jitter / 100))), max: Math.max(1, Math.round(seconds * (1 + jitter / 100))) }) : '';
    const secDisplay = view.element('c2-sleep-seconds-display'); if (secDisplay) secDisplay.textContent = String(seconds);
    const jitterDisplay = view.element('c2-sleep-jitter-display'); if (jitterDisplay) jitterDisplay.textContent = String(jitter);
    doc.querySelectorAll<HTMLElement>('[data-c2-sleep-preset]').forEach(button => button.classList.toggle('is-active', Number(button.dataset.c2SleepPreset) === seconds));
  }
  function noteEdit(id?: string): void {
    const session = state.sessions.find(item => item.id === (id || state.selectedSessionId)); if (!session) return;
    assign('c2-session-note-input', session.note); const viewEl = view.element('c2-session-note-view'); const editor = view.element('c2-session-note-editor'); if (viewEl) viewEl.hidden = true; if (editor) editor.hidden = false; doc.querySelector<HTMLElement>('.c2-session-note-edit-btn')?.setAttribute('hidden', ''); noteCounter(); view.element('c2-session-note-input')?.focus();
  }
  function noteCancel(): void { const viewEl = view.element('c2-session-note-view'); const editor = view.element('c2-session-note-editor'); if (viewEl) viewEl.hidden = false; if (editor) editor.hidden = true; doc.querySelector<HTMLElement>('.c2-session-note-edit-btn')?.removeAttribute('hidden'); }
  function noteCounter(): void { const el = view.element('c2-session-note-counter'); if (el) el.textContent = value('c2-session-note-input').length + '/2000'; }
  async function noteSave(id: string): Promise<void> { await service.saveSessionNote(id, value('c2-session-note-input')); const el = view.element('c2-session-note-view'); if (el) el.textContent = service.selectedSession()?.note || deps.t('c2.sessions.infoNoteEmpty'); noteCancel(); }
  function readSessionsFilter(): void { state.sessionFilter.status = value('c2-session-filter-status'); state.sessionFilter.listener_id = value('c2-session-filter-listener'); state.sessionFilter.search = value('c2-session-filter-search').trim(); }
  function readFilters(kind: 'tasks' | 'events'): void {
    if (kind === 'tasks') { state.tasksFilter.status = value('c2-tasks-filter-status').trim(); state.tasksFilter.task_type = value('c2-tasks-filter-type').trim(); state.tasksFilter.session_id = value('c2-tasks-filter-session').trim(); }
    else { state.eventsFilter.level = value('c2-events-filter-level').trim(); state.eventsFilter.category = value('c2-events-filter-category').trim(); state.eventsFilter.session_id = value('c2-events-filter-session').trim(); }
  }
  function checked(kind: 'sessions' | 'tasks' | 'events'): string[] { const selector = kind === 'sessions' ? '.c2-session-row-check' : kind === 'tasks' ? '.c2-task-row-check' : '.c2-event-check'; return Array.from(doc.querySelectorAll<HTMLInputElement>(selector + ':checked'), el => el.dataset.id || '').filter(Boolean); }
  function syncSelection(kind: 'sessions' | 'tasks' | 'events'): void {
    const selector = kind === 'sessions' ? '.c2-session-row-check' : kind === 'tasks' ? '.c2-task-row-check' : '.c2-event-check'; const all = Array.from(doc.querySelectorAll<HTMLInputElement>(selector)); const count = all.filter(input => input.checked).length;
    const select = doc.querySelector<HTMLInputElement>(`#c2-${kind}-select-all`); if (select) { select.checked = count > 0 && count === all.length; select.indeterminate = count > 0 && count < all.length; }
    const button = doc.querySelector<HTMLButtonElement>(`#c2-${kind}-batch-delete`); if (button) { button.disabled = count === 0; button.dataset.stateDisabled = String(count === 0); button.setAttribute('aria-disabled', String(count === 0)); }
    if (kind === 'sessions') { const total = view.element('c2-sessions-count'); if (total) total.textContent = deps.t('c2.sessions.filterCount', { n: state.sessions.length, selected: count }); }
    if (kind === 'sessions') { const filtered = doc.querySelector<HTMLButtonElement>('#c2-sessions-delete-filtered'); if (filtered) { filtered.disabled = state.sessions.length === 0; filtered.dataset.stateDisabled = String(!state.sessions.length); filtered.setAttribute('aria-disabled', String(!state.sessions.length)); } }
  }
  async function removeResources(kind: 'sessions' | 'tasks' | 'events', ids: string[]): Promise<void> { if (!ids.length || !browser.confirm(deps.t(`c2.${kind}.confirmBatchDelete`, { n: ids.length }))) return; await service.deleteResources(kind, ids); }
  async function taskDetail(id: string): Promise<void> { const task = state.tasks.find(item => item.id === id) || await service.getTask(id); if (disposed || !task) return; view.taskDetail(task); openAppModal('c2-modal'); doc.querySelector<HTMLElement>('#c2-modal .c2-modal-close')?.focus(); }
  async function eventDetail(id: string): Promise<void> {
    const event = state.events.find(item => item.id === id) || await service.event(id); if (!event || disposed) return;
    view.eventDetail(event); openAppModal('c2-modal'); doc.querySelector<HTMLElement>('#c2-modal .c2-modal-close')?.focus();
  }
  function openProfile(id = ''): void { if (!deps.can('c2:write')) return; profileEditId = id; view.profileForm(state.profiles.find(p => (p.id || p.ID) === id)); openAppModal('c2-modal'); }
  async function saveProfile(): Promise<void> {
    const headers = (id: string): Record<string, string> => { let parsed: unknown; try { parsed = JSON.parse(value(id) || '{}'); } catch { throw new Error(deps.t('c2.profiles.toastInvalidHeadersJson')); } if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(v => typeof v !== 'string')) { view.element(id)?.setAttribute('aria-invalid', 'true'); view.element(id)?.focus(); throw new Error(deps.t('c2.profiles.toastInvalidHeadersJson')); } return parsed as Record<string, string>; };
    const draft: ProfileDraft = { name: value('c2-profile-name').trim(), userAgent: value('c2-profile-ua').trim(), uris: value('c2-profile-uris').split('\n').map(uri => uri.trim()).filter(Boolean), jitterMinMs: Number(value('c2-profile-jmin')), jitterMaxMs: Number(value('c2-profile-jmax')), requestHeaders: headers('c2-profile-request-headers'), responseHeaders: headers('c2-profile-headers'), bodyTemplate: value('c2-profile-body') };
    const existing = state.profiles.find(p => (p.id || p.ID) === profileEditId); if (existing?.extra) draft.extra = existing.extra;
    await service.createProfile(draft, profileEditId || undefined); closeModal();
  }
  function renderPayload(): void {
    const option = `<option value="">${view.t(state.listeners.length ? 'c2.payloads.selectListener' : 'c2.payloads.noListenersOption')}</option>` + state.listeners.map(listener => `<option value="${escapeHtml(listener.id)}">${escapeHtml(listener.name)} · ${escapeHtml(listener.type)} · ${escapeHtml(listener.status || deps.t('c2.common.unknown'))} · ${escapeHtml(listenerCallbackHost(listener) || deps.t('c2.listeners.callbackAutomatic'))}:${listener.bindPort ?? '—'}</option>`).join('');
    for (const id of ['c2-payload-listener', 'c2-build-listener']) { const selected = value(id); view.set(id, option); assign(id, selected); }
    updateOnelinerKinds(); updateLoopbackHint(); refreshFormSelects(view.element('page-c2-payloads'));
  }
  function updateOnelinerKinds(): void {
    const listener = state.listeners.find(item => item.id === value('c2-payload-listener')); const selected = value('c2-payload-kind');
    const compatible = onelinerKinds(listener?.type); const all = ['bash', 'nc', 'nc_mkfifo', 'python', 'perl', 'powershell', 'curl_beacon'];
    view.set('c2-payload-kind', `<option value="">${view.t(listener ? 'c2.payloads.noKindOption' : 'c2.payloads.selectListener')}</option>` + all.map(kind => `<option value="${kind}"${compatible.includes(kind) ? '' : ' disabled'}>${view.t('c2.payloads.kinds.' + kind)}${compatible.includes(kind) ? '' : ' — ' + view.t('c2.payloads.incompatible')}</option>`).join(''));
    assign('c2-payload-kind', compatible.includes(selected) ? selected : compatible[0] || '');
    const select = view.element('c2-payload-kind'); if (select instanceof HTMLSelectElement) select.disabled = !compatible.length;
    payloadNotice('c2-oneliner-availability', listener ? compatible.length ? 'c2.payloads.kindAvailability' : 'c2.payloads.unsupportedListener' : 'c2.payloads.pickListenerHint');
    payloadButton('c2-generate-oneliner-btn', compatible.length > 0);
  }
  function payloadButton(id: string, available: boolean): void { const button = view.element(id); if (button instanceof HTMLButtonElement) { const disabled = !available || !deps.can('c2:write'); button.disabled = disabled; button.dataset.stateDisabled = String(disabled); button.setAttribute('aria-disabled', String(disabled)); } }
  function payloadNotice(id: string, key: string, error = false): void {
    let notice = view.element(id); if (!notice) { notice = doc.createElement('p'); notice.id = id; const anchor = view.element(id.startsWith('c2-oneliner') ? 'c2-generate-oneliner-btn' : 'c2-build-btn'); anchor?.before(notice); }
    notice.className = error ? 'c2-error' : 'form-hint'; notice.setAttribute('role', error ? 'alert' : 'status'); notice.textContent = deps.t(key);
  }
  function updateLoopbackHint(): void {
    const listener = state.listeners.find(item => item.id === value('c2-build-listener')); const host = value('c2-build-host').trim() || (listener ? listenerCallbackHost(listener) : ''); const hint = view.element('c2-build-loopback-hint'); if (hint) hint.hidden = !/^(?:127\.|localhost$|::1$)/i.test(host);
    const os = value('c2-build-os'); const arch = doc.querySelector<HTMLSelectElement>('#c2-build-arch'); if (arch) { for (const option of arch.options) option.disabled = os === 'darwin' && option.value === '386' || os !== 'linux' && option.value === 'arm'; if (arch.selectedOptions[0]?.disabled) arch.value = 'amd64'; }
    payloadButton('c2-build-btn', Boolean(listener));
    payloadNotice('c2-build-availability', listener ? 'c2.payloads.buildAvailability' : 'c2.payloads.pickListenerHint');
  }
  function validPayloadHost(id: string): boolean {
    const host = value(id).trim(); const input = view.element(id); const invalid = /[\s/?#]/.test(host);
    if (input instanceof HTMLInputElement) { input.setCustomValidity(invalid ? deps.t('c2.payloads.hostInvalid') : ''); input.setAttribute('aria-invalid', String(invalid)); if (invalid) input.reportValidity(); }
    return !invalid;
  }
  async function generateOneliner(): Promise<void> {
    if (!validPayloadHost('c2-payload-host')) return;
    if (!value('c2-payload-kind')) { payloadNotice('c2-oneliner-feedback', 'c2.payloads.pickListenerHint', true); return; }
    payloadNotice('c2-oneliner-feedback', 'c2.payloads.generating');
    try { const data = await service.generateOneliner(value('c2-payload-listener'), value('c2-payload-kind'), value('c2-payload-host').trim()); if (typeof data.oneliner !== 'string') throw new Error(deps.t('c2.payloads.invalidResponse')); const output = view.element('c2-oneliner-output'); if (output) { output.textContent = data.oneliner; output.style.display = 'block'; } const copy = view.element('c2-oneliner-copy'); if (copy) copy.hidden = false; payloadNotice('c2-oneliner-feedback', 'c2.payloads.generated'); }
    catch (error) { payloadNotice('c2-oneliner-feedback', deps.t('c2.payloads.toastOnelinerFail', { msg: deps.t(error instanceof Error ? error.message : String(error)) }), true); }
  }
  async function buildBeacon(): Promise<void> {
    if (!validPayloadHost('c2-build-host')) return;
    const button = doc.querySelector<HTMLButtonElement>('#c2-build-btn'); if (button) { button.disabled = true; button.dataset.stateDisabled = 'true'; button.setAttribute('aria-disabled', 'true'); button.textContent = deps.t('c2.payloads.building'); }
    view.set('c2-build-result', `<p role="status">${view.t('c2.payloads.building')}</p>`);
    try { const data = await service.buildBeacon(value('c2-build-listener'), value('c2-build-os') || 'linux', value('c2-build-arch') || 'amd64', value('c2-build-host').trim()); if (!data.payload?.download_path) throw new Error(deps.t('c2.payloads.invalidResponse')); view.set('c2-build-result', `<div class="c2-build-success" role="status"><strong>${view.t('c2.payloads.buildSuccessTitle')}</strong><p>${view.t('c2.payloads.buildMetaOsArch', { os: data.payload.os, arch: data.payload.arch })} · ${view.t('c2.payloads.buildSize', { bytes: data.payload.size_bytes })}</p>${view.action('payload-download', view.t('c2.payloads.download'), data.payload.download_path.replace(/\\/g, '/').split('/').pop() || '', 'btn-primary')}</div>`); }
    catch (error) { view.set('c2-build-result', `<div class="c2-error" role="alert">${view.t('c2.payloads.toastBuildFail', { msg: deps.t(error instanceof Error ? error.message : String(error)) })}</div>`); }
    finally { if (button) { button.disabled = false; button.dataset.stateDisabled = 'false'; button.setAttribute('aria-disabled', 'false'); button.textContent = deps.t('c2.payloads.buildBeaconBtn'); } }
  }
  function refreshFormSelects(root = view.element('c2-modal-content')): void {
    root?.querySelectorAll<HTMLSelectElement>('select.c2-form-select-native').forEach(select => select.classList.add('c2-native-select'));
  }
  function workspace(page: string, query: URLSearchParams): void {
    const activityTab = page === 'c2-events' ? 'events' : page === 'c2-tasks' ? 'tasks' : query.get('tab') === 'events' ? 'events' : 'tasks';
    const profiles = page === 'c2-profiles' || page === 'c2-listeners' && query.get('tab') === 'profiles';
    state.activityTab = activityTab;
    for (const [id, visible] of [['page-c2-tasks', activityTab === 'tasks'], ['page-c2-events', activityTab === 'events'], ['page-c2-profiles', profiles], ['c2-listener-management', !profiles]] as const) { const panel = view.element(id); if (panel) panel.hidden = !visible; }
    const create = doc.querySelector<HTMLElement>('#page-c2-listeners > .page-header .page-header-actions'); if (create) create.hidden = profiles;
    doc.querySelectorAll<HTMLElement>('[data-c2-workspace-tab]').forEach(el => { const selected = el.dataset.c2WorkspaceTab === (el.closest('#page-c2-listeners') ? profiles ? 'profiles' : 'listeners' : activityTab); if (selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  }
  async function enterPage(page: string): Promise<void> {
    const query = new URLSearchParams(doc.defaultView?.location.hash.split('?')[1] || ''); workspace(page, query);
    if (page === 'c2-sessions' && query.has('listener')) state.sessionFilter.listener_id = query.get('listener') || '';
    await service.pageChanged(page);
    if (page === 'c2-listeners' && query.get('tab') === 'profiles') await service.loadProfiles();
    if (page === 'c2-sessions' && query.get('session')) await relatedSession(query.get('session')!);
  }
  async function relatedSession(id: string): Promise<void> {
    closeModal();
    if (state.currentPage !== 'c2-sessions') { if (doc.defaultView) doc.defaultView.location.hash = 'c2-sessions?session=' + encodeURIComponent(id); return; }
    if (!state.sessions.some(s => s.id === id)) { const session = await service.getSession(id); if (!session) throw new Error(deps.t('c2.sessions.notFound')); state.sessions = [session, ...state.sessions]; }
    await selectSession(id);
  }
  function renderResourceStates(): void {
    for (const [kind, targetId] of [['listeners', 'c2-listener-management'], ['profiles', 'page-c2-profiles'], ['tasks', 'page-c2-tasks'], ['events', 'page-c2-events'], ['sessions', 'page-c2-sessions']]) {
      const target = view.element(targetId!); const resource = state.resources[kind!]; if (!target || !resource) continue;
      let notice = view.element(`c2-${kind}-load-state`); if (!notice) { notice = doc.createElement('div'); notice.id = `c2-${kind}-load-state`; target.prepend(notice); }
      notice.hidden = !resource.loading && !resource.error; notice.className = resource.error ? 'c2-error' : 'c2-loading'; notice.setAttribute('role', resource.error ? 'alert' : 'status');
      notice.innerHTML = resource.error ? `${view.t('c2.common.loadFailed')} <span>${escapeHtml(deps.t(resource.error))}</span> ${view.action(kind === 'sessions' ? 'sessions-refresh' : kind + '-refresh', view.t('common.retry'))}` : view.t('c2.common.loading');
      target.setAttribute('aria-busy', String(resource.loading));
    }
  }
  function sync(): void {
    if (disposed) return;
    if (renderedPage !== state.currentPage) { renderedPage = state.currentPage; if (renderedPage === 'c2-payloads') renderPayload(); }
    if (listenersSnapshot !== state.listeners) { listenersSnapshot = state.listeners; view.renderListeners(); if (state.currentPage === 'c2-payloads') renderPayload(); }
    if (sessionsSnapshot !== state.sessions) { sessionsSnapshot = state.sessions; view.renderSessionToolbar(); view.renderSessions(); syncSelection('sessions'); const selected = service.selectedSession(); if (selected && sessionRendered === selected.id) view.refreshSessionMetadata(selected); if (!selected && state.sessions[0] && state.currentPage === 'c2-sessions') run(() => selectSession(state.sessions[0]!.id)); else if (!state.sessions.length && state.currentPage === 'c2-sessions') { sessionRendered = ''; destroyTerminal(); view.sessionEmpty(); } }
    if (tasksSnapshot !== state.tasks) { tasksSnapshot = state.tasks; view.renderTasks(); syncSelection('tasks'); }
    if (eventsSnapshot !== state.events) { eventsSnapshot = state.events; view.renderEvents(); syncSelection('events'); }
    if (profilesSnapshot !== state.profiles) { profilesSnapshot = state.profiles; view.renderProfiles(); view.renderListeners(); }
    if (state.currentPage === 'c2-sessions' && state.selectedSessionId && sessionRendered !== state.selectedSessionId) run(() => selectSession(state.selectedSessionId!));
    updateUpload(); const status = view.element('c2-terminal-status'); if (status) status.textContent = deps.t(state.terminalFeedback || 'c2.sessions.termStatusReady') + (state.terminalTaskId ? ' · ' + state.terminalTaskId : '');
    const selected = service.selectedSession(); if (selected) view.renderSessionConnection(selected);
    const count = view.element('c2-sessions-count'); if (count) count.textContent = deps.t('c2.sessions.filterCount', { n: state.sessions.length, selected: checked('sessions').length });
    renderResourceStates();
  }
  register('stop', () => undefined); register('modal-close', closeModal);
  register('listeners-refresh', () => service.loadListeners());
  register('profiles-open', () => { closeModal(); if (doc.defaultView) doc.defaultView.location.hash = 'c2-listeners?tab=profiles'; });
  register('related-session', el => relatedSession(el.dataset.id || ''));
  register('task-result-download', async el => browser.download(await service.downloadTaskResult(el.dataset.id || ''), (el.dataset.id || 'task') + '-result'));
  register('tasks-search', el => { state.tasksSearch = el instanceof HTMLInputElement ? el.value : ''; view.renderTasks(); syncSelection('tasks'); });
  register('events-search', el => { state.eventsSearch = el instanceof HTMLInputElement ? el.value : ''; view.renderEvents(); syncSelection('events'); });
  register('listener-create-modal', () => openListener()); register('listener-edit', el => openListener(el.dataset.id)); register('listener-save', el => saveListener(el.dataset.id)); register('listener-start', el => service.listenerAction(el.dataset.id || '', 'start')); register('listener-stop', el => service.listenerAction(el.dataset.id || '', 'stop')); register('listener-delete', el => removeListener(el.dataset.id || '')); register('listener-project', el => service.bindListenerProject(el.dataset.id || '', el instanceof HTMLSelectElement ? el.value : '')); register('listener-type', syncListenerType);
  register('sessions-refresh', () => service.loadSessions()); register('sessions-filter', () => { readSessionsFilter(); return service.loadSessions(); }); register('sessions-filter-enter', (_el, event) => { if (event instanceof KeyboardEvent && event.key === 'Enter') { readSessionsFilter(); return service.loadSessions(); } });
  register('sessions-reset', () => { state.sessionFilter = { status: '', listener_id: '', search: '', suspicious: false }; return service.loadSessions(); }); register('sessions-suspicious', () => { state.sessionFilter.suspicious = !state.sessionFilter.suspicious; return service.loadSessions(); });
  register('session-select', el => selectSession(el.dataset.id || '')); register('session-select-key', (el, event) => { if (event instanceof KeyboardEvent && ['Enter', ' '].includes(event.key)) { event.preventDefault(); return selectSession(el.dataset.id || ''); } });
  register('session-delete', async el => { if (!browser.confirm(deps.t('c2.sessions.confirmDeleteSession'))) return; await service.deleteResources('sessions', [el.dataset.id || '']); }); register('session-kill', async el => { if (browser.confirm(deps.t('c2.sessions.confirmExitSession'))) await service.killSession(el.dataset.id || ''); });
  register('session-sleep', el => editSleep(el.dataset.id || '')); register('sleep-submit', async () => { await service.setSessionSleep(sleepSessionId, Number(value('c2-sleep-seconds')), Number(value('c2-sleep-jitter'))); closeModal(); });
  register('sleep-sync', el => { if (el instanceof HTMLInputElement) { const seconds = el.id === 'c2-sleep-seconds'; const number = Math.max(seconds ? 1 : 0, Math.min(seconds ? 3600 : 100, Number(el.value) || (seconds ? 1 : 0))); el.value = String(number); assign(el.id + '-range', String(Math.min(seconds ? 300 : 100, number))); } sleepPreview(); }); register('sleep-range', el => { if (el instanceof HTMLInputElement) assign(el.id.replace(/-range$/, ''), el.value); sleepPreview(); }); register('sleep-preset', el => { assign('c2-sleep-seconds', el.dataset.seconds || '5'); assign('c2-sleep-seconds-range', el.dataset.seconds || '5'); sleepPreview(); });
  register('session-note-edit', el => noteEdit(el.dataset.id)); register('session-note-cancel', noteCancel); register('session-note-save', el => noteSave(el.dataset.id || state.selectedSessionId || '')); register('note-counter', noteCounter); register('session-tasks-refresh', el => loadSessionTasks(el.dataset.id || state.selectedSessionId || ''));
  register('session-tasks-prev', () => { sessionTasksPage = Math.max(1, sessionTasksPage - 1); return loadSessionTasks(state.selectedSessionId || ''); });
  register('session-tasks-next', () => { sessionTasksPage = Math.min(Math.ceil(sessionTasksTotal / 25), sessionTasksPage + 1); return loadSessionTasks(state.selectedSessionId || ''); });
  register('tab', el => switchTab(el.dataset.tab || 'terminal')); register('terminal-clear', clearTerminal); register('terminal-copy', copyTerminal);
  register('files-refresh', () => loadFiles()); register('file-parent', () => loadFiles(parentFilePath(state.currentPath))); register('file-open', el => loadFiles(joinFilePath(state.currentPath, el.dataset.name || ''))); register('file-download', el => download(el.dataset.name || '')); register('file-upload', () => { doc.querySelector<HTMLInputElement>('#c2-file-upload-input')?.click(); }); register('file-pick', async el => { if (!(el instanceof HTMLInputElement)) return; const file = el.files?.[0]; el.value = ''; if (file) await upload(file); });
  register('file-path', el => loadFiles(el.dataset.path || '.'));
  for (const kind of ['sessions', 'tasks', 'events'] as const) {
    register(kind + '-selection', () => syncSelection(kind)); register(kind + '-select-all', el => { const checked = el instanceof HTMLInputElement && el.checked; const selector = kind === 'sessions' ? '.c2-session-row-check' : kind === 'tasks' ? '.c2-task-row-check' : '.c2-event-check'; doc.querySelectorAll<HTMLInputElement>(selector).forEach(input => { input.checked = checked; }); syncSelection(kind); });
    register(kind + '-delete-selected', () => removeResources(kind, checked(kind)));
  }
  register('sessions-delete-filtered', () => removeResources('sessions', state.sessions.map(session => session.id)));
  for (const kind of ['tasks', 'events'] as const) {
    const load = (page = 1) => kind === 'tasks' ? service.loadTasks(page) : service.loadEvents(page);
    register(kind + '-refresh', () => { readFilters(kind); return load(kind === 'tasks' ? state.tasksPage : state.eventsPage); }); register(kind + '-filter', () => { readFilters(kind); return load(); });
    register(kind + '-reset', () => { const filter = kind === 'tasks' ? state.tasksFilter : state.eventsFilter; Object.keys(filter).forEach(key => { Reflect.set(filter, key, key === 'timePreset' ? 'all' : ''); }); if (kind === 'tasks') state.tasksSearch = ''; else state.eventsSearch = ''; assign(`c2-${kind}-search`, ''); doc.querySelectorAll<HTMLElement>(`#c2-${kind}-time-presets [data-preset]`).forEach(button => button.classList.toggle('is-active', button.dataset.preset === 'all')); for (const suffix of kind === 'tasks' ? ['status', 'type', 'session'] : ['level', 'category', 'session']) assign(`c2-${kind}-filter-${suffix}`, ''); return load(); });
    register(kind + '-page', el => load(Number(el.dataset.page) || 1)); register(kind + '-page-size', el => { if (!(el instanceof HTMLSelectElement)) return; const size = Number(el.value); if (![10, 20, 50, 100].includes(size)) return; if (kind === 'tasks') state.tasksPageSize = size; else state.eventsPageSize = size; return load(); });
    register(kind + '-preset', el => { const filter = kind === 'tasks' ? state.tasksFilter : state.eventsFilter; filter.timePreset = el.dataset.preset || 'all'; filter.since = timePresetToSince(filter.timePreset); doc.querySelectorAll<HTMLElement>(`#c2-${kind}-time-presets [data-preset]`).forEach(button => button.classList.toggle('is-active', button.dataset.preset === filter.timePreset)); readFilters(kind); return load(); });
    register(kind + '-filter-enter', (_el, event) => { if (event instanceof KeyboardEvent && event.key === 'Enter') { readFilters(kind); return load(); } });
  }
  register('task-view', el => taskDetail(el.dataset.id || '')); register('task-cancel', async el => { if (browser.confirm(deps.t('c2.tasks.confirmCancel'))) await service.cancelTask(el.dataset.id || ''); }); register('task-delete', el => removeResources('tasks', [el.dataset.id || '']));
  register('task-view-key', (el, event) => { if (event instanceof KeyboardEvent && ['Enter', ' '].includes(event.key)) { event.preventDefault(); return taskDetail(el.dataset.id || ''); } });
  register('event-view', el => eventDetail(el.dataset.id || '')); register('event-delete', el => removeResources('events', [el.dataset.id || '']));
  register('event-view-key', (el, event) => { if (event instanceof KeyboardEvent && ['Enter', ' '].includes(event.key)) { event.preventDefault(); return eventDetail(el.dataset.id || ''); } });
  register('profile-create-modal', () => openProfile()); register('profile-edit', el => openProfile(el.dataset.id)); register('profile-save', saveProfile); register('profile-delete', async el => { if (browser.confirm(deps.t('c2.profiles.confirmDelete'))) await service.deleteProfile(el.dataset.id || ''); });
  register('payload-oneliner', generateOneliner); register('payload-copy', () => browser.copy(view.element('c2-oneliner-output')?.textContent || '')); register('payload-build', buildBeacon); register('payload-download', async el => { const filename = el.dataset.id || ''; browser.download(await service.downloadPayload(filename), filename); }); register('payload-listener', updateOnelinerKinds); register('build-listener', updateLoopbackHint);
  register('copy', el => browser.copy(el.dataset.value || '')); register('copy-block', el => browser.copy(view.element(el.dataset.id || '')?.textContent || ''));
  register('profiles-refresh', () => service.loadProfiles());
  for (const kind of ['tasks', 'events'] as const) { doc.querySelectorAll<HTMLElement>(`#c2-${kind}-time-presets [data-preset]`).forEach(el => { el.dataset.action = `c2.${kind}-preset`; }); const session = view.element(`c2-${kind}-filter-session`); if (session) session.dataset.keydown = `c2.${kind}-filter-enter`; }
  const payloadListener = view.element('c2-payload-listener'); if (payloadListener) payloadListener.dataset.change = 'c2.payload-listener'; const buildListener = view.element('c2-build-listener'); if (buildListener) buildListener.dataset.change = 'c2.build-listener'; const buildHost = view.element('c2-build-host'); if (buildHost) buildHost.dataset.input = 'c2.build-listener';
  const buildOS = view.element('c2-build-os'); if (buildOS) buildOS.dataset.change = 'c2.build-listener';
  return {
    navigationChanged(page: string): void {
      if (page.startsWith('c2')) { workspace(page, new URLSearchParams(doc.defaultView?.location.hash.split('?')[1] || '')); if (page === state.currentPage) run(() => enterPage(page)); return; }
      destroyTerminal(); sessionRendered = ''; fileVersion++; sessionTasksVersion++; closeModal(); run(() => service.pageChanged(page));
    },
    init: () => enterPage(deps.currentPage()), loadListeners: service.loadListeners, loadSessions: service.loadSessions, loadTasks: service.loadTasks, loadEvents: service.loadEvents, loadProfiles: service.loadProfiles,
    selectSession, renderListeners: view.renderListeners, renderSessions: view.renderSessions, renderSessionToolbar: view.renderSessionToolbar, renderSessionDetail: (id: string) => { const session = state.sessions.find(item => item.id === id); if (session) { view.renderSessionDetail(session, currentTab); initTerminal(); } },
    showCreateListenerModal: () => openListener(), editListener: openListener, createListener: () => saveListener(''), saveListener, startListener: (id: string) => service.listenerAction(id, 'start'), stopListener: (id: string) => service.listenerAction(id, 'stop'), deleteListener: removeListener, bindListenerProject: service.bindListenerProject,
    ensureListenersLoaded: service.ensureListeners, ensureProfilesLoaded: service.loadProfiles, closeModal, refreshFormSelects, syncListenerProfileRowForType: syncListenerType,
    switchTab, clearTerminal, copyTerminal, initTerminal, fitTerminal, executeInTerminal,
    loadFileList: (_id: string, path: string) => loadFiles(path), refreshFiles: () => loadFiles(), openDirectory: (name: string) => loadFiles(joinFilePath(state.currentPath, name)), goToParentDirectory: () => loadFiles(parentFilePath(state.currentPath)), downloadFile: download, uploadFileToImplant: upload, openFileUploadPicker: () => doc.querySelector<HTMLInputElement>('#c2-file-upload-input')?.click(),
    loadSessionTasks, setSessionSleep: editSleep, submitSessionSleep: () => service.setSessionSleep(sleepSessionId, Number(value('c2-sleep-seconds')), Number(value('c2-sleep-jitter'))), beginEditSessionNote: noteEdit, cancelEditSessionNote: noteCancel, saveSessionNote: noteSave, syncSessionNoteCounter: noteCounter,
    viewTask: taskDetail, cancelTask: service.cancelTask, viewEvent: eventDetail, showCreateProfileModal: () => openProfile(), createProfile: saveProfile, deleteProfile: service.deleteProfile,
    loadListenersForPayload: async () => { await service.loadListeners(); renderPayload(); }, renderPayloadPage: renderPayload, updateOnelinerKinds, updateLoopbackBuildHint: updateLoopbackHint, generateOneliner, copyOneliner: () => browser.copy(view.element('c2-oneliner-output')?.textContent || ''), buildBeacon,
    copyText: browser.copy, copyTaskBlock: (id: string) => browser.copy(view.element(id)?.textContent || ''), connectEventStream: service.connectEventStream, onEvent: service.onEvent,
    activate(): void {
      if (active || disposed) return; active = true; unbind = actions.bind(doc); unsubscribe = service.subscribe(sync); unresize = browser.listenResize(fitTerminal); unpage = browser.listenPage(page => { if (!page.startsWith('c2')) { destroyTerminal(); sessionRendered = ''; } run(() => enterPage(page)); });
      freshnessTimer = setInterval(() => { if (state.currentPage === 'c2-sessions' && state.sessions.length) { const checks = checked('sessions'); view.renderSessions(); doc.querySelectorAll<HTMLInputElement>('.c2-session-row-check').forEach(el => { el.checked = checks.includes(el.dataset.id || ''); }); const selected = service.selectedSession(); if (selected) view.renderSessionConnection(selected); } }, 15000);
      doc.addEventListener('click', event => { if (event.target === view.element('c2-modal')) closeModal(); }, { signal: events.signal });
      doc.addEventListener('keydown', event => {
        const overlay = view.element('c2-modal'); if (!overlay || overlay.style.display === 'none') return;
        if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
        if (event.key === 'Tab') { const controls = Array.from(overlay.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')).filter(el => el.getClientRects().length > 0); const first = controls[0]; const last = controls.at(-1); if (event.shiftKey && (doc.activeElement === first || !overlay.contains(doc.activeElement))) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && (doc.activeElement === last || !overlay.contains(doc.activeElement))) { event.preventDefault(); first?.focus(); } }
      }, { signal: events.signal });
      doc.addEventListener('languagechange', () => { view.renderListeners(); view.renderSessionToolbar(); view.renderSessions(); view.renderTasks(); view.renderEvents(); view.renderProfiles(); }, { signal: events.signal }); sync();
    },
    dispose(): void { if (disposed) return; disposed = true; unbind?.(); unsubscribe?.(); unresize?.(); unpage?.(); events.abort(); clearInterval(freshnessTimer); destroyTerminal(); service.dispose(); sessionRendered = ''; fileVersion++; sessionTasksVersion++; },
    get selectedSessionId() { return state.selectedSessionId; }, get currentPage() { return state.currentPage; }, get renderedSessionId() { return sessionRendered; },
  };
}
