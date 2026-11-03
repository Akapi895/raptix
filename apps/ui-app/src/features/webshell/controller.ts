import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { createActions } from '../../ui/actions';
import { closeAppModal, openAppModal } from '../../ui/modal';
import { parseWebshellDbColumns, parseWebshellDbTableColumns, quoteIdentifier } from './database';
import { BACKEND_DEFAULT_ROLE } from '@/platform/backend-legacy-strings';
import { getWebshellParentPath, joinWebshellPath, newWebshellDbProfile, normalizeWebshellEncoding, normalizeWebshellOS, type ConnectionDraft, type FileEntry, type WebshellConnection } from './model';
import { escapeHtml, type WebshellView, type WebshellViewDependencies } from './view';
import type { AiMessage, WebshellService } from './service';

export interface WebshellControllerDependencies extends WebshellViewDependencies {
  notify(text: string, type: 'success' | 'error' | 'info' | 'warning'): void;
  setRole(name: string): void;
  newProject(connectionId: string): void;
  ensureProjects(): Promise<unknown>;
  renderProjectPicker?(options: { listId: string; searchInputId: string; selectedId: string; onSelect(id: string): void }): Promise<boolean | void>;
}
export function createWebshellController(deps: WebshellControllerDependencies, view: WebshellView, service: WebshellService) {
  const { browser } = deps; const { doc } = browser;
  const actions = createActions(); const events = new AbortController();
  let active = false; let disposed = false; let unbind: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined; let unresize: (() => void) | undefined;
  let terminal: Terminal | undefined; let fit: FitAddon | undefined; let unobserve: (() => void) | undefined;
  let renderedConnection = ''; let line = ''; let cursor = 0; let historyIndex = -1;
  let filePath = '.'; let fileEntries: FileEntry[] = []; let fileVersion = 0;
  let aiMessages: AiMessage[] = []; let dbEditId = ''; let dbCreate = false;
  const value = (id: string) => { const el = doc.getElementById(id); return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? el.value : ''; };
  const assign = (id: string, text: string) => { const el = doc.getElementById(id); if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.value = text; };
  const connection = () => service.currentConnection;
  const report = (error: unknown) => { if (!disposed) deps.notify(error instanceof Error ? error.message : String(error), 'error'); };
  const run = (operation: () => void | Promise<unknown>) => { try { const promise = operation(); if (promise) void promise.catch(report); } catch (error) { report(error); } };
  function register(name: string, handler: (el: HTMLElement, event: Event) => void | Promise<unknown>): void {
    actions.register('webshell.' + name, (el, event) => { event.stopPropagation(); if (event.type === 'click' && !el.matches('summary')) event.preventDefault(); run(() => handler(el, event)); });
  }
  function permit(permission: string): boolean { return deps.can(permission); }
  function draft(): ConnectionDraft {
    const url = value('webshell-url').trim();
    return { url, password: value('webshell-password').trim(), type: value('webshell-type') || 'php', method: value('webshell-method') === 'get' ? 'get' : 'post', cmdParam: value('webshell-cmd-param').trim(), os: normalizeWebshellOS(value('webshell-os')), encoding: normalizeWebshellEncoding(value('webshell-encoding')), remark: value('webshell-remark').trim() || url, project_id: value('webshell-project-id').trim() };
  }
  function projectOptions(selected: string): void {
    view.set('webshell-project-id', `<option value="">${view.t('assets.unboundProject', 'Not bound')}</option>` + Object.entries(deps.projectNames()).sort(([, a], [, b]) => a.localeCompare(b)).map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('') + (selected && !deps.projectNames()[selected] ? `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>` : ''));
    assign('webshell-project-id', selected);
  }
  async function openConnection(id?: string): Promise<void> {
    if (!permit('webshell:write')) return;
    const conn = id ? service.connections.find(item => item.id === id) : undefined;
    if (id && !conn) return;
    const fields = { 'edit-id': id || '', url: conn?.url || '', password: conn?.password || '', type: conn?.type || 'php', method: conn?.method.toLowerCase() || 'post', 'cmd-param': conn?.cmdParam || '', os: normalizeWebshellOS(conn?.os), encoding: normalizeWebshellEncoding(conn?.encoding), remark: conn?.remark || '' };
    for (const [key, text] of Object.entries(fields)) assign('webshell-' + key, text);
    const title = view.element('webshell-modal-title'); if (title) title.textContent = deps.t(id ? 'webshell.editConnectionTitle' : 'webshell.addConnection');
    const selected = conn?.project_id || conn?.projectId || ''; projectOptions(selected); openAppModal('webshell-modal');
    await deps.ensureProjects(); if (disposed) return; projectOptions(selected); refreshFormSelects(view.element('webshell-modal'));
  }
  function closeConnection(): void { closeAppModal('webshell-modal'); assign('webshell-edit-id', ''); }
  async function saveConnection(): Promise<void> { if (!permit('webshell:write')) return; await service.saveConnection(draft(), value('webshell-edit-id') || undefined); closeConnection(); }
  async function testConnection(): Promise<void> {
    if (!permit('webshell:write')) return;
    const test = doc.querySelector<HTMLButtonElement>('#webshell-test-btn'); if (test) test.disabled = true;
    try { const data = draft(); const result = await service.probe({ ...data, id: value('webshell-edit-id'), createdAt: '' }); deps.notify(result.message, result.ok ? 'success' : 'error'); }
    finally { if (test) test.disabled = false; }
  }
  async function removeConnection(id: string): Promise<void> {
    if (!permit('webshell:delete') || !browser.confirm(deps.t('webshell.deleteConfirm'))) return;
    await service.remove(id); if (!service.currentConnection) { destroyTerminal(); renderedConnection = ''; view.placeholder(); }
  }
  function destroyTerminal(): void { unobserve?.(); unobserve = undefined; terminal?.dispose(); terminal = undefined; fit = undefined; line = ''; cursor = 0; }
  function fitTerminal(): void { try { fit?.fit(); terminal?.scrollToBottom(); } catch { /* Pane can be hidden. */ } }
  function initTerminal(): void {
    destroyTerminal(); const conn = connection(); const container = view.element('webshell-terminal-container'); if (!conn || !container) return;
    const created = browser.terminal({ cursorBlink: true, cursorStyle: 'underline', fontSize: 13, fontFamily: 'Menlo, Monaco, "Courier New", monospace', lineHeight: 1.2, scrollback: 2000, theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0d1117', selectionBackground: 'rgba(88,166,255,.3)' } });
    terminal = created.terminal; fit = created.fit; terminal.open(container);
    terminal.write(service.terminalLog(conn.id) || 'shell> '); historyIndex = service.history(conn.id).length;
    const term = terminal;
    term.onData(data => {
      if (disposed) return;
      if (data === '\x03') { line = ''; cursor = 0; term.write((service.commandBusy ? '^C (this version cannot interrupt a remote command yet)' : '^C') + '\r\nshell> '); return; }
      if (data === '\x0c') { clearTerminal(); return; }
      if (service.commandBusy) return;
      if (data !== '\r' && data !== '\n' && /[\r\n]/.test(data)) {
        const parts = (line + data).replace(/\r\n?/g, '\n').split('\n'); const tail = parts.pop() || ''; line = ''; cursor = 0;
        run(async () => { for (const command of parts) if (command.trim()) { if (terminal !== term) return; term.write(command + '\r\n'); await commandInTerminal(command.trim()); } if (terminal === term) { line = tail; cursor = tail.length; redraw(); } }); return;
      }
      if (data === '\r') { const command = line.trim(); term.write('\r\n'); line = ''; cursor = 0; if (command) run(() => commandInTerminal(command)); else term.write('shell> '); return; }
      if (data === '\x1b[A' || data === '\x1b[B') { const history = service.history(conn.id); historyIndex = Math.max(0, Math.min(history.length, historyIndex + (data.endsWith('A') ? -1 : 1))); line = history[historyIndex] || ''; cursor = line.length; redraw(); return; }
      if (data === '\x1b[D') { if (cursor > 0) { cursor--; term.write('\x1b[D'); } return; }
      if (data === '\x1b[C') { if (cursor < line.length) { cursor++; term.write('\x1b[C'); } return; }
      if (data === '\x7f') { if (cursor > 0) { line = line.slice(0, cursor - 1) + line.slice(cursor); cursor--; redraw(); } return; }
      if (data === '\x1b[3~') { line = line.slice(0, cursor) + line.slice(cursor + 1); redraw(); return; }
      if (data === '\x01' || data === '\x1b[H') { cursor = 0; redraw(); return; }
      if (data === '\x05' || data === '\x1b[F') { cursor = line.length; redraw(); return; }
      if (data === '\x15') { line = ''; cursor = 0; redraw(); return; }
      const printable = Array.from(data).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join(''); if (!printable) return;
      line = line.slice(0, cursor) + printable + line.slice(cursor); cursor += printable.length; redraw();
    });
    function redraw() { term.write('\r\x1b[2Kshell> ' + line + (cursor < line.length ? `\x1b[${line.length - cursor}D` : '')); }
    unobserve = browser.observe(container, fitTerminal); fitTerminal(); term.focus();
  }
  async function commandInTerminal(command: string): Promise<void> {
    const conn = connection(); const term = terminal; if (!conn || !term) return;
    if (command === 'clear' || command === 'cls') { clearTerminal(); return; }
    service.appendTerminalLog(conn.id, command + '\r\n');
    try { const result = await service.runCommand(conn, command); const output = (result.output || '').replace(/\r?\n/g, '\r\n'); if (terminal === term) term.write(output + '\r\n'); service.appendTerminalLog(conn.id, output + '\r\n'); }
    catch (error) { const text = error instanceof Error ? error.message : String(error); if (terminal === term) term.write('\x1b[31m' + text + '\x1b[0m\r\n'); }
    finally { if (terminal === term) { term.write('shell> '); term.focus(); historyIndex = service.history(conn.id).length; } service.appendTerminalLog(conn.id, 'shell> '); }
  }
  function clearTerminal(): void { const conn = connection(); if (!conn || service.commandBusy) return; terminal?.clear(); terminal?.write('\r\x1b[2Kshell> '); line = ''; cursor = 0; service.clearTerminalLog(conn.id); }
  async function select(id: string): Promise<void> {
    const conn = await service.select(id); if (!conn || disposed) return;
    renderedConnection = id; filePath = '.'; fileEntries = []; fileVersion++;
    view.workspace(conn); initTerminal(); refreshFormSelects(view.element('webshell-workspace'));
    await Promise.all([loadAiHistory(conn), renderConversations(conn), refreshSelectors()]);
  }
  async function listFiles(path = value('webshell-file-path') || '.'): Promise<void> {
    const conn = connection(); if (!conn) return; const version = ++fileVersion;
    view.set('webshell-file-list', `<div class="webshell-loading">${view.t('common.loading', 'Loading…')}</div>`);
    let result: Awaited<ReturnType<WebshellService['listDirectory']>>;
    try { result = await service.listDirectory(conn, path); }
    catch (error) { if (version === fileVersion) view.set('webshell-file-list', `<div class="webshell-file-error">${escapeHtml(error instanceof Error ? error.message : error)}</div>`); throw error; }
    if (disposed || version !== fileVersion || service.currentId !== conn.id) return;
    filePath = result.path; fileEntries = result.items; assign('webshell-file-path', filePath); renderFiles(); renderTree();
  }
  function renderFiles(): void { view.renderFiles(filePath, fileEntries, value('webshell-file-filter')); }
  function renderTree(): void {
    const conn = connection(); if (!conn) return; const tree = service.getTree(conn.id);
    const root = filePath.startsWith('/') ? '/' : '.';
    if (!tree.directories.has(root)) { tree.directories.set(root, []); tree.expanded.add(root); }
    if (!/^(?:\.\.\/)*\.\.$/.test(filePath)) {
      let parent = root;
      const parts = filePath === '.' || filePath === '/' ? [] : filePath.replace(/^\//, '').split('/');
      for (const part of parts) {
        const next = joinWebshellPath(parent, part); const entries = tree.directories.get(parent) || [];
        if (!entries.some(entry => entry.name === part)) { entries.push({ name: part, type: 'directory', mode: 'd', size: '', mtime: '' }); tree.directories.set(parent, entries); }
        tree.expanded.add(parent); parent = next;
      }
    }
    function node(path: string, name: string, directory: boolean, depth: number, ancestors: Set<string>): string {
      if (ancestors.has(path) || depth > 128) return '';
      const nextAncestors = new Set(ancestors); nextAncestors.add(path);
      const children = directory ? (tree.directories.get(path) || []).slice().sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name)) : [];
      const canExpand = directory && (path === root || !tree.loaded.has(path) || children.length > 0);
      const expanded = directory && tree.expanded.has(path); const selected = !directory && service.selectedFile(conn!.id) === path;
      return `<div class="webshell-tree-node" data-depth="${depth}"><div class="webshell-tree-row${path === filePath ? ' active' : ''}${selected ? ' selected-file' : ''}"><button type="button" class="webshell-tree-toggle${canExpand ? '' : ' empty'}" data-action="webshell.tree-toggle" data-path="${escapeHtml(path)}">${canExpand ? expanded ? '▾' : '▸' : '·'}</button><button type="button" class="webshell-dir-item ${directory ? 'is-dir' : 'is-file'}" title="${escapeHtml(name)}" data-action="webshell.tree-open" data-path="${escapeHtml(path)}" data-isdir="${directory ? '1' : '0'}"><span class="webshell-tree-icon">${directory ? path === root ? '🗂' : '📁' : '📄'}</span><span class="webshell-tree-name">${escapeHtml(name)}</span></button></div>${expanded && children.length ? `<div class="webshell-tree-children">${children.map(entry => node(joinWebshellPath(path, entry.name), entry.name, entry.type === 'directory', depth + 1, nextAncestors)).join('')}</div>` : ''}</div>`;
    }
    view.set('webshell-dir-tree', `<div class="webshell-tree-root">${node(root, '/', true, 0, new Set())}</div>`);
  }
  const pathFor = (el: HTMLElement) => joinWebshellPath(filePath, el.dataset.name || '');
  async function readFile(path: string, edit: boolean): Promise<void> {
    const conn = connection(); if (!conn) return; service.selectFile(conn.id, path);
    const result = await service.file(conn, { action: 'read', path }); if (service.currentId !== conn.id || disposed) return; renderTree();
    view.set('webshell-file-list', `<div class="webshell-file-content-header">${escapeHtml(path)} <button type="button" class="btn-ghost btn-sm" data-action="webshell.file-list">${view.t('common.back', 'Back')}</button></div>${edit ? `<textarea id="webshell-edit-content" class="form-control webshell-file-edit" rows="22">${escapeHtml(result.output || '')}</textarea><button type="button" id="webshell-edit-save" class="btn-primary" data-action="webshell.file-save" data-path="${escapeHtml(path)}">${view.t('common.save', 'Save')}</button><button type="button" id="webshell-edit-cancel" class="btn-secondary" data-action="webshell.file-list">${view.t('common.cancel', 'Cancel')}</button>` : `<pre class="webshell-file-content">${escapeHtml(result.output || '')}</pre>`}`);
  }
  async function downloadFile(path: string): Promise<void> {
    const conn = connection(); if (!conn) return;
    const result = await service.file(conn, { action: 'read', path });
    browser.download(new Blob([result.output || ''], { type: 'application/octet-stream' }), path.split('/').pop() || 'download');
  }
  function selectedPaths(): string[] { return Array.from(doc.querySelectorAll<HTMLInputElement>('.webshell-file-check:checked'), input => joinWebshellPath(filePath, input.dataset.name || '')); }
  async function deleteFiles(paths: string[]): Promise<void> { const conn = connection(); if (!conn || !paths.length || !browser.confirm(deps.t('webshell.deleteFileConfirm', 'Delete the selected files?'))) return; for (const path of paths) await service.file(conn, { action: 'delete', path }); await listFiles(); }
  async function renderConversations(conn: WebshellConnection): Promise<void> {
    const list = await service.conversations(conn.id); if (disposed || service.currentId !== conn.id) return;
    view.set('webshell-ai-conv-list', list.map(item => `<div class="webshell-ai-conv-item${service.conversationId(conn.id) === item.id ? ' active' : ''}" data-conv-id="${escapeHtml(item.id)}" data-action="webshell.ai-select"><span class="webshell-ai-conv-item-title">${escapeHtml(item.title?.trim() || item.id.slice(0, 8))}</span><span class="webshell-ai-conv-item-date">${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '')}</span><button type="button" class="btn-ghost btn-sm webshell-ai-conv-del" data-action="webshell.ai-delete" data-id="${escapeHtml(item.id)}">×</button></div>`).join(''));
  }
  async function loadAiHistory(conn: WebshellConnection): Promise<void> { const history = await service.aiHistory(conn.id); if (disposed || service.currentId !== conn.id) return; aiMessages = history.messages || []; view.messages(aiMessages); updateProjectLabel(); }
  async function sendAi(): Promise<void> {
    const conn = connection(); const message = value('webshell-ai-input').trim(); if (!conn || !message || service.aiRun?.sending) return;
    assign('webshell-ai-input', ''); aiMessages.push({ role: 'user', content: message });
    const assistant: AiMessage = { role: 'assistant', content: '…', processDetails: [] }; aiMessages.push(assistant); view.messages(aiMessages);
    const run = await service.sendAi(conn, message, (_event, run) => { assistant.content = run.error || run.response || '…'; assistant.processDetails = run.details; assistant.finalized = run.finalized; if (service.currentId === conn.id && !disposed) view.messages(aiMessages); });
    assistant.content = run.error || run.response || deps.t('webshell.aiNoResponse', 'No response content'); assistant.processDetails = run.details; assistant.finalized = run.finalized;
    if (service.currentId === conn.id && !disposed) { view.messages(aiMessages); await renderConversations(conn); }
  }
  function updateProjectLabel(): void { const conn = connection(); const target = view.element('ws-project-text'); if (target && conn) target.textContent = deps.projectNames()[service.projectId(conn.id)] || deps.t('projects.noProject', 'No project'); }
  function panel(name: 'role' | 'project', open?: boolean): void {
    const ids = { role: 'ws-role-selection-panel', project: 'ws-project-panel' };
    const target = view.element(ids[name]); if (!target) return;
    const visible = open ?? target.style.display !== 'flex';
    for (const id of Object.values(ids)) { const item = view.element(id); if (item) item.style.display = item === target && visible ? 'flex' : 'none'; }
    view.element('ws-project-btn')?.setAttribute('aria-expanded', String(name === 'project' && visible));
  }
  async function refreshSelectors(): Promise<void> {
    const role = deps.role(); const label = view.element('ws-role-selector-text'); if (label) label.textContent = role || deps.t('chat.defaultRole', 'Default');
    const roles = await service.roles().catch(() => []); if (disposed) return;
    view.set('ws-role-selection-list', [{ name: '', icon: '🔵', description: deps.t('roles.defaultRoleDescription', 'Default role, no extra user prompt, uses default MCP'), enabled: true }, ...roles.filter(item => item.enabled && item.name !== BACKEND_DEFAULT_ROLE)].map(item => `<button type="button" class="role-selection-item-main${item.name === role ? ' selected' : ''}" data-action="webshell.role-select" data-name="${escapeHtml(item.name)}" data-selection-detail="${escapeHtml(item.description || '')}"><div class="role-selection-item-icon-main">${escapeHtml(item.icon || '🔵')}</div><div class="role-selection-item-content-main"><div class="role-selection-item-name-main">${escapeHtml(item.name || deps.t('chat.defaultRole', 'Default'))}</div><div class="role-selection-item-description-main">${escapeHtml((item.description || '').slice(0, 60))}</div></div></button>`).join(''));
    updateProjectLabel();
  }
  async function renderProjects(): Promise<void> {
    const conn = connection(); if (!conn) return; await deps.ensureProjects();
    if (deps.renderProjectPicker) {
      const rendered = await deps.renderProjectPicker({ listId: 'ws-project-list', searchInputId: 'ws-project-search', selectedId: service.projectId(conn.id), onSelect: id => run(() => applyProject(id)) });
      if (rendered !== false) return;
    }
    const search = value('ws-project-search').trim().toLowerCase();
    view.set('ws-project-list', [['', deps.t('projects.noProject', 'No project')], ...Object.entries(deps.projectNames())].filter(([, name]) => name?.toLowerCase().includes(search)).map(([id, name]) => `<button type="button" class="role-selection-item-main" data-action="webshell.project-select" data-id="${escapeHtml(id)}">${escapeHtml(name)}</button>`).join(''));
  }
  async function applyProject(id: string): Promise<void> { const conn = connection(); if (!conn) return; await service.setProject(conn.id, id); panel('project', false); updateProjectLabel(); }
  function collectDb(): void {
    const conn = connection(); if (!conn) return; const profile = service.activeDb(conn.id);
    profile.sql = value('webshell-db-sql'); service.queueSave(conn.id);
  }
  async function runDb(test: boolean): Promise<void> { const conn = connection(); if (!conn) return; collectDb(); await service.runSql(conn, test); view.renderDb(conn.id); }
  function dbProfileOpen(id?: string): void { const conn = connection(); if (!conn) return; dbCreate = !id; const profile = id ? service.state(conn.id).dbState.profiles.find(item => item.id === id) : newWebshellDbProfile('DB-' + (service.state(conn.id).dbState.profiles.length + 1)); if (!profile) return; dbEditId = profile.id; view.fillDbProfile(profile); dbTypeVisibility(); openAppModal('webshell-db-profile-modal'); }
  function dbTypeVisibility(): void { const sqlite = value('webshell-db-type') === 'sqlite'; doc.querySelectorAll<HTMLElement>('.webshell-db-common-field').forEach(el => { el.style.display = sqlite ? 'none' : ''; }); const row = view.element('webshell-db-sqlite-row'); if (row) row.style.display = sqlite ? '' : 'none'; if (!value('webshell-db-port')) assign('webshell-db-port', ({ mysql: '3306', pgsql: '5432', mssql: '1433' } as Record<string, string>)[value('webshell-db-type')] || ''); }
  function saveDbProfile(): void {
    const conn = connection(); if (!conn) return; const state = service.state(conn.id).dbState;
    const profile = dbCreate ? newWebshellDbProfile() : state.profiles.find(item => item.id === dbEditId); if (!profile) return;
    const type = value('webshell-db-type'); if (!['mysql', 'pgsql', 'sqlite', 'mssql'].includes(type)) return;
    Object.assign(profile, { id: dbEditId, name: value('webshell-db-profile-name').trim() || 'DB-1', type, host: value('webshell-db-host').trim(), port: value('webshell-db-port').trim(), username: value('webshell-db-user').trim(), password: value('webshell-db-pass'), database: value('webshell-db-name').trim(), sqlitePath: value('webshell-db-sqlite-path').trim() });
    if (dbCreate) state.profiles.push(profile); state.activeProfileId = profile.id; service.queueSave(conn.id); closeAppModal('webshell-db-profile-modal'); view.renderDb(conn.id);
  }
  function refreshFormSelects(root: HTMLElement | null): void {
    root?.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
      if (select.dataset.webshellFormCustom) { const label = select.parentElement?.querySelector('.webshell-form-select-value'); if (label) label.textContent = select.selectedOptions[0]?.textContent || ''; return; }
      select.dataset.webshellFormCustom = '1'; select.classList.add('webshell-form-native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      const wrapper = doc.createElement('div'); wrapper.className = 'webshell-form-select-ui'; select.before(wrapper); wrapper.append(select);
      const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className = 'webshell-form-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
      const dropdown = doc.createElement('div'); dropdown.className = 'webshell-form-select-dropdown'; dropdown.setAttribute('role', 'listbox'); wrapper.prepend(trigger, dropdown);
      const sync = () => { trigger.innerHTML = `<span class="webshell-form-select-value">${escapeHtml(select.selectedOptions[0]?.textContent || '')}</span><span class="webshell-form-select-caret" aria-hidden="true"></span>`; trigger.disabled = select.disabled; dropdown.innerHTML = Array.from(select.options, option => `<button type="button" class="webshell-form-select-option${option.value === select.value ? ' is-selected' : ''}" data-value="${escapeHtml(option.value)}" role="option" aria-selected="${option.value === select.value}"><span class="webshell-form-select-check">✓</span><span class="webshell-form-select-label">${escapeHtml(option.textContent)}</span></button>`).join(''); };
      trigger.addEventListener('click', event => { event.stopPropagation(); const open = !wrapper.classList.contains('open'); doc.querySelectorAll('.webshell-form-select-ui.open').forEach(el => el.classList.remove('open')); wrapper.classList.toggle('open', open); trigger.setAttribute('aria-expanded', String(open)); }, { signal: events.signal });
      dropdown.addEventListener('click', event => { const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-value]') : null; if (!item) return; select.value = item.dataset.value || ''; select.dispatchEvent(new Event('change', { bubbles: true })); wrapper.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); sync(); }, { signal: events.signal });
      select.addEventListener('change', sync, { signal: events.signal }); sync();
    });
  }
  function sidebar(): void {
    const sidebar = view.element('webshell-sidebar'); const handle = view.element('webshell-resize-handle'); if (!sidebar || !handle) return;
    const stored = Number(browser.storage.get('webshell_sidebar_width')); const width = stored >= 260 && stored <= 800 ? stored : 360; sidebar.style.width = Math.min(width, Math.max(260, (sidebar.parentElement?.offsetWidth || 1180) - 380)) + 'px';
    handle.addEventListener('mousedown', event => {
      if (event.button) return; event.preventDefault(); const start = event.clientX; const width = sidebar.offsetWidth;
      const move = (event: MouseEvent) => { sidebar.style.width = Math.max(260, Math.min(800, (sidebar.parentElement?.offsetWidth || 1180) - 380, width + event.clientX - start)) + 'px'; fitTerminal(); };
      const up = () => { handle.classList.remove('active'); doc.body.style.cursor = ''; doc.body.style.userSelect = ''; browser.storage.set('webshell_sidebar_width', String(parseInt(sidebar.style.width, 10))); doc.removeEventListener('mousemove', move); doc.removeEventListener('mouseup', up); };
      handle.classList.add('active'); doc.body.style.cursor = 'col-resize'; doc.body.style.userSelect = 'none';
      doc.addEventListener('mousemove', move, { signal: events.signal }); doc.addEventListener('mouseup', up, { once: true, signal: events.signal });
    }, { signal: events.signal });
  }
  function refreshLanguage(): void {
    view.renderList();
    if (!connection()) { view.placeholder(); return; }
    const tabs: Record<string, string> = { terminal: 'tabTerminal', file: 'tabFileManager', db: 'tabDbManager', ai: 'tabAiAssistant', memo: 'tabMemo' };
    doc.querySelectorAll<HTMLElement>('#webshell-workspace .webshell-tab').forEach(el => { el.textContent = deps.t('webshell.' + tabs[el.dataset.tab || '']); });
    doc.querySelectorAll<HTMLElement>('#webshell-workspace [data-i18n]').forEach(el => { el.textContent = deps.t(el.dataset.i18n || ''); });
    const labels: Record<string, string> = { '.webshell-quick-label': 'quickCommands', '.webshell-file-path-field span': 'filePath', '.webshell-file-sidebar-title': 'dirTree', '.webshell-toolbar-actions-btn': 'moreActions', '.webshell-memo-head span': 'aiMemo', '.webshell-db-sidebar-head span': 'dbSchema', '.webshell-db-output-title': 'dbOutput', '.webshell-db-hint': 'dbCliHint', '.webshell-db-sidebar-hint': 'dbSelectTableHint', '#webshell-db-profile-modal-title': 'editConnectionTitle' };
    for (const [selector, key] of Object.entries(labels)) { const target = doc.querySelector(selector); if (target) target.textContent = deps.t('webshell.' + key); }
    const placeholders: Record<string, string> = { 'webshell-file-filter': 'filterPlaceholder', 'webshell-ai-input': 'aiPlaceholder', 'webshell-ai-memo-input': 'aiMemoPlaceholder', 'webshell-db-sql': 'dbSqlPlaceholder', 'webshell-conn-search': 'searchPlaceholder' };
    for (const [id, key] of Object.entries(placeholders)) view.element(id)?.setAttribute('placeholder', deps.t('webshell.' + key));
    const fields: Record<string, string> = { type: 'dbType', 'profile-name': 'dbProfileName', host: 'dbHost', port: 'dbPort', user: 'dbUsername', pass: 'dbPassword', name: 'dbName', 'sqlite-path': 'dbSqlitePath' };
    for (const [id, key] of Object.entries(fields)) { const label = view.element('webshell-db-' + id)?.closest('label')?.querySelector('span'); if (label) label.textContent = deps.t('webshell.' + key); }
    if (service.currentId) { view.renderTerminalSessions(service.currentId); view.renderDb(service.currentId); }
    if (!aiMessages.some(message => message.role === 'user')) view.messages(aiMessages);
    run(refreshSelectors); if (doc.querySelector('#webshell-pane-file.active')) run(() => listFiles());
    const modalTitle = view.element('webshell-modal-title'); if (modalTitle) modalTitle.textContent = deps.t(value('webshell-edit-id') ? 'webshell.editConnectionTitle' : 'webshell.addConnection');
    sync();
  }
  register('add', () => openConnection()); register('edit', el => openConnection(el.dataset.id)); register('delete', el => removeConnection(el.dataset.id || '')); register('save', saveConnection); register('close', closeConnection); register('test', testConnection);
  register('select', (el, event) => { if (event.target instanceof Element && event.target.closest('details')) return; return select(el.dataset.id || ''); });
  register('search', () => view.renderList()); register('batch-probe', () => service.batchProbe());
  register('tab', el => { const tab = el.dataset.tab; doc.querySelectorAll<HTMLElement>('#webshell-workspace .webshell-tab').forEach(item => item.classList.toggle('active', item === el)); doc.querySelectorAll<HTMLElement>('#webshell-workspace .webshell-pane').forEach(item => item.classList.toggle('active', item.id === 'webshell-pane-' + tab)); if (tab === 'terminal') fitTerminal(); if (tab === 'file') return listFiles(); if (tab === 'ai') return refreshSelectors(); });
  register('terminal-clear', clearTerminal); register('terminal-copy', () => browser.copy(service.currentId ? service.terminalLog(service.currentId) : '')); register('quick', el => commandInTerminal(el.dataset.cmd || ''));
  for (const action of ['add', 'switch', 'close'] as const) register('terminal-' + action, el => { const conn = connection(); if (!conn || service.commandBusy) return; const state = service.state(conn.id).terminalSessions; const id = el.dataset.terminalId; if (action === 'add') { const next = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); state.sessions.push({ id: next, name: deps.t('webshell.terminalWindowPrefix', 'Terminal') + (state.sessions.length + 1) }); state.activeId = next; } else if (action === 'close') { if (state.sessions.length <= 1) return; const index = state.sessions.findIndex(item => item.id === id); if (index < 0) return; state.sessions.splice(index, 1); if (state.activeId === id) state.activeId = state.sessions[Math.max(0, index - 1)]!.id; } else if (id && state.sessions.some(item => item.id === id)) state.activeId = id; service.queueSave(conn.id); view.renderTerminalSessions(conn.id); initTerminal(); });
  register('file-list', () => listFiles()); register('file-parent', () => listFiles(getWebshellParentPath(filePath))); register('file-path', el => listFiles(el.dataset.path || '.')); register('file-filter', renderFiles);
  register('tree-toggle', async el => { const conn = connection(); if (!conn || el.classList.contains('empty')) return; const path = el.dataset.path || '.'; const tree = service.getTree(conn.id); if (tree.expanded.has(path)) tree.expanded.delete(path); else { if (!tree.loaded.has(path)) await service.listDirectory(conn, path); tree.expanded.add(path); } renderTree(); });
  register('tree-open', el => el.dataset.isdir === '1' ? listFiles(el.dataset.path || '.') : readFile(el.dataset.path || '', false));
  register('file-open', el => el.dataset.directory === 'true' ? listFiles(pathFor(el)) : readFile(pathFor(el), false)); register('file-read', el => readFile(pathFor(el), false)); register('file-edit', el => readFile(pathFor(el), true)); register('file-download', el => downloadFile(pathFor(el)));
  register('file-save', async el => { const conn = connection(); if (!conn) return; await service.file(conn, { action: 'write', path: el.dataset.path || '', content: value('webshell-edit-content') }); await listFiles(); });
  register('file-rename', async el => { const conn = connection(); const name = browser.prompt(deps.t('webshell.rename', 'Rename'), el.dataset.name); if (!conn || !name) return; await service.file(conn, { action: 'rename', path: pathFor(el), target_path: joinWebshellPath(filePath, name) }); await listFiles(); });
  register('file-delete', el => deleteFiles([pathFor(el)])); register('file-delete-selected', () => deleteFiles(selectedPaths())); register('file-download-selected', async () => { for (const path of selectedPaths()) await downloadFile(path); });
  register('file-select-all', el => { const checked = el instanceof HTMLInputElement && el.checked; doc.querySelectorAll<HTMLInputElement>('.webshell-file-check').forEach(input => { input.checked = checked; }); });
  for (const [action, api] of [['file-mkdir', 'mkdir'], ['file-new', 'write']] as const) register(action, async () => { const conn = connection(); const name = browser.prompt(deps.t(action === 'file-mkdir' ? 'webshell.newDir' : 'webshell.newFile')); if (!conn || !name) return; await service.file(conn, { action: api, path: joinWebshellPath(filePath, name), ...(api === 'write' ? { content: '' } : {}) }); await listFiles(); });
  register('file-upload', async () => { const conn = connection(); if (!conn) return; for (const file of await browser.pickFile()) await service.upload(conn, filePath, file); await listFiles(); });
  register('memo', () => { const conn = connection(); if (!conn) return; service.state(conn.id).dbState.aiMemo = value('webshell-ai-memo-input').slice(0, 100000); service.queueSave(conn.id); });
  register('memo-clear', () => { if (!browser.confirm(deps.t('webshell.aiMemoClearConfirm', 'Clear the memo?'))) return; const conn = connection(); if (!conn) return; assign('webshell-ai-memo-input', ''); service.state(conn.id).dbState.aiMemo = ''; service.queueSave(conn.id); });
  register('db-sql', collectDb); register('db-run', () => runDb(false)); register('db-test', () => runDb(true)); register('db-schema', async () => { const conn = connection(); if (conn) { await service.loadSchema(conn); view.renderDb(conn.id); } });
  register('db-template', () => { assign('webshell-db-sql', 'SELECT version();'); collectDb(); }); register('db-clear', () => { assign('webshell-db-sql', ''); collectDb(); });
  register('db-add', () => dbProfileOpen()); register('db-edit', el => dbProfileOpen(el.dataset.id)); register('db-close', () => { closeAppModal('webshell-db-profile-modal'); }); register('db-save', saveDbProfile); register('db-type', dbTypeVisibility);
  register('db-select', el => { const conn = connection(); if (!conn) return; collectDb(); service.state(conn.id).dbState.activeProfileId = el.dataset.id || ''; assign('webshell-db-sql', service.activeDb(conn.id).sql); service.queueSave(conn.id); view.renderDb(conn.id); });
  register('db-delete', el => { const conn = connection(); if (!conn) return; const state = service.state(conn.id).dbState; if (state.profiles.length < 2 || !browser.confirm(deps.t('webshell.dbDeleteProfileConfirm', 'Delete this database connection profile?'))) return; state.profiles = state.profiles.filter(profile => profile.id !== el.dataset.id); if (!state.profiles.some(profile => profile.id === state.activeProfileId)) state.activeProfileId = state.profiles[0]!.id; service.queueSave(conn.id); view.renderDb(conn.id); });
  register('db-database', async el => { const conn = connection(); if (!conn) return; const profile = service.activeDb(conn.id); const database = el.dataset.database || ''; profile.selectedDatabase = database; const result = await service.loadColumns(conn, database); const columns = parseWebshellDbTableColumns(result.output || ''); const entry = profile.schema[database] ??= { tables: {} }; Object.assign(entry.tables, columns); service.queueSave(conn.id); view.renderDb(conn.id); });
  register('db-table', async el => { const conn = connection(); if (!conn) return; const profile = service.activeDb(conn.id); const database = el.dataset.database || ''; const table = el.dataset.table || ''; profile.selectedDatabase = database; if (profile.type !== 'sqlite') profile.database = database; const identifier = (profile.type === 'sqlite' ? '' : quoteIdentifier(profile.type, database) + '.') + quoteIdentifier(profile.type, table); assign('webshell-db-sql', `SELECT * FROM ${identifier} ORDER BY 1 DESC LIMIT 20;`); collectDb(); const entry = profile.schema[database] ??= { tables: {} }; if (!entry.tables[table]?.length) { const result = await service.loadColumns(conn, database, table); entry.tables[table] = parseWebshellDbColumns(result.output || ''); } service.queueSave(conn.id); view.renderDb(conn.id); });
  register('db-column', el => { const conn = connection(); if (!conn) return; const profile = service.activeDb(conn.id); const database = el.dataset.database || ''; const table = el.dataset.table || ''; profile.selectedDatabase = database; if (profile.type !== 'sqlite') profile.database = database; const reference = (profile.type === 'sqlite' ? '' : quoteIdentifier(profile.type, database) + '.') + quoteIdentifier(profile.type, table); assign('webshell-db-sql', `SELECT ${quoteIdentifier(profile.type, el.dataset.column || '')} FROM ${reference} LIMIT 20;`); collectDb(); });
  register('ai-send', sendAi); register('ai-stop', () => service.stopAi()); register('ai-keydown', (_el, event) => { if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); return sendAi(); } });
  register('ai-new', () => { const conn = connection(); if (!conn) return; service.newConversation(conn.id); aiMessages = []; view.messages([]); return renderConversations(conn); });
  register('ai-select', async el => { const conn = connection(); if (!conn || service.aiRun?.sending) return; const conv = await service.selectConversation(conn.id, el.dataset.convId || ''); aiMessages = conv.messages || []; view.messages(aiMessages); updateProjectLabel(); await renderConversations(conn); });
  register('ai-delete', async el => { const conn = connection(); if (!conn || !browser.confirm(deps.t('webshell.aiDeleteConversationConfirm', 'Delete this conversation?'))) return; const id = el.dataset.id || ''; await service.deleteConversation(id); doc.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { conversationId: id } })); await renderConversations(conn); });
  register('ai-process-toggle', el => { const timeline = el.parentElement?.querySelector('.webshell-ai-timeline'); if (!timeline) return; const expanded = timeline.classList.toggle('expanded'); el.setAttribute('aria-expanded', String(expanded)); const icon = el.querySelector('.ws-toggle-icon'); if (icon) icon.textContent = expanded ? '▼' : '▶'; });
  register('role-toggle', () => panel('role')); register('role-close', () => panel('role', false)); register('role-select', el => { deps.setRole(el.dataset.name || ''); panel('role', false); return refreshSelectors(); });
  register('project-toggle', async () => { panel('project'); await renderProjects(); }); register('project-close', () => panel('project', false)); register('project-select', el => applyProject(el.dataset.id || '')); register('project-search', renderProjects); register('project-create', () => { const conn = connection(); if (conn) { panel('project', false); deps.newProject(conn.id); } });
  const search = view.element('webshell-conn-search'); if (search) search.dataset.input = 'webshell.search'; const batch = view.element('webshell-batch-probe-btn'); if (batch) batch.dataset.action = 'webshell.batch-probe';
  function sync(): void {
    view.renderList();
    const status = view.element('webshell-terminal-status');
    if (status) {
      status.classList.toggle('running', service.commandBusy); status.classList.toggle('idle', !service.commandBusy);
      status.textContent = deps.t(service.commandBusy ? 'webshell.terminalRunning' : 'webshell.terminalIdle');
    }
    const sending = service.aiRun?.sending === true;
    const send = view.element('webshell-ai-send'); const stop = view.element('webshell-ai-stop');
    if (send instanceof HTMLButtonElement) { send.disabled = sending; send.dataset.stateDisabled = String(sending); send.setAttribute('aria-disabled', String(sending)); send.style.display = sending ? 'none' : ''; }
    if (stop) stop.style.display = sending ? '' : 'none';
    const memo = view.element('webshell-ai-memo-status');
    if (memo && service.currentId) {
      const state = service.stateSaveStatus(service.currentId); memo.classList.toggle('error', state === 'error');
      memo.textContent = deps.t(state === 'saving' ? 'webshell.aiMemoSaving' : state === 'error' ? 'webshell.aiMemoSaveFailed' : 'webshell.aiMemoSaved');
    }
  }
  return {
    initWebshellPage: async () => { if (disposed) return; await service.refresh(); if (!renderedConnection) view.placeholder(); },
    selectWebshell: select, renderWebshellList: view.renderList, refreshWebshellConnectionsFromServer: service.refresh,
    showAddWebshellModal: () => openConnection(), showEditWebshellModal: openConnection, closeWebshellModal: closeConnection,
    saveWebshellConnection: saveConnection, testWebshellConnection: testConnection, deleteWebshell: removeConnection,
    destroyWebshellTerminal: destroyTerminal, runQuickCommand: commandInTerminal, applyWebshellAiProjectSelection: applyProject,
    refreshWebshellUIOnLanguageChange: refreshLanguage,
    showNewProjectModalFromWebshellAi: () => { const conn = connection(); if (conn) deps.newProject(conn.id); },
    wsCloseProjectPanel: () => panel('project', false), wsToggleProjectPanel: async () => { panel('project'); await renderProjects(); },
    refreshWebshellFormSelects: (root?: HTMLElement | null) => refreshFormSelects(root || view.element('webshell-modal')),
    activate(): void {
      if (active || disposed) return; active = true; unbind = actions.bind(doc); unsubscribe = service.subscribe(sync); unresize = browser.listenResize(fitTerminal); sidebar(); sync();
      doc.addEventListener('click', event => { const target = event.target; if (!(target instanceof Element)) return; if (!target.closest('.webshell-form-select-ui')) doc.querySelectorAll('.webshell-form-select-ui.open').forEach(el => el.classList.remove('open')); if (!target.closest('details')) doc.querySelectorAll<HTMLDetailsElement>('details.webshell-conn-actions[open],details.webshell-row-actions[open],details.webshell-toolbar-actions[open]').forEach(el => { el.open = false; }); if (!target.closest('.ws-role-selector-wrapper,.ws-project-selector-wrapper')) { panel('role', false); panel('project', false); } }, { signal: events.signal });
      doc.addEventListener('keydown', event => { if (event.key === 'Escape') { doc.querySelectorAll('.webshell-form-select-ui.open').forEach(el => el.classList.remove('open')); panel('role', false); panel('project', false); } }, { signal: events.signal });
      doc.addEventListener('languagechange', refreshLanguage, { signal: events.signal });
      doc.addEventListener('conversation-deleted', event => { const detail: unknown = event instanceof CustomEvent ? event.detail : undefined; if (!detail || typeof detail !== 'object' || !('conversationId' in detail) || typeof detail.conversationId !== 'string') return; const conn = connection(); const selected = conn && service.conversationId(conn.id) === detail.conversationId; service.forgetConversation(detail.conversationId); if (selected) { aiMessages = []; view.messages([]); updateProjectLabel(); } if (conn) run(() => renderConversations(conn)); }, { signal: events.signal });
    },
    async dispose(): Promise<void> { if (disposed) return; disposed = true; unbind?.(); unsubscribe?.(); unresize?.(); events.abort(); destroyTerminal(); fileVersion++; await service.dispose(); },
  };
}
