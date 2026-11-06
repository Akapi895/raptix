// The workspace panel of the chat page: the agents of the open conversation and the plan it is following.
// The panel reads the conversation from the URL hash. It also resets the composer's conversation mode and role to their defaults.

import { specialistLabel } from '../agent-labels';
import { executionAgents, type ExecutionMessage, type ExecutionAgent } from './execution';
import { createExecutionHistory } from './execution-history';

export type WorkspaceTab = 'agents' | 'progress';

const PANEL_ID = 'csai-ws-panel';
const TAB_KEY = 'csai.wsp.tab';
const COLLAPSED_KEY = 'csai.wsp.collapsed';
const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'progress', label: 'Progress' },
];
const REFRESH_MS = 3000;
const WATCH_MS = 1000;
const SETUP_TRIES = 120;

interface RunningTask {
  conversationId?: string;
  title?: string;
  status?: string;
}

interface PlanTask {
  id?: string;
  subject?: string;
  status?: string;
  activeForm?: string;
  blockedBy?: string[];
}

export interface WorkspacePorts {
  doc: Document;
  /** Reads a JSON endpoint; a failed status throws. */
  getJson(path: string): Promise<unknown>;
  downloadFile(path: string, name: string): Promise<void>;
  hash(): string;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  currentPage(): string | undefined;
  currentRole?(): string | null | undefined;
  selectRole?(role: string): void;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(handle: number): void;
  now(): number;
  /** Whether the chat page is laid out and the app is ready for the panel. */
  ready(): boolean;
  layout(): HTMLElement | null;
  hidden(): boolean;
}

function el(doc: Document, tag: string, cls?: string, text?: unknown): HTMLElement {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
}

function pill(doc: Document, text: unknown, tone?: string): HTMLElement {
  return el(doc, 'span', 'csai-wsp-pill' + (tone ? ' is-' + tone : ''), text);
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** The conversation id of the chat hash; the hash is the source of truth. */
export function conversationFromHash(hash: string): string {
  if (hash.split('?')[0] !== '#chat') return '';
  const query = new URLSearchParams(hash.split('?').slice(1).join('?'));
  return query.get('conversation') || '';
}

function taskTone(status: string | undefined): [string, string] {
  if (status === 'completed') return ['done', 'ok'];
  if (status === 'in_progress') return ['running', 'run'];
  if (status === 'blocked') return ['blocked', 'warn'];
  return [status || 'pending', ''];
}

/** Starts the workspace. Returns a disposer that stops its timers and removes the panel. */
export function startChatWorkspace(ports: WorkspacePorts): () => void {
  const { doc } = ports;
  const state = {
    tab: 'agents' as WorkspaceTab,
    collapsed: false,
    convId: '',
    token: 0,
    lastFetchAt: 0,
    closedAgents: new Set<string>(),
    agentSignature: '',
  };
  let mounted = false;
  let stopped = false;
  const timers: number[] = [];

  const bodyEl = () => doc.getElementById(PANEL_ID + '-body');
  const soft = <T>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => fallback);
  const apiGet = (url: string) => ports.getJson(url);
  const executionHistory = createExecutionHistory(apiGet);

  function section(label: string, count: number | string | null): HTMLElement {
    const s = el(doc, 'div', 'csai-wsp-section');
    const head = el(doc, 'div', 'csai-wsp-section-head');
    head.appendChild(el(doc, 'span', '', label));
    if (count != null) head.appendChild(el(doc, 'span', 'csai-wsp-count', count));
    s.appendChild(head);
    return s;
  }

  const emptyNote = (text: string, title?: string) => {
    const note = el(doc, 'div', 'csai-wsp-empty');
    if (title) note.appendChild(el(doc, 'strong', '', title));
    note.appendChild(el(doc, 'p', '', text));
    return note;
  };

  function showError(err: unknown): void {
    const body = bodyEl();
    if (!body) return;
    state.agentSignature = '';
    clear(body);
    const message = err && (err as Error).message ? (err as Error).message : 'unknown error';
    body.setAttribute('aria-busy', 'false');
    body.appendChild(emptyNote('Could not load this view: ' + message + '. Select the tab to retry.', 'Workspace unavailable'));
  }

  function renderEmpty(): void {
    const body = bodyEl();
    if (!body) return;
    clear(body);
    body.setAttribute('aria-busy', 'false');
    const notes = {
      agents: ['No active conversation', 'Start a task or choose a conversation above to inspect agent activity.'],
      progress: ['No plan to display', 'Task steps and completion status appear here once a conversation has a plan.'],
    };
    const [title, text] = notes[state.tab];
    body.appendChild(emptyNote(text!, title));
  }

  // ---- panel construction ----
  function applyChrome(): void {
    const panel = doc.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.toggle('is-collapsed', state.collapsed);
    const toggle = panel.querySelector('.csai-wsp-toggle');
    if (toggle) {
      toggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
      toggle.setAttribute('aria-expanded', String(!state.collapsed));
      toggle.setAttribute('aria-label', state.collapsed ? 'Expand workspace' : 'Collapse workspace');
    }
    panel.querySelectorAll<HTMLElement>('.csai-wsp-tab').forEach(button => {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    bodyEl()?.setAttribute('aria-labelledby', PANEL_ID + '-tab-' + state.tab);
  }

  function setCollapsed(value: boolean): void {
    state.collapsed = value;
    ports.storage.set(COLLAPSED_KEY, state.collapsed ? '1' : '0');
    applyChrome();
    if (!state.collapsed) renderTab(true);
  }

  // Clicking the active tab also refreshes it: the user expects a click to show live data.
  function setTab(id: WorkspaceTab): void {
    state.tab = id;
    ports.storage.set(TAB_KEY, id);
    applyChrome();
    renderTab(true);
  }

  function mount(): boolean {
    const layout = ports.layout();
    if (!layout) return false;
    if (doc.getElementById(PANEL_ID)) return true;

    const panel = el(doc, 'aside', 'csai-wsp');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Workspace');

    const head = el(doc, 'div', 'csai-wsp-head');
    const toggle = el(doc, 'button', 'csai-wsp-toggle', '›');
    (toggle as HTMLButtonElement).type = 'button';
    toggle.title = 'Collapse / expand';
    toggle.setAttribute('aria-label', 'Collapse or expand the workspace panel');
    toggle.addEventListener('click', () => setCollapsed(!state.collapsed));
    head.appendChild(el(doc, 'div', 'csai-wsp-title', 'Workspace'));
    const files = el(doc, 'a', 'csai-wsp-files-link', 'Files') as HTMLAnchorElement;
    files.href = '#files';
    files.title = 'Open conversation files in Files';
    files.addEventListener('click', () => { const id = conversationFromHash(ports.hash()); files.href = '#files' + (id ? '?conversation=' + encodeURIComponent(id) : ''); });
    head.appendChild(files);
    head.appendChild(toggle);

    const tabs = el(doc, 'div', 'csai-wsp-tabs');
    tabs.setAttribute('role', 'tablist');
    TABS.forEach(tab => {
      const button = el(doc, 'button', 'csai-wsp-tab', tab.label) as HTMLButtonElement;
      button.type = 'button';
      button.id = PANEL_ID + '-tab-' + tab.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', PANEL_ID + '-body');
      button.dataset.tab = tab.id;
      button.addEventListener('click', () => setTab(tab.id));
      button.addEventListener('keydown', event => {
        const index = TABS.findIndex(item => item.id === state.tab);
        const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        const target = TABS[next]!;
        setTab(target.id);
        doc.getElementById(PANEL_ID + '-tab-' + target.id)?.focus();
      });
      tabs.appendChild(button);
    });

    const body = el(doc, 'div', 'csai-wsp-body');
    body.id = PANEL_ID + '-body';
    body.setAttribute('role', 'tabpanel');
    body.tabIndex = 0;

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(body);
    layout.appendChild(panel);

    state.collapsed = ports.storage.get(COLLAPSED_KEY) === '1';
    const saved = ports.storage.get(TAB_KEY) || 'agents';
    state.tab = TABS.some(tab => tab.id === saved) ? (saved as WorkspaceTab) : 'agents';
    applyChrome();
    return true;
  }

  // ---- agents ----
  function renderAgents(conversationId: string, token: number): void {
    Promise.all([
      apiGet('/api/conversations/' + encodeURIComponent(conversationId)) as Promise<{ messages?: ExecutionMessage[] }>,
      soft(apiGet('/api/agent-loop/tasks') as Promise<{ tasks?: RunningTask[] } | null>, null),
    ]).then(async ([conversation, tasksResponse]) => {
      if (token !== state.token) return;
      const active = tasksResponse ? (tasksResponse.tasks || []).some(task => task.conversationId === conversationId && ['running', 'cancelling'].includes(task.status || '')) : null;
      const messages = await executionHistory.hydrate(conversationId, conversation.messages || [], active, () => token === state.token);
      if (token !== state.token) return;
      const agents = executionAgents(messages, active);
      const body = bodyEl();
      if (!body) return;
      body.setAttribute('aria-busy', 'false');
      const signature = JSON.stringify(agents);
      if (signature === state.agentSignature && body.childElementCount) return;
      state.agentSignature = signature;
      const focused = doc.activeElement instanceof HTMLElement ? doc.activeElement.dataset.agentId : undefined;
      const scrollTop = body.scrollTop;
      clear(body);
      if (!agents.length) {
        body.appendChild(emptyNote('Agents appear here when execution records identify them. No agent execution has been recorded for this conversation.', 'No recorded agents'));
        return;
      }
      const tree = el(doc, 'div', 'csai-wsp-execution');
      tree.setAttribute('aria-label', 'Agent execution');
      const children = new Map<string | undefined, ExecutionAgent[]>();
      agents.forEach(agent => { const list = children.get(agent.parentId) || []; list.push(agent); children.set(agent.parentId, list); });
      const visited = new Set<string>();
      const append = (agent: ExecutionAgent, host: HTMLElement) => {
        if (visited.has(agent.id)) return;
        visited.add(agent.id);
        const descendants = children.get(agent.id) || [];
        const branch = el(doc, descendants.length ? 'details' : 'div', 'csai-wsp-branch') as HTMLDetailsElement;
        const row = el(doc, descendants.length ? 'summary' : 'div', 'csai-wsp-agent-row');
        row.dataset.agentId = agent.id;
        const agentLabel = specialistLabel(agent.name);
        row.title = agentLabel;
        row.appendChild(el(doc, 'span', 'csai-wsp-agent-name', agentLabel));
        const status = el(doc, 'span', 'csai-wsp-agent-status is-' + agent.status);
        const label = agent.status === 'unknown' ? 'Status unavailable' : agent.status[0]!.toUpperCase() + agent.status.slice(1);
        status.setAttribute('role', 'img');
        status.setAttribute('aria-label', label);
        status.title = label;
        row.appendChild(status);
        branch.appendChild(row);
        if (descendants.length) {
          branch.open = !state.closedAgents.has(agent.id);
          branch.addEventListener('toggle', () => { if (branch.open) state.closedAgents.delete(agent.id); else state.closedAgents.add(agent.id); });
          const group = el(doc, 'div', 'csai-wsp-agent-children');
          descendants.forEach(child => append(child, group));
          branch.appendChild(group);
        }
        host.appendChild(branch);
      };
      (children.get(undefined) || []).forEach(agent => append(agent, tree));
      body.appendChild(tree);
      if (agents.some(agent => agent.status === 'unknown')) body.appendChild(el(doc, 'p', 'csai-wsp-status-note', 'Gray: pending or status not recorded. Hover a status icon for details.'));
      body.scrollTop = scrollTop;
      if (focused) [...body.querySelectorAll<HTMLElement>('[data-agent-id]')].find(row => row.dataset.agentId === focused)?.focus();
    }).catch(error => {
      if (token === state.token) showError(error);
    });
  }

  // ---- progress ----
  function renderProgress(conversationId: string, token: number): void {
    (apiGet('/api/conversations/' + encodeURIComponent(conversationId) + '/plan-tasks') as Promise<{ tasks?: PlanTask[]; total?: number; completed?: number } | null>)
      .then(data => {
        if (token !== state.token) return;
        const tasks = (data && data.tasks) || [];
        const body = bodyEl();
        if (!body) return;
        clear(body);
        body.setAttribute('aria-busy', 'false');
        if (!tasks.length) {
          body.appendChild(emptyNote('Plan steps appear here when the agent creates a plan for this conversation.', 'No active plan'));
          return;
        }
        const total = data?.total || tasks.length;
        const done = data?.completed || tasks.filter(task => task.status === 'completed').length;
        const summary = section('Plan', done + ' / ' + total + ' done');
        const bar = el(doc, 'div', 'csai-wsp-bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', 'Plan completion');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(total));
        bar.setAttribute('aria-valuenow', String(done));
        const fill = el(doc, 'i');
        fill.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
        bar.appendChild(fill);
        summary.appendChild(bar);
        body.appendChild(summary);

        const list = section('Tasks', tasks.length);
        tasks.forEach(task => {
          const card = el(doc, 'div', 'csai-wsp-card');
          const title = el(doc, 'div', 'csai-wsp-card-title');
          title.appendChild(el(doc, 'span', '', task.subject || task.id));
          const [label, tone] = taskTone(task.status);
          title.appendChild(pill(doc, label, tone));
          card.appendChild(title);
          if (task.status === 'in_progress' && task.activeForm) card.appendChild(el(doc, 'div', 'csai-wsp-meta', task.activeForm));
          if (task.blockedBy && task.blockedBy.length) card.appendChild(el(doc, 'div', 'csai-wsp-meta', 'blocked by ' + task.blockedBy.join(', ')));
          list.appendChild(card);
        });
        body.appendChild(list);
      })
      .catch(error => {
        if (token === state.token) showError(error);
      });
  }

  /** Renders the active tab for the open conversation. `force` ignores the refresh throttle (tab switch, conversation change). */
  function renderTab(force: boolean): void {
    const conversationId = conversationFromHash(ports.hash());
    if (!conversationId) {
      state.convId = '';
      state.token += 1;
      renderEmpty();
      return;
    }
    if (!force && conversationId === state.convId && ports.now() - state.lastFetchAt < REFRESH_MS) return;
    const changed = conversationId !== state.convId;
    state.convId = conversationId;
    state.lastFetchAt = ports.now();
    state.token += 1;
    const token = state.token;
    if (state.collapsed) return;
    const body = bodyEl();
    if (body && (force || changed)) {
      state.agentSignature = '';
      if (changed) { state.closedAgents.clear(); executionHistory.clear(); }
      clear(body);
      body.setAttribute('aria-busy', 'true');
      const loading = emptyNote('Fetching conversation ' + state.tab + '…', 'Loading workspace');
      loading.setAttribute('role', 'status');
      body.appendChild(loading);
    }
    if (state.tab === 'agents') renderAgents(conversationId, token);
    else renderProgress(conversationId, token);
  }

  // ---- composer role defaults ----
  function resetComposerChoices(): void {
    try {
      if (ports.currentRole && ports.currentRole() && ports.selectRole) ports.selectRole('');
    } catch { /* the role picker is optional */ }
  }

  let tries = 0;
  const boot = ports.setInterval(() => {
    tries += 1;
    if (ports.ready() && mount()) {
      mounted = true;
      resetComposerChoices();
      renderTab(true);
      ports.clearInterval(boot);
    } else if (tries > SETUP_TRIES) {
      ports.clearInterval(boot);
    }
  }, 250);
  timers.push(boot);

  // The conversation changes with a replaced hash, which fires no event: the panel is refreshed on a slow timer while the chat page is shown.
  timers.push(ports.setInterval(() => {
    if (!mounted || stopped) return;
    if (ports.currentPage() !== 'chat' || ports.hidden()) return;
    const conversationId = conversationFromHash(ports.hash());
    if (conversationId !== state.convId) renderTab(true);
    else if (conversationId) renderTab(false);
  }, WATCH_MS));

  return () => {
    stopped = true;
    state.token += 1;
    timers.forEach(timer => ports.clearInterval(timer));
    doc.getElementById(PANEL_ID)?.remove();
  };
}
