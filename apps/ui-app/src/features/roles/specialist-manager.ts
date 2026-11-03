import type { SpecialistAdditions, SpecialistCapability, SpecialistCatalog, SpecialistConfiguration, SpecialistDescriptor } from '@raptix/web-contracts';
import { escapeAttr, escapeHtml } from '../../ui/format';
import { openCapabilityModal } from '../../ui/capabilities';
import { closeAppModal } from '../../ui/modal';
import type { RequestFn } from './service';
import '../../styles/specialist-manager.css';

type Section = 'overview' | 'skills' | 'tools' | 'mcp';
const empty = (): SpecialistAdditions => ({ skills: [], tools: [], mcp: [] });
const same = (a: SpecialistAdditions, b: SpecialistAdditions): boolean =>
  (['skills', 'tools', 'mcp'] as const).every(k => [...a[k]].sort().join('\n') === [...b[k]].sort().join('\n'));
const SCOPE_CARET = '<svg class="role-form-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The manager owns the specialist card grid and the shared configuration modal. All state is frontend-local. */
export function createSpecialistManager(deps: {
  doc: Document; request: RequestFn; activeProject(): string; projectName(id: string): string;
  confirm(message: string): boolean; onProjectChange(listener: () => void): () => void; setActiveProject(id: string): void;
}) {
  const { doc, request } = deps;
  let root: HTMLElement | null = null;
  let specialists: SpecialistDescriptor[] = [];
  /** Latest known configuration per specialist id; drives the card badges from real saved data. */
  const configurations = new Map<string, SpecialistConfiguration>();
  // Catalogs are role-specific; configuration keys also include the project scope.
  const reads = new Map<string, { expires: number; promise: Promise<unknown> }>();
  let indicatorTimer: ReturnType<typeof setTimeout> | undefined;
  let indicatorVersion = 0;
  let selected = '';
  let scope: 'global' | 'project' = deps.activeProject() ? 'project' : 'global';
  let projectId = '';
  let catalog: SpecialistCatalog | null = null;
  let saved: SpecialistConfiguration | null = null;
  let draft = empty();
  let section: Section = 'overview';
  let busy = false;
  let loadError: string | null = null;
  let sequence = 0;
  let disposed = false;
  let removeProjectListener: (() => void) | undefined;

  const modal = () => doc.getElementById('specialist-modal');
  const modalOpen = () => { const node = modal(); return !!node && node.style.display !== 'none' && node.style.display !== ''; };
  const dirty = () => saved !== null && !same(draft, scope === 'global' ? saved.global : saved.project);
  const discard = () => !dirty() || deps.confirm('Discard unsaved specialist additions?');
  const inSurface = (target: Element): boolean => !!target.closest('#specialists-list, #specialist-modal, #agents-panel-specialists');
  function restoreFocus(selector: string | null): void {
    if (selector === null) return;
    const target = selector ? modal()?.querySelector<HTMLButtonElement>(selector) : null;
    const fallback = modal()?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    (target && !target.disabled ? target : fallback)?.focus({ preventScroll: true });
  }
  const contextQuery = () => scope === 'project' && projectId ? '?project_id=' + encodeURIComponent(projectId) : '';
  const endpoint = (kind: string) => '/api/specialists/' + encodeURIComponent(selected) + '/' + kind;
  const configurationKey = (id: string, project = deps.activeProject()) => id + (project ? '?project_id=' + encodeURIComponent(project) : '');
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await request(path, init);
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(body.error || body.message || `Request failed (${response.status}). Retry after checking the API connection.`);
    }
    return await response.json() as T;
  }
  function cached<T>(path: string): Promise<T> {
    for (const [key, entry] of reads) if (entry.expires <= Date.now()) reads.delete(key);
    const prior = reads.get(path);
    if (prior && prior.expires > Date.now()) return prior.promise as Promise<T>;
    const entry = { expires: Infinity, promise: json<T>(path) };
    reads.set(path, entry);
    void entry.promise.then(() => { entry.expires = Date.now() + 30_000; }, () => { if (reads.get(path) === entry) reads.delete(path); });
    return entry.promise;
  }
  function invalidateConfigurations(): void {
    indicatorVersion++;
    configurations.clear();
    for (const path of reads.keys()) if (path.includes('/configuration')) reads.delete(path);
  }
  function status(text: string, error = false): void {
    const node = modal()?.querySelector<HTMLElement>('[data-specialist-status]');
    if (node) { node.textContent = text; node.setAttribute('role', error ? 'alert' : 'status'); node.classList.toggle('is-error', error); node.hidden = !text; }
  }
  function updateActions(): void {
    const shell = modal();
    if (!shell) return;
    shell.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('button, input, select').forEach(control => {
      if (control.matches('[data-specialist-close], [data-specialist-cancel]')) return;
      if (busy && !control.disabled) { control.dataset.specialistBusyDisabled = 'true'; control.disabled = true; }
      else if (!busy && control.dataset.specialistBusyDisabled) { control.disabled = false; delete control.dataset.specialistBusyDisabled; }
    });
    shell.querySelectorAll<HTMLButtonElement>('[data-specialist-cancel], [data-specialist-close]').forEach(b => { b.disabled = false; });
    const save = shell.querySelector<HTMLButtonElement>('[data-specialist-save]');
    if (save) save.disabled = busy || !dirty();
    const reset = shell.querySelector<HTMLButtonElement>('[data-specialist-reset]');
    if (reset) reset.disabled = busy || !saved || same(draft, empty());
    const state = shell.querySelector('[data-specialist-dirty]');
    if (state) state.textContent = !saved ? busy ? 'Loading configuration' : 'Configuration not loaded'
      : dirty() ? 'Unsaved changes' : `Saved · revision ${saved.revision}`;
    shell.setAttribute('aria-busy', String(busy));
  }

  // ---- specialist cards ----

  function badge(id: string, descriptor?: SpecialistDescriptor, configuration?: SpecialistConfiguration): { text: string; tone: string } | null {
    if (descriptor && descriptor.available === false) return { text: 'Unavailable', tone: 'is-warning' };
    const config = configuration ?? configurations.get(configurationKey(id));
    // No saved record yet: the indicator load is still in flight; show no badge instead of a meaningless label.
    if (!config) return null;
    if (config.status === 'unavailable' || config.diagnostics.length > 0) return { text: 'Needs attention', tone: 'is-warning' };
    const customized = (['skills', 'tools', 'mcp'] as const).some(k => config.global[k].length > 0 || config.project[k].length > 0);
    return customized ? { text: 'Customized', tone: 'is-accent' } : { text: 'Built-in only', tone: 'is-muted' };
  }
  function card(descriptor: SpecialistDescriptor): string {
    const id = escapeAttr(descriptor.id);
    const state = badge(descriptor.id, descriptor);
    const config = configurations.get(configurationKey(descriptor.id));
    const builtins = config
      ? `${config.builtins.tools.length} built-in ${config.builtins.tools.length === 1 ? 'tool' : 'tools'} · ${config.builtins.skills.length} built-in ${config.builtins.skills.length === 1 ? 'skill' : 'skills'}`
      : '';
    return `<button type="button" class="agent-card agent-card-specialist" data-specialist-id="${id}" aria-haspopup="dialog">
      <div class="agent-card-head">
        <div class="agent-card-id">
          <h4 class="agent-card-name">${escapeHtml(descriptor.name)}</h4>
          <p class="agent-card-desc">${escapeHtml(descriptor.description)}</p>
        </div>
        ${state ? `<span class="agent-card-badge ${state.tone}">${escapeHtml(state.text)}</span>` : ''}
      </div>
      <div class="agent-card-meta">${builtins ? `<span class="agent-card-meta-item">${builtins}</span>` : ''}</div>
    </button>`;
  }
  function list(): void {
    if (!root) return;
    const keyword = (doc.getElementById('specialists-search') as HTMLInputElement | null)?.value.trim().toLowerCase() ?? '';
    const filtered = specialists.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(keyword));
    const count = doc.querySelector('[data-specialist-count]');
    if (count) count.textContent = `${filtered.length} of ${specialists.length} specialists`;
    root.innerHTML = filtered.map(card).join('') || '<div class="cap-state" role="status"><strong>No specialists match your search.</strong><p>Adjust the search to see the registered specialists.</p></div>';
  }
  /** Refreshes the configuration badges from the saved configuration API; the grid paints first. */
  async function loadIndicators(): Promise<void> {
    clearTimeout(indicatorTimer);
    if (disposed || modalOpen()) return;
    const project = deps.activeProject();
    const query = project ? '?project_id=' + encodeURIComponent(project) : '';
    const version = indicatorVersion;
    for (const specialist of specialists) {
      if (disposed || modalOpen() || version !== indicatorVersion) return;
      try {
        const configuration = await cached<SpecialistConfiguration>('/api/specialists/' + encodeURIComponent(specialist.id) + '/configuration' + query);
        if (disposed || version !== indicatorVersion) return;
        configurations.set(configurationKey(specialist.id, project), configuration);
      } catch { /* Descriptor badges remain usable; opening the modal offers retry. */ }
    }
    if (!modalOpen()) list();
  }
  const scheduleIndicators = () => { clearTimeout(indicatorTimer); indicatorTimer = setTimeout(() => void loadIndicators(), 150); };

  // ---- modal content ----

  function renderHeader(): void {
    const shell = modal();
    const specialist = specialists.find(s => s.id === selected);
    if (!shell) return;
    const title = shell.querySelector('#specialist-modal-title');
    if (title) title.textContent = specialist?.name ?? 'Specialist configuration';
    const description = shell.querySelector('#specialist-modal-description');
    if (description) description.textContent = specialist?.description ?? 'Manage the additions applied to new runs.';
    const state = shell.querySelector<HTMLElement>('[data-specialist-state]');
    if (state) {
      const badgeState = badge(selected, specialist, saved ?? undefined);
      state.textContent = badgeState?.text ?? '';
      state.className = `agent-card-badge ${badgeState?.tone ?? ''}`;
      state.hidden = !saved || !badgeState;
    }
    skinScopeSelect(shell);
    const scopeSelect = shell.querySelector<HTMLSelectElement>('[data-specialist-scope]');
    if (scopeSelect) {
      const project = shell.querySelector<HTMLOptionElement>('[data-specialist-scope] option[value="project"]');
      if (project) {
        project.disabled = !deps.activeProject();
        project.textContent = deps.activeProject() ? 'Current project: ' + (deps.projectName(deps.activeProject()) || deps.activeProject()) : 'Current project (select a project first)';
      }
      scopeSelect.value = scope;
      syncScopeSkin();
    }
  }

  // ---- scope selector (app select skin; the hidden native select stays the source of truth) ----

  let scopeSkin: { wrapper: HTMLElement; trigger: HTMLButtonElement; dropdown: HTMLElement; select: HTMLSelectElement } | null = null;

  function skinScopeSelect(shell: HTMLElement): void {
    const select = shell.querySelector<HTMLSelectElement>('[data-specialist-scope]');
    if (!select) { scopeSkin = null; return; }
    if (scopeSkin && scopeSkin.select === select) { syncScopeSkin(); return; }
    select.classList.add('specialist-scope-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const wrapper = doc.createElement('div');
    wrapper.className = 'role-form-select-ui specialist-scope-ui';
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'role-form-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-labelledby', 'specialist-scope-label specialist-scope-value');
    trigger.setAttribute('data-specialist-scope-toggle', '');
    trigger.innerHTML = `<span id="specialist-scope-value" class="role-form-select-value"></span>${SCOPE_CARET}`;
    const dropdown = doc.createElement('div');
    dropdown.className = 'role-form-select-dropdown';
    dropdown.setAttribute('role', 'listbox');
    select.parentNode?.insertBefore(wrapper, select);
    wrapper.append(trigger, dropdown, select);
    scopeSkin = { wrapper, trigger, dropdown, select };
    syncScopeSkin();
  }

  function syncScopeSkin(): void {
    if (!scopeSkin) return;
    const { select, dropdown, trigger } = scopeSkin;
    dropdown.innerHTML = Array.from(select.options).map(option => {
      const chosen = option.value === select.value;
      return `<button type="button" class="role-form-select-option${chosen ? ' is-selected' : ''}" role="option" aria-selected="${chosen}" data-specialist-scope-option="${escapeAttr(option.value)}"${option.disabled ? ' disabled' : ''}><span class="role-form-select-check" aria-hidden="true">✓</span><span class="role-form-select-label">${escapeHtml(option.textContent ?? '')}</span></button>`;
    }).join('');
    const value = trigger.querySelector('.role-form-select-value');
    if (value) value.textContent = select.options[select.selectedIndex]?.textContent ?? '';
  }

  function closeScopeDropdown(): void {
    if (!scopeSkin) return;
    scopeSkin.wrapper.classList.remove('open');
    scopeSkin.trigger.setAttribute('aria-expanded', 'false');
  }
  function renderCapabilities(kind: 'skills' | 'tools' | 'mcp', capabilities: SpecialistCapability[], includeMissing = true): string {
    if (!saved || !catalog) return '';
    const inherited = scope === 'project' ? saved.global[kind] : [];
    const builtins = kind === 'mcp' ? [] : catalog.builtins[kind];
    const rows = capabilities.map(c => {
      const builtin = builtins.includes(c.id) || (kind === 'tools' && builtins.includes(c.name));
      const global = inherited.includes(c.id);
      const checked = builtin || global || draft[kind].includes(c.id);
      const owned = draft[kind].includes(c.id);
      const inputId = `capability-${kind}-${encodeURIComponent(c.id)}`;
      const preview = c.description.length > 140 ? c.description.slice(0, 137) + '…' : c.description;
      return `<div class="specialist-capability" data-capability-text="${escapeAttr(`${c.name} ${c.description} ${c.source}`.toLowerCase())}">
        <input id="${escapeAttr(inputId)}" type="checkbox" data-capability-kind="${kind}" value="${escapeAttr(c.id)}" ${checked ? 'checked' : ''} ${builtin || global || (!c.available && !owned) ? 'disabled' : ''}/>
        <div class="specialist-capability-copy"><label for="${escapeAttr(inputId)}"><strong>${escapeHtml(c.name)}</strong></label>
          <details class="specialist-capability-detail"><summary>${escapeHtml(preview || 'View capability details')}</summary><p>${escapeHtml(c.description)}</p>${c.requirements.length ? `<small>Requires: ${escapeHtml(c.requirements.join(', '))}</small>` : ''}</details>
          <small>${c.available ? 'Available' : 'Unavailable'} · <span title="${escapeAttr(c.source)}">${escapeHtml(c.source)}</span></small></div>
        <span class="specialist-origin">${builtin ? 'Built-in' : global ? 'Global addition' : owned ? scope === 'project' ? 'Project addition' : 'Global addition' : 'Optional'}</span>
      </div>`;
    });
    const known = kind === 'mcp' ? catalog.servers.flatMap(s => s.tools) : catalog[kind];
    const missing = includeMissing ? draft[kind].filter(id => !known.some(c => c.id === id)).map(id => `<label class="specialist-capability" data-capability-text="${escapeAttr(id.toLowerCase())}"><input type="checkbox" data-capability-kind="${kind}" value="${escapeAttr(id)}" checked/><span><strong title="${escapeAttr(id)}">${escapeHtml(id)}</strong><span>Unavailable. Uncheck to remove this saved addition.</span></span></label>`) : [];
    return rows.join('') + missing.join('') || '<p class="specialist-empty">No capabilities are available in this catalog.</p>';
  }
  function additionLines(ids: readonly string[], kind: 'skills' | 'tools' | 'mcp'): string {
    if (!ids.length || !catalog) return '<li class="specialist-none">None</li>';
    const named = kind === 'mcp'
      ? new Map(catalog.servers.flatMap(s => s.tools).map(c => [c.id, c.name]))
      : new Map(catalog[kind].map(c => [c.id, c.name]));
    return ids.map(id => `<li>${escapeHtml(named.get(id) ?? id)}${named.has(id) ? '' : ' <small>(unavailable)</small>'}</li>`).join('');
  }
  function additionGroup(title: string, additions: SpecialistAdditions): string {
    const total = additions.skills.length + additions.tools.length + additions.mcp.length;
    return `<details><summary>${escapeHtml(title)} (${total})</summary>
      <h5>Skills</h5><ul>${additionLines(additions.skills, 'skills')}</ul>
      <h5>Tools</h5><ul>${additionLines(additions.tools, 'tools')}</ul>
      <h5>MCP tools</h5><ul>${additionLines(additions.mcp, 'mcp')}</ul>
    </details>`;
  }
  function overviewHtml(): string {
    if (!saved || !catalog) return '';
    const count = (k: keyof SpecialistAdditions) => new Set([...(scope === 'project' ? saved!.global[k] : []), ...draft[k]]).size;
    const scopeLabel = scope === 'project' ? 'this project' : 'global defaults';
    return `<h4>Effective configuration</h4>
      <p class="specialist-help">Built-ins plus additions for ${scopeLabel}. Changes apply to new runs.</p>
      <dl class="specialist-summary">
        <div><dt>Built-in tools</dt><dd>${catalog.builtins.tools.length}</dd></div>
        <div><dt>Built-in skills</dt><dd>${catalog.builtins.skills.length}</dd></div>
        <div><dt>Additional skills</dt><dd>${count('skills')}</dd></div>
        <div><dt>Additional tools</dt><dd>${count('tools')}</dd></div>
        <div><dt>MCP tools</dt><dd>${count('mcp')}</dd></div>
      </dl>
      <p class="specialist-revision"><span>Revision ${saved.revision}</span><span>${saved.status === 'unavailable' ? 'Needs attention before the next run' : 'Ready for new runs'}</span></p>
      ${additionGroup('Global additions', scope === 'global' ? draft : saved.global)}
      ${scope === 'project' ? additionGroup('Project additions', draft) : ''}
      ${catalog.builtins.behavior ? `<details><summary>Default behavior</summary><p class="specialist-help">${escapeHtml(catalog.builtins.behavior)}</p></details>` : ''}
      <details class="specialist-builtin-details"><summary>Built-in tools and skills (${catalog.builtins.tools.length + catalog.builtins.skills.length})</summary>
        <input type="search" data-builtin-filter placeholder="Filter built-ins…" aria-label="Filter built-in tools and skills"/>
        <h5>Tools</h5><ul>${catalog.builtins.tools.map(tool => `<li>${escapeHtml(catalog!.tools.find(c => c.id === tool || c.name === tool)?.name ?? tool)}</li>`).join('') || '<li class="specialist-none">None</li>'}</ul>
        <h5>Skills</h5><ul>${catalog.builtins.skills.map(skill => `<li>${escapeHtml(catalog!.skills.find(c => c.id === skill)?.name ?? skill)}</li>`).join('') || '<li class="specialist-none">None</li>'}</ul>
      </details>
      <details><summary>When is a capability active?</summary><p>Saved additions are checked again when a new run is assembled. Loaded capabilities and configuration revisions are recorded in that run. Existing executions keep their original snapshot. Availability does not grant execution permission.</p></details>`;
  }
  function content(): void {
    const panel = modal()?.querySelector<HTMLElement>('[data-specialist-content]');
    if (!panel) return;
    modal()?.querySelectorAll<HTMLButtonElement>('[data-specialist-section]').forEach(b => {
      const active = b.dataset.specialistSection === section;
      b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', 'specialist-tab-' + section);
    if (loadError) { panel.innerHTML = `<div class="cap-state cap-state-error" role="alert"><strong>${escapeHtml(loadError)}</strong><p>The catalog and saved configuration could not be loaded.</p><button class="btn-secondary" type="button" data-specialist-reload>Retry</button></div>`; updateActions(); return; }
    if (!saved || !catalog) { panel.innerHTML = '<div class="specialist-skeleton" role="status"><span class="cap-sr-only">Loading configuration and capabilities</span><div class="specialist-skeleton-heading"></div><div class="specialist-skeleton-line"></div><div class="specialist-skeleton-summary"></div><div class="specialist-skeleton-row"></div><div class="specialist-skeleton-row"></div><div class="specialist-skeleton-row"></div></div>'; updateActions(); return; }
    if (section === 'overview') {
      panel.innerHTML = overviewHtml();
    } else {
      const title = section === 'mcp' ? 'MCP tools' : section === 'tools' ? 'Integrated tools' : 'Skills';
      const rows = section === 'mcp'
        ? catalog.servers.map(s => `<details open><summary>${escapeHtml(s.name)} <span class="specialist-origin">${escapeHtml(s.status)}</span></summary>${s.error ? `<p class="specialist-error">${escapeHtml(s.error)}</p>` : ''}${renderCapabilities('mcp', s.tools, false)}</details>`).join('')
          + (!catalog.servers.length ? '<p class="specialist-empty">No MCP servers are configured in the runtime. Configure RAPTIX_MCP__SERVERS on the backend, then refresh this catalog.</p>' : '')
          + renderCapabilities('mcp', []).replace('<p class="specialist-empty">No capabilities are available in this catalog.</p>', '')
        : (() => {
          const kind = section === 'skills' ? 'skills' : 'tools';
          const builtin = (c: SpecialistCapability) => catalog!.builtins[kind].includes(c.id) || (kind === 'tools' && catalog!.builtins.tools.includes(c.name));
          const fixed = catalog[kind].filter(builtin);
          const otherBuiltins = catalog.builtins[kind].filter(id => !fixed.some(c => c.id === id || c.name === id));
          return `<details data-specialist-builtins><summary>Built-in ${kind} (${catalog.builtins[kind].length}) · always enabled</summary>${fixed.length ? renderCapabilities(kind, fixed, false) : ''}<ul>${otherBuiltins.map(id => `<li data-capability-text="${escapeAttr(id.toLowerCase())}">${escapeHtml(id)}</li>`).join('')}</ul></details>${renderCapabilities(kind, catalog[kind].filter(c => !builtin(c)))}`;
        })();
      panel.innerHTML = `
        <div class="specialist-catalog-header"><h4>${title}</h4>
          <label class="cap-sr-only" for="specialist-capability-search">Search ${title.toLowerCase()}</label>
          <input id="specialist-capability-search" type="search" data-specialist-capability-search placeholder="Search ${title.toLowerCase()}…"/>
        </div>
        <p class="specialist-help">${section === 'skills' ? 'Skills add knowledge. Required binaries and execution permissions are checked separately.' : section === 'tools' ? 'Registered tools only. Built-in tools remain enabled.' : 'Choose individual tools from runtime-configured servers. No server is attached automatically.'}</p>
        <p data-specialist-no-results class="specialist-empty" hidden>No capabilities match your search.</p>
        <div class="specialist-capabilities">${rows}</div>`;
    }
    updateActions();
  }

  // ---- open / close / save ----

  async function openSpecialist(id: string, keepSection = false): Promise<void> {
    const shell = modal();
    if (!shell) return;
    const epoch = ++sequence;
    clearTimeout(indicatorTimer);
    selected = id; projectId = scope === 'project' ? deps.activeProject() : '';
    if (!keepSection) section = 'overview';
    busy = true; saved = null; catalog = null; draft = empty(); loadError = null;
    openCapabilityModal(shell, { display: 'flex', focus: false });
    renderHeader(); content(); updateActions();
    status('');
    try {
      const [nextCatalog, configuration] = await Promise.all([cached<SpecialistCatalog>(endpoint('catalog')), cached<SpecialistConfiguration>(endpoint('configuration') + contextQuery())]);
      if (disposed || sequence !== epoch || !modalOpen()) return;
      catalog = nextCatalog; saved = configuration; draft = structuredClone(scope === 'global' ? saved.global : saved.project);
      configurations.set(configurationKey(id, projectId), configuration);
    } catch (error) {
      if (disposed || sequence !== epoch || !modalOpen()) return;
      busy = false; loadError = (error as Error).message; renderHeader(); content(); updateActions(); status(loadError, true); return;
    }
    busy = false; renderHeader(); content(); updateActions(); list();
    if (!shell.contains(doc.activeElement) || (doc.activeElement as HTMLElement | null)?.matches('[aria-hidden="true"], :disabled')) restoreFocus('[data-specialist-scope-toggle]');
    if (saved?.diagnostics.length) status(`${saved.diagnostics.length} saved addition(s) are unavailable. Review Skills, Tools and MCP to restore or remove them before starting a new run.`, true);
    else status('');
  }
  function requestClose(): void {
    if (!modalOpen()) return;
    if (!discard()) return;
    const closingId = selected;
    sequence++; selected = ''; saved = null; catalog = null; draft = empty(); loadError = null; busy = false;
    const shell = modal(); if (shell) shell.removeAttribute('aria-busy');
    closeScopeDropdown();
    closeAppModal('specialist-modal');
    const card = [...(root?.querySelectorAll<HTMLButtonElement>('[data-specialist-id]') ?? [])].find(node => node.dataset.specialistId === closingId);
    card?.focus({ preventScroll: true });
    scheduleIndicators();
  }
  async function save(): Promise<void> {
    if (!saved || busy || !modalOpen()) return;
    const epoch = sequence;
    busy = true; updateActions(); status('Validating selected capabilities and saving…');
    try {
      const configuration = await json<SpecialistConfiguration>(endpoint('configuration') + contextQuery(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, additions: draft }) });
      invalidateConfigurations();
      if (disposed || epoch !== sequence || !modalOpen()) return;
      saved = configuration; configurations.set(configurationKey(selected, projectId), configuration); draft = structuredClone(scope === 'global' ? saved.global : saved.project);
      reads.set(endpoint('configuration') + contextQuery(), { expires: Date.now() + 30_000, promise: Promise.resolve(configuration) });
      busy = false; renderHeader(); content(); updateActions(); list();
      status('Saved. New runs will use this configuration; existing runs are unchanged.');
      // The rendered rows were replaced; put focus back on the active tab of the section being edited.
      restoreFocus('');
    } catch (error) {
      invalidateConfigurations();
      if (!disposed && epoch === sequence && modalOpen()) { busy = false; updateActions(); status((error as Error).message, true); }
    }
  }

  // ---- events ----

  function click(event: Event): void {
    const target = event.target as Element;
    if (!inSurface(target)) return;
    if (target.id === 'specialist-modal') { requestClose(); return; }
    const element = target.closest<HTMLElement>('button, [data-action]');
    if (!element) return;
    if (element.hasAttribute('data-specialist-scope-toggle')) {
      if (!scopeSkin) return;
      const open = scopeSkin.wrapper.classList.contains('open');
      closeScopeDropdown();
      if (!open) { scopeSkin.wrapper.classList.add('open'); scopeSkin.trigger.setAttribute('aria-expanded', 'true'); }
      return;
    }
    if (element.hasAttribute('data-specialist-scope-option')) {
      if (!scopeSkin || element.hasAttribute('disabled')) return;
      const select = scopeSkin.select;
      const value = element.getAttribute('data-specialist-scope-option') ?? '';
      closeScopeDropdown();
      if (select.value !== value) { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    if (!element.closest('.specialist-scope-ui')) closeScopeDropdown();
    if (element.classList.contains('agent-card-specialist') && element.dataset.specialistId) { void openSpecialist(element.dataset.specialistId); return; }
    if (element.hasAttribute('data-specialist-close')) { requestClose(); return; }
    if (element.hasAttribute('data-specialist-cancel')) { requestClose(); return; }
    if (busy) return;
    if (element.dataset.specialistSection) { section = element.dataset.specialistSection as Section; content(); return; }
    if (element.hasAttribute('data-specialist-save')) void save();
    if (element.hasAttribute('data-specialist-reload')) {
      if (!discard()) return;
      reads.clear(); invalidateConfigurations();
      if (modalOpen()) void openSpecialist(selected, true);
      else void load();
    }
    if (element.hasAttribute('data-specialist-reset') && saved) {
      if (!deps.confirm(`Reset additions for ${scope === 'global' ? 'global defaults' : 'the current project'}? Built-in capabilities and inherited additions are kept. Save to apply.`)) return;
      draft = empty(); content(); status('Additions reset in the editor. Save to apply.');
    }
  }
  function input(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!inSurface(target)) return;
    if (target.hasAttribute('data-specialist-search')) list();
    if (target.hasAttribute('data-specialist-capability-search')) {
      let visible = 0;
      modal()?.querySelectorAll<HTMLElement>('[data-capability-text]').forEach(row => { row.hidden = !row.dataset.capabilityText!.includes(target.value.toLowerCase()); if (!row.hidden) visible++; });
      const builtins = modal()?.querySelector<HTMLDetailsElement>('[data-specialist-builtins]');
      if (builtins) builtins.open = target.value.trim().length > 0;
      const hint = modal()?.querySelector<HTMLElement>('[data-specialist-no-results]'); if (hint) hint.hidden = visible > 0;
    }
    if (target.hasAttribute('data-builtin-filter')) {
      const needle = target.value.toLowerCase();
      modal()?.querySelectorAll<HTMLElement>('.specialist-builtin-details li').forEach(item => { item.hidden = needle !== '' && !item.textContent!.toLowerCase().includes(needle); });
    }
  }
  function change(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (busy || !inSurface(target)) return;
    if (target.hasAttribute('data-specialist-scope')) {
      if (!discard()) { target.value = scope; syncScopeSkin(); return; }
      closeScopeDropdown();
      scope = target.value as typeof scope; void openSpecialist(selected, true);
      return;
    }
    if (target.dataset.capabilityKind) {
      const kind = target.dataset.capabilityKind as keyof SpecialistAdditions;
      draft[kind] = target.checked ? [...new Set([...draft[kind], target.value])] : draft[kind].filter(id => id !== target.value);
      const origin = target.closest('.specialist-capability')?.querySelector('.specialist-origin');
      if (origin) origin.textContent = target.checked ? scope === 'project' ? 'Project addition' : 'Global addition' : 'Optional';
      updateActions();
    }
  }
  function keydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (scopeSkin?.wrapper.contains(target)) {
      const open = scopeSkin.wrapper.classList.contains('open');
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopImmediatePropagation(); closeScopeDropdown(); scopeSkin.trigger.focus(); return;
      }
      if (event.key === 'Tab') closeScopeDropdown();
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        scopeSkin.wrapper.classList.add('open'); scopeSkin.trigger.setAttribute('aria-expanded', 'true');
        const options = [...scopeSkin.dropdown.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = options.indexOf(target as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
        options[index]?.focus(); return;
      }
    }
    if (target.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (!target.closest('#specialist-modal')) return;
    event.preventDefault();
    const tabs = [...modal()!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(target as HTMLButtonElement) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index]?.click(); tabs[index]?.focus();
  }
  function beforeUnload(event: BeforeUnloadEvent): void { if (dirty()) { event.preventDefault(); event.returnValue = ''; } }
  function refreshOnFocus(): void { reads.clear(); invalidateConfigurations(); }
  function navigation(event: Event): void {
    if (!dirty()) return;
    const target = event.target as Element;
    if (!target.closest('#main-sidebar [data-page], a[href^="#"]')) return;
    if (!discard()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    draft = structuredClone(scope === 'global' ? saved!.global : saved!.project); content();
  }

  // ---- lifecycle ----

  async function load(): Promise<void> {
    if (disposed) return;
    if (!root) {
      scope = deps.activeProject() ? 'project' : 'global';
      root = doc.getElementById('specialists-list');
      doc.addEventListener('click', click); doc.addEventListener('input', input); doc.addEventListener('change', change); doc.addEventListener('keydown', keydown, true);
      doc.addEventListener('click', navigation, true); doc.defaultView?.addEventListener('beforeunload', beforeUnload);
      doc.defaultView?.addEventListener('focus', refreshOnFocus);
      removeProjectListener = deps.onProjectChange(() => {
        const option = modal()?.querySelector<HTMLOptionElement>('[data-specialist-scope] option[value="project"]');
        if (option) { option.disabled = !deps.activeProject(); option.textContent = deps.activeProject() ? 'Current project: ' + (deps.projectName(deps.activeProject()) || deps.activeProject()) : 'Current project (select a project first)'; }
        indicatorVersion++;
        if (scope !== 'project') { renderHeader(); if (!modalOpen()) scheduleIndicators(); return; }
        if (projectId === deps.activeProject()) return;
        if (!discard()) { deps.setActiveProject(projectId); return; }
        sequence++; saved = null; draft = empty();
        if (!deps.activeProject()) scope = 'global';
        if (selected) void openSpecialist(selected, true);
        else { list(); scheduleIndicators(); }
      });
    }
    if (busy) return;
    const searchInput = doc.getElementById('specialists-search') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    try {
      const response = await json<{ specialists: SpecialistDescriptor[] }>('/api/specialists');
      if (disposed) return;
      specialists = response.specialists;
      if (!specialists.length) {
        if (root) root.innerHTML = '<div class="cap-state" role="status"><strong>No specialists are registered.</strong><p>Enable a runtime agent bundle, then refresh this page.</p><button class="btn-secondary" data-specialist-reload>Refresh</button></div>';
        return;
      }
      list();
      scheduleIndicators();
    } catch (error) {
      if (root) root.innerHTML = `<div class="cap-state cap-state-error" role="alert"><strong>${escapeHtml((error as Error).message)}</strong></div><button class="btn-secondary" data-specialist-reload>Retry</button>`;
    }
  }
  return { load, dispose(): void {
    disposed = true; sequence++; removeProjectListener?.(); clearTimeout(indicatorTimer); reads.clear();
    doc.removeEventListener('click', click); doc.removeEventListener('input', input); doc.removeEventListener('change', change); doc.removeEventListener('keydown', keydown, true);
    doc.removeEventListener('click', navigation, true); doc.defaultView?.removeEventListener('beforeunload', beforeUnload);
    doc.defaultView?.removeEventListener('focus', refreshOnFocus);
  } };
}
