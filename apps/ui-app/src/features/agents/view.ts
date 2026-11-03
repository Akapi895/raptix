import { dom, errorMessage, escapeHtml as esc } from '../../platform/catalog-browser';
import { AgentValidationError, type AgentsService, type AgentDraft, type MarkdownAgent } from './service';

export interface AgentsDependencies {
  translate(key: string, options?: Record<string, unknown>): string;
  notify(message: string, type: 'success' | 'error'): void;
  allow(permission: string): boolean;
  confirm(message: string): boolean;
  openModal(id: string, options?: { focus?: boolean }): void;
  closeModal(id: string): void;
  deferModalContent(callback: () => void): void;
  afterRender?(root: HTMLElement): void;
}
export function renderAgentCards(agents: readonly MarkdownAgent[], t: AgentsDependencies['translate']): string {
  return agents.length ? agents.map(agent => `<div class="skill-card"><div class="skill-card-header"><h3 class="skill-card-title">${esc(agent.name)}<span class="agent-role-badge agent-role-badge--${agent.is_orchestrator ? 'orchestrator' : 'sub'}">${esc(t(agent.is_orchestrator ? 'agentsPage.badgeOrchestrator' : 'agentsPage.badgeSub'))}</span></h3><div class="skill-card-description"><code>${esc(agent.filename)}</code> · id: <code>${esc(agent.id)}</code><br>${esc(agent.description || t('agentsPage.noDesc'))}</div></div><div class="skill-card-actions"><button type="button" class="btn-secondary btn-small" data-action="edit-agent-md" data-agent-file="${esc(encodeURIComponent(agent.filename))}">${esc(t('common.edit'))}</button><button type="button" class="btn-secondary btn-small btn-danger" data-action="delete-agent-md" data-agent-file="${esc(encodeURIComponent(agent.filename))}">${esc(t('common.delete'))}</button></div></div>`).join('') : `<div class="empty-state">${esc(t('agentsPage.empty'))}</div>`;
}

export function createAgentsView(document: Document, deps: AgentsDependencies, service: AgentsService) {
  const d = dom(document), abort = new AbortController(), t = deps.translate;
  let active = false, disposed = false, modalGeneration = 0;
  function render(): void {
    const state = service.state;
    d.text('agents-md-dir', state.directory ? t('agentsPage.dirLabel') + ': ' + state.directory : '');
    d.html('agents-md-list', state.loading ? `<div class="loading-spinner">${esc(t('agentsPage.loading'))}</div>`
      : state.loadError !== undefined ? `<div class="empty-state">${esc(errorMessage(state.loadError))}</div>` : renderAgentCards(state.agents, t));
    const list = d.el('agents-md-list');
    if (list) deps.afterRender?.(list);
  }
  function fill(agent?: MarkdownAgent): void {
    const fields: Record<string, string> = {
      'filename-current': agent?.filename ?? '', filename: agent?.filename ?? '', role: agent?.is_orchestrator ? 'orchestrator' : 'sub',
      id: agent?.id ?? '', name: agent?.name ?? '', description: agent?.description ?? '', tools: agent?.tools?.join(', ') ?? '',
      'bind-role': agent?.bind_role ?? '', 'max-iter': String(agent?.max_iterations ?? 0), instruction: agent?.instruction ?? '',
    };
    Object.entries(fields).forEach(([key, value]) => d.set('agent-md-' + key, value));
    const filename = d.field('agent-md-filename');
    if (filename) filename.disabled = !!agent;
    d.show('agent-md-filename-row', !agent);
    d.text('agent-md-modal-title', t(agent ? 'agentsPage.editTitle' : 'agentsPage.createTitle'));
  }
  async function loadMarkdownAgents(): Promise<void> {
    if (!d.el('agents-md-list') || disposed) return;
    try { await service.load(); }
    catch (error) { if (!disposed) deps.notify(t('agentsPage.loadFailed') + ': ' + errorMessage(error), 'error'); }
  }
  function showAddMarkdownAgentModal(): void {
    if (disposed || !deps.allow('agents:write')) return;
    modalGeneration++; service.reset(); fill(); deps.openModal('agent-md-modal');
  }
  function closeMarkdownAgentModal(): void {
    modalGeneration++; deps.closeModal('agent-md-modal'); service.reset();
  }
  async function editMarkdownAgent(filename: string): Promise<void> {
    if (!filename || disposed) return;
    const generation = ++modalGeneration;
    fill(); d.show('agent-md-filename-row', false); d.text('agent-md-modal-title', t('agentsPage.editTitle'));
    deps.openModal('agent-md-modal', { focus: false });
    try {
      const agent = await service.edit(filename);
      if (!agent || disposed || generation !== modalGeneration) return;
      deps.deferModalContent(() => {
        if (disposed || generation !== modalGeneration) return;
        fill(agent); d.field('agent-md-name')?.focus();
      });
    } catch (error) {
      if (disposed || generation !== modalGeneration) return;
      closeMarkdownAgentModal(); deps.notify(t('agentsPage.loadOneFailed') + ': ' + errorMessage(error), 'error');
    }
  }
  async function saveMarkdownAgent(): Promise<void> {
    if (disposed || !deps.allow('agents:write')) return;
    const generation = modalGeneration;
    const draft: AgentDraft = {
      filename: d.value('agent-md-filename'), id: d.value('agent-md-id'), name: d.value('agent-md-name'),
      description: d.value('agent-md-description'), tools: d.value('agent-md-tools'), instruction: d.value('agent-md-instruction'),
      bind_role: d.value('agent-md-bind-role'), max_iterations: d.value('agent-md-max-iter'), kind: d.value('agent-md-role'),
    };
    try {
      const edit = !!service.state.editing;
      if (!await service.save(draft) || disposed) return;
      deps.notify(t(edit ? 'agentsPage.saveOk' : 'agentsPage.createOk'), 'success');
      if (generation === modalGeneration) closeMarkdownAgentModal();
      await loadMarkdownAgents();
    } catch (error) {
      if (!disposed) deps.notify(error instanceof AgentValidationError ? t(error.message) : t('agentsPage.saveFailed') + ': ' + errorMessage(error), 'error');
    }
  }
  async function deleteMarkdownAgent(filename: string): Promise<void> {
    if (!filename || disposed || !deps.allow('agents:delete') || !deps.confirm(t('agentsPage.deleteConfirm', { name: filename }))) return;
    try {
      await service.delete(filename);
      if (disposed) return;
      deps.notify(t('agentsPage.deleteOk'), 'success'); await loadMarkdownAgents();
    } catch (error) { if (!disposed) deps.notify(t('agentsPage.deleteFailed') + ': ' + errorMessage(error), 'error'); }
  }
  const api = { loadMarkdownAgents, showAddMarkdownAgentModal, closeMarkdownAgentModal, editMarkdownAgent, saveMarkdownAgent, deleteMarkdownAgent };
  const actions: Record<string, () => void | Promise<void>> = {
    'agents.refresh': loadMarkdownAgents, 'agents.add': showAddMarkdownAgentModal,
    'agents.close': closeMarkdownAgentModal, 'agents.save': saveMarkdownAgent,
  };
  const stop = service.subscribe(render);
  return {
    ...api,
    activate(): void {
      if (active || disposed) return;
      active = true;
      document.addEventListener('click', event => {
        const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
        if (!element || (element instanceof HTMLButtonElement && element.disabled)) return;
        const action = element.dataset.action ?? '';
        if (actions[action]) { event.preventDefault(); void actions[action](); }
        else if ((action === 'edit-agent-md' || action === 'delete-agent-md') && element.closest('#agents-md-list')) {
          const filename = decodeURIComponent(element.dataset.agentFile ?? '');
          void (action === 'edit-agent-md' ? editMarkdownAgent(filename) : deleteMarkdownAgent(filename));
        }
      }, { signal: abort.signal });
      document.addEventListener('languagechange', () => { if (service.state.loading || service.state.agents.length || d.el('agents-md-list')?.children.length) render(); }, { signal: abort.signal });
      d.el('agent-md-modal')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeMarkdownAgentModal(); }, { signal: abort.signal });
    },
    dispose(): void { disposed = true; modalGeneration++; stop(); abort.abort(); service.dispose(); },
  };
}
