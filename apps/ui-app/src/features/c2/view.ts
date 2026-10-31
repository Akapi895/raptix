import type { C2Event, C2Listener, C2Profile, C2Session, C2Task } from './model';
import { eventReference, formatTaskCommand, listenerCallbackHost, sessionState } from './model';
import type { C2Service } from './service';

export interface C2ViewDependencies {
  doc: Document;
  service: C2Service;
  t(key: string, options?: Record<string, string | number>): string;
  projectNames(): Record<string, string>;
  projectName?(id: string): string;
  dynamicRender?(root: HTMLElement): void;
  paginationSelects?(root: HTMLElement): void;
}
export function escapeHtml(value: unknown): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
export function createC2View(deps: C2ViewDependencies) {
  const { doc, service } = deps; const state = service.state; const e = escapeHtml;
  const t = (key: string, options?: Record<string, string | number>) => e(deps.t(key, options));
  const element = (id: string) => doc.getElementById(id);
  function set(id: string, html: string): void { const target = element(id); if (target) { target.innerHTML = html; if (id === 'c2-modal-content') { const heading = target.querySelector('h3'); if (heading) heading.id = 'c2-modal-title'; } deps.dynamicRender?.(target); } }
  const time = (date?: string) => date && Number.isFinite(Date.parse(date)) && Date.parse(date) > 0 ? new Date(date).toLocaleString() : '—';
  function relativeTime(date?: string): string {
    const ms = date ? Date.parse(date) : 0; if (!Number.isFinite(ms) || ms <= 0) return '';
    const diff = Math.max(0, Date.now() - ms);
    return diff < 60000 ? deps.t('c2.common.justNow') : diff < 3600000 ? deps.t('c2.common.minutesAgo', { n: Math.floor(diff / 60000) }) : diff < 86400000 ? deps.t('c2.common.hoursAgo', { n: Math.floor(diff / 3600000) }) : time(date);
  }
  const duration = (ms?: number) => ms == null || ms < 0 ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  function label(key: string, fallback: string): string { const value = deps.t(key); return value === key ? fallback : value; }
  const taskStatus = (status?: string) => label('c2.tasks.' + String(status || 'unknown').toLowerCase(), status || deps.t('c2.common.unknown'));
  const sessionStatus = (s: C2Session) => label('c2.sessions.' + sessionState(s), deps.t('c2.common.unknown'));
  function badge(status: string | undefined, text: string): string { return `<span class="c2-status-badge ${e(status || 'unknown')}">${e(text)}</span>`; }
  const stamp = (date?: string) => `<time${date && Number.isFinite(Date.parse(date)) ? ` datetime="${e(date)}"` : ''} title="${e(time(date))}">${e(time(date))}</time>`;
  function action(name: string, text: string, id = '', className = 'btn-secondary btn-sm', permission?: string): string {
    return `<button type="button" class="${className}" data-action="c2.${name}" data-id="${e(id)}"${permission ? ` data-require-permission="${permission}"` : ''}>${text}</button>`;
  }
  const close = () => `<button type="button" class="c2-modal-close" data-action="c2.modal-close" aria-label="${t('common.close')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
  const empty = (text: string) => `<div class="c2-empty" role="status">${text}</div>`;
  const table = (heads: string[], rows: string, cls = '') => `<div class="c2-table-wrap"><table class="c2-table ${cls}"><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  function projectDisplayName(id: string, hint?: string): string {
    const readable = (name?: string) => Boolean(name?.trim() && name.trim() !== id && !/^[0-9a-f-]{36}$/i.test(name));
    const name = hint || deps.projectNames()[id] || deps.projectName?.(id);
    return readable(name) ? name!.trim() : deps.t('batchManageModal.unknownProject');
  }
  function projectOptions(selected: string): string {
    const entries = Object.entries(deps.projectNames()).sort(([, a], [, b]) => a.localeCompare(b));
    return `<option value="">${t('assets.unboundProject')}</option>` + entries.map(([id, name]) => `<option value="${e(id)}"${id === selected ? ' selected' : ''}>${e(projectDisplayName(id, name))}</option>`).join('') + (selected && !entries.some(([id]) => id === selected) ? `<option value="${e(selected)}" selected>${e(projectDisplayName(selected))}</option>` : '');
  }
  function profileOptions(selected: string): string { return `<option value="">${t('c2.listeners.malleableProfileNone')}</option>` + state.profiles.map(p => `<option value="${e(p.id || p.ID)}"${(p.id || p.ID) === selected ? ' selected' : ''}>${e(p.name || p.id)}</option>`).join(''); }
  function renderListeners(): void {
    if (!state.listeners.length) { set('c2-listener-grid', empty(`<h3>${t('c2.listeners.emptyTitle')}</h3><p>${t('c2.listeners.emptyHint')}</p>`)); return; }
    const rows = state.listeners.map(l => {
      const status = String(l.status || 'unknown').toLowerCase();
      const profileId = l.profileId || l.profile_id; const profile = state.profiles.find(p => (p.id || p.ID) === profileId);
      const callback = listenerCallbackHost(l); const count = state.listenerSessionCounts?.[l.id];
      const address = l.bindHost?.includes(':') ? `[${l.bindHost}]:${l.bindPort}` : `${l.bindHost || '—'}:${l.bindPort ?? '—'}`;
      return `<tr data-listener-id="${e(l.id)}"><td><strong>${e(l.name || l.id)}</strong><span class="c2-cell-secondary">${e(label('c2.listeners.typeLabels.' + l.type, l.type || '—'))}${profileId ? ' · ' + e(profile?.name || profileId) : ''}</span><details class="c2-inline-details"><summary>${t('c2.common.metadata')}</summary><dl class="c2-detail-list"><dt>${t('c2.common.id')}</dt><dd>${e(l.id)}</dd><dt>${t('c2.listeners.remark')}</dt><dd>${e(l.remark || '—')}</dd><dt>${t('c2.tasks.colCreated')}</dt><dd>${stamp(l.createdAt)}</dd><dt>${t('c2.listeners.startedAtPrefix')}</dt><dd>${stamp(l.startedAt)}</dd></dl><label>${t('assets.project')}<select class="c2-project-bind-select" data-require-permission="c2:write" data-id="${e(l.id)}" data-change="c2.listener-project">${projectOptions(l.project_id || l.projectId || '')}</select></label></details></td>
        <td><code>${e(address)}</code></td><td><code>${e(callback || deps.t('c2.listeners.callbackAutomatic'))}</code></td>
        <td>${badge(status, label('c2.listeners.' + status, status === 'error' ? deps.t('c2.listeners.statusError') : deps.t('c2.common.unknown')))}${l.lastError ? `<span class="c2-cell-secondary c2-text-error">${e(l.lastError)}</span>` : ''}</td>
        <td>${state.listenerSessionCounts ? `<a href="#c2-sessions?listener=${encodeURIComponent(l.id)}" class="c2-reference">${count ?? 0}</a>` : `<span title="${t('c2.listeners.sessionCountUnavailable')}">—</span>`}</td>
        <td><div class="c2-row-actions">${action('listener-' + (status === 'running' ? 'stop' : 'start'), t('c2.listeners.' + (status === 'running' ? 'stop' : 'start')), l.id, 'btn-secondary btn-sm', 'c2:write')}${action('listener-edit', t('common.edit'), l.id, 'btn-secondary btn-sm', 'c2:write')}${action('listener-delete', t('common.delete'), l.id, 'btn-ghost btn-sm c2-text-error', 'c2:delete')}</div></td></tr>`;
    }).join('');
    set('c2-listener-grid', table(['name', 'bindEndpoint', 'callbackShort', 'status', 'sessions', 'actions'].map(k => t('c2.listeners.' + k)), rows, 'c2-listeners-table'));
  }
  const input = (id: string, text: string, value = '', type = 'text', hint = '') => `<div class="c2-form-group"><label for="${id}">${text}</label><input type="${type}" id="${id}" class="form-control" value="${e(value)}"${type === 'number' ? ' min="1" max="65535" step="1"' : ''}>${hint ? `<p class="form-hint">${hint}</p>` : ''}</div>`;
  function listenerForm(l?: C2Listener, selectedProject = ''): void {
    const type = `<div class="c2-form-group"><label for="c2-listener-type">${t('c2.listeners.type')}</label><select id="c2-listener-type" class="form-control c2-form-select-native" data-change="c2.listener-type">${['http_beacon', 'https_beacon', 'tcp_reverse', 'websocket'].map(value => `<option value="${value}">${t('c2.listeners.typeLabels.' + value)}</option>`).join('')}</select></div>`;
    set('c2-modal-content', `<div class="c2-modal-header"><h3>${t(l ? 'c2.listeners.editTitle' : 'c2.listeners.modalCreateTitle')}</h3>${close()}</div><div class="c2-modal-body">
      <div class="c2-form-row">${input('c2-listener-name', t('c2.listeners.name') + ' *', l?.name)}${l ? '' : type}</div>
      <div class="c2-form-group"><label for="c2-listener-project-id">${t('assets.project')}</label><select id="c2-listener-project-id" class="form-control c2-form-select-native">${projectOptions(l?.project_id || l?.projectId || selectedProject)}</select></div>
      <div class="c2-form-row">${input('c2-listener-host', t('c2.listeners.bindHost'), l?.bindHost || '127.0.0.1', 'text', t('c2.listeners.bindHintExternal'))}${input('c2-listener-port', t('c2.listeners.bindPort') + ' *', String(l?.bindPort || ''), 'number')}</div>
      ${input('c2-listener-callback-host', t('c2.listeners.callbackHost'), l ? listenerCallbackHost(l) : '', 'text', t('c2.listeners.callbackHostHint'))}
      <div class="c2-form-group" id="c2-listener-profile-group"><label for="c2-listener-profile-id">${t('nav.c2Profiles')}</label><select id="c2-listener-profile-id" class="form-control c2-form-select-native">${profileOptions(l?.profileId || l?.profile_id || '')}</select><p class="form-hint">${t('c2.listeners.malleableProfileHint')}</p><a href="#c2-listeners?tab=profiles" data-action="c2.profiles-open">${t('c2.listeners.manageProfiles')}</a></div>
      ${input('c2-listener-remark', t('c2.listeners.remark'), l?.remark)}
      <div class="c2-form-group" id="c2-listener-legacy-shell-group"><label class="c2-checkbox-label"><input type="checkbox" id="c2-listener-legacy-shell">${t('c2.listeners.allowLegacyShell')}</label><p class="form-hint">${t('c2.listeners.allowLegacyShellHint')}</p></div>
      <div id="c2-form-error" class="c2-form-error" role="alert" hidden></div></div><div class="c2-modal-footer">${action('modal-close', t('common.cancel'))}${action('listener-save', t(l ? 'common.save' : 'c2.listeners.submitCreate'), l?.id, 'btn-primary', 'c2:write')}</div>`);
  }
  function renderSessionToolbar(): void {
    const f = state.sessionFilter;
    set('c2-session-toolbar', `<div class="c2-sessions-filter-row"><label class="c2-filter-label">${t('c2.sessions.status')}<select id="c2-session-filter-status" class="form-control" data-change="c2.sessions-filter"><option value="">${t('c2.sessions.filterAllStatus')}</option>${['active', 'sleeping', 'stale', 'disconnected', 'unknown'].map(status => `<option value="${status}"${f.status === status ? ' selected' : ''}>${t('c2.sessions.' + status)}</option>`).join('')}</select></label><label class="c2-filter-label">${t('nav.c2Listeners')}<select id="c2-session-filter-listener" class="form-control" data-change="c2.sessions-filter"><option value="">${t('c2.sessions.filterAllListeners')}</option>${state.listeners.map(l => `<option value="${e(l.id)}"${f.listener_id === l.id ? ' selected' : ''}>${e(l.name)}</option>`).join('')}</select></label></div>
      <label class="c2-filter-label">${t('common.search')}<input type="search" id="c2-session-filter-search" class="form-control" placeholder="${t('c2.sessions.filterSearchPlaceholder')}" value="${e(f.search)}" data-keydown="c2.sessions-filter-enter"></label>
      <div class="c2-sessions-toolbar-meta"><label><input type="checkbox" id="c2-sessions-select-all" data-change="c2.sessions-select-all"> ${t('c2.sessions.selectAll')}</label><button type="button" class="btn-ghost btn-sm" data-action="c2.sessions-reset">${t('c2.sessions.filterReset')}</button><button type="button" class="btn-ghost btn-sm" data-action="c2.sessions-suspicious" aria-pressed="${f.suspicious}">${t('c2.sessions.filterSuspicious')}</button><span id="c2-sessions-count" role="status"></span></div>`);
  }
  function sessionEmpty(): void {
    const filtered = Object.values(state.sessionFilter).some(Boolean); const hasSessions = state.sessions.length > 0;
    set('c2-session-main', `<div class="c2-session-main-empty"><h3>${t(hasSessions ? 'c2.sessions.selectPromptTitle' : filtered ? 'c2.sessions.emptyFilter' : 'c2.sessions.listEmpty')}</h3><p>${t(hasSessions ? 'c2.sessions.selectPromptHint' : filtered ? 'c2.sessions.emptyFilterHint' : 'c2.sessions.emptyHint')}</p>${hasSessions ? '' : filtered ? action('sessions-reset', t('c2.sessions.filterReset')) : `<a href="#c2-listeners" class="c2-reference">${t('nav.c2Listeners')}</a>`}</div>`);
  }
  function renderSessions(): void {
    const f = state.sessionFilter;
    if (!state.sessions.length) { set('c2-session-list', empty(t(f.status || f.search || f.listener_id || f.suspicious ? 'c2.sessions.emptyFilter' : 'c2.sessions.listEmpty'))); return; }
    set('c2-session-list', state.sessions.map(s => `<div class="c2-session-item${s.id === state.selectedSessionId ? ' active' : ''}" data-status="${sessionState(s)}">
      <input type="checkbox" class="c2-session-row-check" aria-label="${t('c2.common.select')} ${e(s.hostname || s.id)}" data-id="${e(s.id)}" data-change="c2.sessions-selection">
      <button type="button" class="c2-session-select" data-action="c2.session-select" data-id="${e(s.id)}" aria-pressed="${s.id === state.selectedSessionId}"><span class="c2-session-header"><strong class="c2-session-host">${e(s.hostname || deps.t('c2.sessions.unknownHost'))}</strong>${badge(sessionState(s), sessionStatus(s))}</span><span class="c2-session-meta">${e(s.username || '—')} · ${e([s.os, s.arch].filter(Boolean).join('/') || '—')}${s.isAdmin ? ' · ' + t('c2.sessions.isAdmin') : ''}</span><span class="c2-session-meta c2-session-foot"><span>${e(s.internalIp || '—')} · PID ${e(s.pid ?? '—')}</span><time title="${e(time(s.lastCheckIn))}">${e(relativeTime(s.lastCheckIn) || '—')}</time></span></button>
      ${action('session-delete', t('common.delete'), s.id, 'btn-ghost btn-sm c2-session-card-delete c2-text-error', 'c2:delete')}</div>`).join(''));
  }
  function sessionInfo(s: C2Session): string {
    const row = (key: string, value: unknown, copy = false) => `<dt>${t('c2.sessions.' + key)}</dt><dd><span>${e(value || '—')}</span>${copy && value ? `<button type="button" class="btn-ghost btn-sm" data-action="c2.copy" data-value="${e(value)}" aria-label="${t('c2.sessions.infoCopy')} ${t('c2.sessions.' + key)}">${t('common.copy')}</button>` : ''}</dd>`;
    const section = (key: string, rows: string) => `<section class="c2-info-section"><h3>${t('c2.sessions.' + key)}</h3><dl class="c2-detail-list">${rows}</dl></section>`;
    return `<div class="c2-session-info-panel">${section('infoSectionIdentity', row('infoHostname', s.hostname) + row('infoUsername', s.username) + row('infoSessionId', s.id, true) + row('infoImplantUuid', s.implantUuid, true))}
      ${section('infoSectionSystem', row('infoOs', s.os) + row('infoArch', s.arch) + row('infoProcess', s.processName) + row('infoPid', s.pid) + row('infoAdmin', deps.t(s.isAdmin ? 'c2.sessions.adminYes' : 'c2.sessions.adminNo')))}
      ${section('infoSectionNetwork', row('infoListener', state.listeners.find(l => l.id === s.listenerId)?.name || s.listenerId) + row('infoInternalIp', s.internalIp, true) + row('infoExternalIp', s.externalIp, true) + row('infoTransport', s.metadata?.transport) + row('infoUserAgent', s.userAgent) + row('infoSleep', deps.t('c2.sessions.infoSleepLine', { sec: s.sleepSeconds, jitter: s.jitterPercent })) + row('infoFirstSeen', time(s.firstSeenAt)) + row('infoLastCheckin', time(s.lastCheckIn)))}
      <section class="c2-info-section"><div class="c2-section-heading"><h3>${t('c2.sessions.infoSectionNote')}</h3>${action('session-note-edit', t('c2.sessions.noteEdit'), s.id, 'btn-secondary btn-sm c2-session-note-edit-btn', 'c2:write')}</div><p id="c2-session-note-view" class="c2-session-info-note">${e(s.note || deps.t('c2.sessions.infoNoteEmpty'))}</p><div id="c2-session-note-editor" hidden><label for="c2-session-note-input">${t('c2.sessions.infoNote')}</label><textarea id="c2-session-note-input" class="form-control" maxlength="2000" rows="4" data-input="c2.note-counter">${e(s.note)}</textarea><div class="c2-section-heading"><span id="c2-session-note-counter"></span><div class="c2-row-actions">${action('session-note-cancel', t('common.cancel'))}<button type="button" id="c2-session-note-save" class="btn-primary" data-action="c2.session-note-save" data-id="${e(s.id)}">${t('common.save')}</button></div></div></div></section>
      ${s.metadata && Object.keys(s.metadata).length ? `<details class="c2-inline-details"><summary>${t('c2.common.metadata')}</summary><pre>${e(JSON.stringify(s.metadata, null, 2))}</pre></details>` : ''}</div>`;
  }
  function renderSessionDetail(s: C2Session, tab = 'terminal'): void {
    set('c2-session-main', `<div class="c2-session-detail"><div class="c2-session-hero"><div><div class="c2-section-heading"><h3 class="c2-session-hero__title">${e(s.hostname || s.id)}</h3>${badge(sessionState(s), sessionStatus(s))}</div><p class="c2-session-meta">${e(s.username || '—')} · ${e([s.os, s.arch].filter(Boolean).join('/') || '—')} · ${e(s.internalIp || '—')} · <code>${e(s.id)}</code></p></div><div class="c2-row-actions">${action('session-sleep', t('c2.sessions.btnSleep'), s.id, 'btn-secondary btn-sm', 'c2:write')}${action('session-kill', t('c2.sessions.kill'), s.id, 'btn-ghost btn-sm c2-text-error', 'c2:write')}</div></div>
      <div id="c2-session-connection" class="c2-connection-notice" role="status"></div>
      <nav class="c2-session-tabs" aria-label="${t('c2.sessions.selectSession')}">${['terminal', 'files', 'tasks', 'info'].map(name => `<button type="button" class="c2-session-tab${name === tab ? ' active' : ''}" data-tab="${name}" data-action="c2.tab" aria-controls="c2-tab-${name}"${name === tab ? ' aria-current="page"' : ''}>${t('c2.sessions.' + name)}</button>`).join('')}</nav>
      <div class="c2-session-tab-content">${['terminal', 'files', 'tasks', 'info'].map(name => `<section id="c2-tab-${name}" class="c2-tab-panel${name === tab ? ' active' : ''}"${name !== tab ? ' hidden' : ''}>
        ${name === 'terminal' ? `<div id="c2-terminal-container" class="c2-terminal-container" aria-label="${t('c2.sessions.terminal')}"></div><div class="c2-terminal-toolbar">${action('terminal-clear', t('c2.sessions.clearTerminal'), '', 'btn-ghost btn-sm')}${action('terminal-copy', t('common.copy'), '', 'btn-ghost btn-sm')}<span id="c2-terminal-status" role="status" aria-live="polite"></span></div>` : name === 'files' ? `<div class="c2-file-panel"><div class="c2-file-toolbar">${action('file-parent', t('c2.files.parent'))}${action('files-refresh', t('common.refresh'))}<button type="button" id="c2-file-upload-btn" class="btn-secondary btn-sm" data-action="c2.file-upload" data-require-permission="c2:write">${t('c2.files.upload')}</button><input type="file" id="c2-file-upload-input" data-change="c2.file-pick" hidden></div><nav id="c2-current-path" class="c2-path-breadcrumb" aria-label="${t('c2.files.path')}"></nav><p id="c2-file-upload-hint" class="form-hint" hidden></p><div id="c2-file-upload-progress" role="status" hidden><span id="c2-file-upload-progress-label"></span><div class="c2-file-upload-progress-track"><div id="c2-file-upload-progress-fill"></div></div></div><div id="c2-file-list" aria-live="polite"></div></div>` : name === 'tasks' ? '<div id="c2-session-tasks-list" aria-live="polite"></div>' : sessionInfo(s)}
      </section>`).join('')}</div></div>`);
  }
  function renderSessionConnection(s: C2Session): void {
    const status = sessionState(s);
    const target = element('c2-session-connection');
    if (target) { target.dataset.status = status; target.textContent = deps.t('c2.sessions.connection.' + status) + ' ' + deps.t('c2.sessions.lastCheckIn') + ': ' + time(s.lastCheckIn) + (status === 'stale' ? ` (${deps.t('c2.sessions.status')}: ${s.status})` : ''); }
    doc.querySelectorAll<HTMLElement>('.c2-session-hero .c2-status-badge').forEach(el => { el.className = 'c2-status-badge ' + status; el.textContent = sessionStatus(s); });
  }
  function refreshSessionMetadata(s: C2Session): void {
    const heading = doc.querySelector('.c2-session-hero__title'); if (heading) heading.textContent = s.hostname || s.id;
    const metadata = doc.querySelector('.c2-session-hero > div:first-child > .c2-session-meta'); if (metadata) metadata.textContent = `${s.username || '—'} · ${[s.os, s.arch].filter(Boolean).join('/') || '—'} · ${s.internalIp || '—'} · ${s.id}`;
    const editor = element('c2-session-note-editor'); if (!editor || editor.hidden) set('c2-tab-info', sessionInfo(s));
  }
  function renderSessionTasks(id: string, tasks: C2Task[], total = tasks.length, page = 1): void {
    const rows = tasks.map(task => `<tr><td>${badge(task.status, taskStatus(task.status))}</td><td><strong>${e(task.taskType || '—')}</strong><code class="c2-cell-secondary">${e(formatTaskCommand(task) || '—')}</code></td><td>${stamp(task.createdAt)}<span class="c2-cell-secondary">${task.completedAt ? t('c2.tasks.labelCompleted') + ' ' + stamp(task.completedAt) : e(taskStatus(task.status))}</span></td><td class="c2-result-cell">${e((task.error || task.resultText || '—').slice(0, 200))}</td><td>${e(duration(task.durationMs))}</td><td>${action('task-view', t('c2.tasks.view'), task.id)}</td></tr>`).join('');
    set('c2-session-tasks-list', `<div class="c2-section-heading"><h3>${t('c2.tasks.sessionTaskHistory')} <span class="c2-muted">${total}</span></h3>${action('session-tasks-refresh', t('common.refresh'), id)}</div>${rows ? table(['colStatus', 'colCommand', 'colCreated', 'result', 'colDuration', 'colActions'].map(k => t('c2.tasks.' + k)), rows) : empty(t('c2.tasks.emptySession'))}${total > 25 ? `<div class="c2-row-actions c2-session-pagination">${action('session-tasks-prev', t('c2.tasks.paginationPrev'), id)}<span>${t('c2.tasks.paginationPage', { current: page, total: Math.ceil(total / 25) })}</span>${action('session-tasks-next', t('c2.tasks.paginationNext'), id)}</div>` : ''}`);
  }
  function renderBreadcrumbs(path: string): void {
    const normalized = path.replace(/\\/g, '/'); const absolute = normalized.startsWith('/'); const parts = normalized.split('/').filter(Boolean); const drive = /^[A-Za-z]:$/.test(parts[0] || '') ? parts.shift()! + '/' : '';
    const root = drive || (absolute ? '/' : '.'); const crumbs = [{ label: root, path: root }];
    parts.forEach((part, index) => { if (part !== '.') crumbs.push({ label: part, path: (drive || (absolute ? '/' : '')) + parts.slice(0, index + 1).join('/') }); });
    set('c2-current-path', crumbs.map((crumb, index) => index === crumbs.length - 1 ? `<span aria-current="location">${e(crumb.label)}</span>` : `<button type="button" class="btn-ghost btn-sm" data-action="c2.file-path" data-path="${e(crumb.path)}">${e(crumb.label)}</button><span aria-hidden="true">/</span>`).join(''));
  }
  function renderFiles(): void {
    const rows = state.fileList.map(file => `<tr><td>${file.isDir ? `<button type="button" class="c2-reference" data-action="c2.file-open" data-name="${e(file.name)}">${e(file.name)}/</button>` : `<span>${e(file.name)}</span>`}</td><td>${e(file.isDir ? '—' : file.size + ' B')}</td><td><code>${e(file.permissions)}</code></td><td>${action('file-' + (file.isDir ? 'open' : 'download'), t(file.isDir ? 'c2.files.open' : 'c2.files.download'), '', 'btn-ghost btn-sm').replace('data-id=""', `data-name="${e(file.name)}"`)}</td></tr>`).join('');
    set('c2-file-list', rows ? table(['colName', 'colSize', 'colMode', 'colActions'].map(k => t('c2.files.' + k)), rows) : empty(t('c2.files.emptyDir')));
    renderBreadcrumbs(service.remotePath(state.currentPath, ''));
  }
  const reference = (kind: 'session' | 'task', id: string, text?: string) => id ? action(kind === 'session' ? 'related-session' : 'task-view', e(text || id), id, 'c2-reference') : '—';
  const selectAll = (kind: 'tasks' | 'events') => `<input type="checkbox" id="c2-${kind}-select-all" aria-label="${t('c2.' + kind + '.selectAll')}" data-change="c2.${kind}-select-all">`;
  function renderTasks(): void {
    const query = state.tasksSearch.toLowerCase();
    const tasks = state.tasks.filter(task => [task.id, task.sessionId, task.taskType, task.resultText, task.error, formatTaskCommand(task)].some(value => String(value || '').toLowerCase().includes(query)));
    const rows = tasks.map(task => `<tr data-task-id="${e(task.id)}"><td><input type="checkbox" class="c2-task-row-check" data-id="${e(task.id)}" aria-label="${t('c2.common.select')} ${e(task.id)}" data-change="c2.tasks-selection"></td><td>${badge(task.status, taskStatus(task.status))}</td><td>${reference('session', task.sessionId, state.sessions.find(s => s.id === task.sessionId)?.hostname)}<span class="c2-cell-secondary">${e(task.sessionId)}</span></td><td><strong>${e(task.taskType || deps.t('c2.common.unknown'))}</strong><code class="c2-cell-secondary">${e(formatTaskCommand(task) || '—')}</code></td><td>${stamp(task.createdAt)}${task.completedAt ? `<span class="c2-cell-secondary">${t('c2.tasks.labelCompleted')} ${stamp(task.completedAt)}</span>` : ''}</td><td class="c2-result-cell" title="${e(task.error || task.resultText)}">${e((task.error || task.resultText || '—').slice(0, 160))}</td><td>${e(duration(task.durationMs))}</td><td><div class="c2-row-actions">${action('task-view', t('c2.tasks.view'), task.id)}${['queued', 'sent'].includes(task.status) ? action('task-cancel', t('c2.tasks.cancelBtn'), task.id, 'btn-secondary btn-sm', 'c2:write') : ''}${action('task-delete', t('common.delete'), task.id, 'btn-ghost btn-sm c2-text-error', 'c2:delete')}</div></td></tr>`).join('');
    set('c2-task-list', rows ? table([selectAll('tasks'), ...['colStatus', 'colSession', 'colCommand', 'colCreated', 'result', 'colDuration', 'colActions'].map(k => t('c2.tasks.' + k))], rows, 'c2-tasks-table') : empty(t(query ? 'c2.activity.noSearchResults' : 'c2.tasks.emptyAll')));
    summary('tasks', state.tasksTotal, state.tasksCountsKnown ? state.tasksStatusCounts : { success: null, failed: null, pending: null }); pagination('tasks');
  }
  function renderEvents(): void {
    const query = state.eventsSearch.toLowerCase();
    const events = state.events.filter(event => [event.id, event.level, event.category, event.message, eventReference(event, 'session'), eventReference(event, 'task')].some(value => String(value || '').toLowerCase().includes(query)));
    const rows = events.map(event => `<tr data-event-id="${e(event.id)}"><td><input type="checkbox" class="c2-event-check" data-id="${e(event.id)}" aria-label="${t('c2.common.select')} ${e(event.id)}" data-change="c2.events-selection"></td><td>${stamp(event.createdAt)}</td><td>${badge(event.level, label('c2.events.' + event.level, event.level || deps.t('c2.common.unknown')))}</td><td>${e(label('c2.events.' + event.category, event.category || '—'))}</td><td class="c2-result-cell">${e(event.message || '—')}</td><td>${reference('session', eventReference(event, 'session'))}</td><td>${reference('task', eventReference(event, 'task'))}</td><td><div class="c2-row-actions">${action('event-view', t('c2.tasks.view'), event.id)}${action('event-delete', t('common.delete'), event.id, 'btn-ghost btn-sm c2-text-error', 'c2:delete')}</div></td></tr>`).join('');
    set('c2-event-list', rows ? table([selectAll('events'), ...['time', 'level', 'category', 'message', 'colSession', 'colTask'].map(k => t('c2.events.' + k)), t('common.actions')], rows, 'c2-events-table') : empty(t(query ? 'c2.activity.noSearchResults' : 'c2.events.empty')));
    summary('events', state.eventsTotal, state.eventsCountsKnown ? state.eventsLevelCounts : { info: null, warn: null, critical: null }); pagination('events');
  }
  function summary(kind: string, total: number, counts: object): void { for (const [key, value] of Object.entries({ total, ...counts })) { const target = element(`c2-${kind}-stat-${key}`); if (target) target.textContent = value == null ? '—' : String(value); } const root = element(`c2-${kind}-summary`); if (root) root.hidden = false; }
  function pagination(kind: 'tasks' | 'events'): void {
    const total = kind === 'tasks' ? state.tasksTotal : state.eventsTotal; const page = kind === 'tasks' ? state.tasksPage : state.eventsPage; const size = kind === 'tasks' ? state.tasksPageSize : state.eventsPageSize; const pages = Math.max(1, Math.ceil(total / size));
    const nav = (target: number, suffix: string, disabled: boolean) => `<button type="button" class="btn-secondary btn-sm" data-action="c2.${kind}-page" data-page="${target}"${disabled ? ' disabled' : ''}>${t(`c2.${kind}.pagination${suffix}`)}</button>`;
    set(`c2-${kind}-pagination`, total ? `<div class="monitor-pagination"><div class="pagination-info">${t(`c2.${kind}.paginationShow`, { start: (page - 1) * size + 1, end: Math.min(page * size, total), total })}<label>${t(`c2.${kind}.paginationPerPage`)} <select id="c2-${kind}-page-size-pagination" data-change="c2.${kind}-page-size">${[10, 20, 50, 100].map(value => `<option value="${value}"${size === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label></div><div class="pagination-controls">${nav(1, 'First', page === 1)}${nav(page - 1, 'Prev', page === 1)}<span>${t(`c2.${kind}.paginationPage`, { current: page, total: pages })}</span>${nav(page + 1, 'Next', page >= pages)}${nav(pages, 'Last', page >= pages)}</div></div>` : '');
  }
  function taskDetail(task: C2Task): void {
    element('c2-modal')?.querySelector('.c2-modal')?.classList.add('c2-modal--wide');
    const kv = (key: string, html: string) => `<dt>${t('c2.tasks.' + key)}</dt><dd>${html}</dd>`;
    const block = (id: string, key: string, value: string) => `<section class="c2-code-section"><div class="c2-section-heading"><h4>${t('c2.tasks.' + key)}</h4>${action('copy-block', t('common.copy'), id, 'btn-ghost btn-sm')}</div><pre id="${id}">${e(value)}</pre></section>`;
    set('c2-modal-content', `<div class="c2-modal-header"><h3>${t('c2.tasks.modalTitle')}</h3>${badge(task.status, taskStatus(task.status))}${close()}</div><div class="c2-modal-body"><dl class="c2-detail-list c2-task-detail-grid">${kv('labelId', e(task.id))}${kv('labelSession', reference('session', task.sessionId))}${kv('labelType', e(task.taskType || '—'))}${kv('labelDuration', e(duration(task.durationMs)))}${kv('source', e(task.source || '—'))}${kv('approval', e(task.approvalStatus || '—'))}${[['labelCreated', task.createdAt], ['labelSent', task.sentAt], ['labelStarted', task.startedAt], ['labelCompleted', task.completedAt]].map(([key, date]) => kv(key!, stamp(date))).join('')}</dl>${formatTaskCommand(task) ? block('c2-task-cmd-pre', 'labelCommand', formatTaskCommand(task)) : ''}${task.payload ? block('c2-task-payload-pre', 'labelPayload', JSON.stringify(task.payload, null, 2)) : ''}${task.error ? `<div class="c2-error" role="alert">${e(task.error)}</div>` : ''}${block('c2-task-result-pre', 'labelResult', task.resultText || deps.t('c2.tasks.noOutput'))}${task.resultBlobPath ? action('task-result-download', t('c2.files.download'), task.id, 'btn-secondary') : ''}</div><div class="c2-modal-footer">${action('modal-close', t('common.close'))}</div>`);
  }
  function eventDetail(event: C2Event): void {
    element('c2-modal')?.querySelector('.c2-modal')?.classList.add('c2-modal--wide');
    set('c2-modal-content', `<div class="c2-modal-header"><h3>${t('c2.events.detailTitle')}</h3>${badge(event.level, label('c2.events.' + event.level, event.level || deps.t('c2.common.unknown')))}${close()}</div><div class="c2-modal-body"><dl class="c2-detail-list"><dt>${t('c2.common.id')}</dt><dd>${e(event.id)}</dd><dt>${t('c2.events.time')}</dt><dd>${stamp(event.createdAt)}</dd><dt>${t('c2.events.category')}</dt><dd>${e(label('c2.events.' + event.category, event.category || '—'))}</dd><dt>${t('c2.events.colSession')}</dt><dd>${reference('session', eventReference(event, 'session'))}</dd><dt>${t('c2.events.colTask')}</dt><dd>${reference('task', eventReference(event, 'task'))}</dd></dl><p class="c2-event-message">${e(event.message || '—')}</p><div class="c2-section-heading"><h4>${t('c2.events.detailData')}</h4>${action('copy-block', t('common.copy'), 'c2-event-data-pre', 'btn-ghost btn-sm')}</div><pre id="c2-event-data-pre">${e(JSON.stringify(event.data || {}, null, 2))}</pre></div><div class="c2-modal-footer">${action('modal-close', t('common.close'))}</div>`);
  }
  function renderProfiles(): void {
    const rows = state.profiles.map(p => `<tr><td><strong>${e(p.name || p.id)}</strong><span class="c2-cell-secondary">${e(p.id || p.ID)}</span></td><td class="c2-result-cell">${e(p.userAgent || deps.t('c2.profiles.defaultValue'))}</td><td><code>${e((p.uris || []).join(', ') || '—')}</code></td><td>${e(p.jitterMinMs ?? 0)}–${e(p.jitterMaxMs ?? 0)} ms</td><td><div class="c2-row-actions">${action('profile-edit', t('common.edit'), p.id || p.ID, 'btn-secondary btn-sm', 'c2:write')}${action('profile-delete', t('common.delete'), p.id || p.ID, 'btn-ghost btn-sm c2-text-error', 'c2:delete')}</div></td></tr>`).join('');
    set('c2-profile-list', rows ? table([t('c2.listeners.name'), t('c2.profiles.userAgent'), t('c2.profiles.labelBeaconUris'), t('c2.profiles.jitter'), t('common.actions')], rows) : empty(t('c2.profiles.empty')));
  }
  function profileForm(p?: C2Profile): void {
    const area = (id: string, key: string, value: string) => `<div class="c2-form-group"><label for="${id}">${t('c2.profiles.' + key)}</label><textarea id="${id}" class="form-control" rows="3">${e(value)}</textarea></div>`;
    set('c2-modal-content', `<div class="c2-modal-header"><h3>${t(p ? 'c2.profiles.editTitle' : 'c2.profiles.modalCreateTitle')}</h3>${close()}</div><div class="c2-modal-body">${input('c2-profile-name', t('c2.profiles.profileNameLabel') + ' *', p?.name)}${input('c2-profile-ua', t('c2.profiles.userAgent'), p?.userAgent)}${area('c2-profile-uris', 'labelBeaconUris', (p?.uris || ['/api/v1/status']).join('\n'))}<p class="form-hint">${t('c2.profiles.hintUris')}</p><div class="c2-form-row">${input('c2-profile-jmin', t('c2.profiles.labelJitterMin'), String(p?.jitterMinMs ?? 100), 'number')}${input('c2-profile-jmax', t('c2.profiles.labelJitterMax'), String(p?.jitterMaxMs ?? 500), 'number')}</div>${area('c2-profile-request-headers', 'requestHeaders', JSON.stringify(p?.requestHeaders || {}, null, 2))}${area('c2-profile-headers', 'labelRespHeaders', JSON.stringify(p?.responseHeaders || { Server: 'nginx' }, null, 2))}<p class="form-hint">${t('c2.profiles.hintHeaders')}</p>${area('c2-profile-body', 'bodyTemplate', p?.bodyTemplate || '')}<div id="c2-form-error" class="c2-form-error" role="alert" hidden></div></div><div class="c2-modal-footer">${action('modal-close', t('common.cancel'))}${action('profile-save', t(p ? 'common.save' : 'c2.profiles.submitCreate'), '', 'btn-primary', 'c2:write')}</div>`);
    for (const id of ['c2-profile-jmin', 'c2-profile-jmax']) { const el = element(id); el?.setAttribute('min', '0'); el?.removeAttribute('max'); }
  }
  function mountWorkspaces(): void {
    for (const [id, parent] of [['page-c2-tasks', 'c2-activity-panels'], ['page-c2-events', 'c2-activity-panels'], ['page-c2-profiles', 'c2-listener-panels']]) {
      const panel = element(id!); const host = element(parent!); if (!panel || !host) continue;
      panel.className = 'c2-workspace-panel'; panel.hidden = true; panel.querySelector('h2')?.remove(); host.append(panel);
    }
    for (const kind of ['tasks', 'events']) {
      const filters = doc.querySelector(`#page-c2-${kind} .c2-${kind}-filter-card`);
      if (filters && !element(`c2-${kind}-search`)) filters.insertAdjacentHTML('beforeend', `<label class="c2-page-search">${t('c2.activity.searchPage')}<input id="c2-${kind}-search" type="search" class="form-control" data-input="c2.${kind}-search" placeholder="${t('c2.activity.searchHint')}"></label>`);
    }
    // Associate the incumbent payload labels with their controls; use native select behavior.
    doc.querySelectorAll<HTMLElement>('#page-c2-payloads .c2-form-group').forEach(group => { const control = group.querySelector('input,select,textarea'); const label = group.querySelector('label'); if (control?.id && label) label.htmlFor = control.id; });
  }
  return { element, set, t, action, time, relativeTime, projectOptions, profileOptions, renderListeners, listenerForm, renderSessionToolbar, renderSessions, renderSessionDetail, renderSessionConnection, refreshSessionMetadata, sessionEmpty, renderSessionTasks, renderBreadcrumbs, renderFiles, renderTasks, renderEvents, pagination, taskDetail, eventDetail, renderProfiles, profileForm, mountWorkspaces };
}
export type C2View = ReturnType<typeof createC2View>;
