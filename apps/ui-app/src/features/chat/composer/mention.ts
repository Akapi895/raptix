// The @-mention suggestions under the chat input: loads the tools for the current role once, filters them while the
// user types after "@", and inserts the chosen one. The pure rules live in mention-model.

import { escapeHtml } from '../../../ui/format';
import { fitTextareaHeight } from './draft';
import { BACKEND_DEFAULT_ROLE } from '@/platform/backend-legacy-strings';
import {
  connectedExternalServers, filterMentionTools, insertMention, mentionAtCaret, mentionToolFromApi,
  type ExternalServerState, type MentionTool,
} from './mention-model';
import type { Translate } from './attachments';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export interface MentionDependencies {
  doc: Document;
  t: Translate;
  request(path: string): Promise<Response>;
  /** The role the tools are listed for; empty or the default role lists every tool. */
  currentRole(): string;
  /** True once after the role changed, so the tool list is fetched again. */
  takeRoleChanged(): boolean;
  input(): HTMLTextAreaElement | null;
  saveDraftDebounced(value: string): void;
}

export interface MentionController {
  /** Hides the list, keeps it from taking focus from the input, and starts loading the tools. */
  setup(): void;
  /** Forgets the loaded tools and loads them again (the role or the tool set changed). */
  refreshTools(): void;
  /** Reads the text before the caret and opens, moves or closes the suggestions. */
  update(textarea: HTMLTextAreaElement | null): void;
  /** Handles a navigation key while the suggestions are open; false when the key is not for them. */
  handleKey(key: string): boolean;
  deactivate(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createMentionController(deps: MentionDependencies): MentionController {
  const { doc, t } = deps;
  let suggestions: HTMLElement | null = null;
  const lifecycle = new AbortController();
  let setup = false;
  let tools: MentionTool[] = [];
  let loaded = false;
  let loading: Promise<MentionTool[]> | null = null;
  let externalNames: string[] = [];
  let filtered: MentionTool[] = [];
  const state = { active: false, startIndex: -1, query: '', selectedIndex: 0 };

  function isOpen(): boolean {
    return state.active && !!suggestions && suggestions.style.display !== 'none';
  }

  async function fetchTools(): Promise<MentionTool[]> {
    const collected: MentionTool[] = [];
    const seen = new Set<string>();
    try {
      const role = deps.currentRole();
      try {
        const response = await deps.request('/api/external-mcp');
        if (response.ok) {
          const data = await response.json() as { servers?: Record<string, ExternalServerState> };
          externalNames = connectedExternalServers(data.servers);
        }
      } catch (error) {
        console.warn('Failed to load external MCP list:', error);
        externalNames = [];
      }

      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= MAX_PAGES) {
        let url = `/api/config/tools?page=${page}&page_size=${PAGE_SIZE}`;
        if (role && role !== BACKEND_DEFAULT_ROLE) url += `&role=${encodeURIComponent(role)}`;
        const response = await deps.request(url);
        if (!response.ok) break;
        const result = await response.json() as { tools?: unknown[]; total_pages?: number };
        const list = Array.isArray(result.tools) ? result.tools : [];
        list.forEach(raw => {
          const tool = mentionToolFromApi(raw as Parameters<typeof mentionToolFromApi>[0]);
          if (!tool || seen.has(tool.toolKey)) return;
          seen.add(tool.toolKey);
          collected.push(tool);
        });
        totalPages = result.total_pages || 1;
        page += 1;
        if (page > totalPages) break;
      }
      tools = collected;
      loaded = true;
    } catch (error) {
      console.warn('Failed to load tools; @-mentions may be unavailable:', error);
    }
    return tools;
  }

  function ensureLoaded(): Promise<MentionTool[]> {
    if (deps.takeRoleChanged()) {
      loaded = false;
      tools = [];
    }
    if (loaded) return Promise.resolve(tools);
    if (loading) return loading;
    loading = fetchTools().finally(() => { loading = null; });
    return loading;
  }

  function hide(): void {
    if (!suggestions) return;
    suggestions.style.display = 'none';
    suggestions.innerHTML = '';
    delete suggestions.dataset.lastMentionQuery;
  }

  function deactivate(): void {
    state.active = false;
    state.startIndex = -1;
    state.query = '';
    state.selectedIndex = 0;
    filtered = [];
    hide();
  }

  function updateCandidates(): void {
    filtered = state.active ? filterMentionTools(tools, externalNames, state.query) : [];
    if (filtered.length === 0 || state.selectedIndex >= filtered.length) state.selectedIndex = 0;
  }

  function itemHtml(tool: MentionTool, index: number): string {
    const active = index === state.selectedIndex ? 'active' : '';
    const enabled = tool.roleEnabled !== undefined ? tool.roleEnabled : tool.enabled;
    const badge = tool.isExternal
      ? '<span class="mention-item-badge">External</span>'
      : '<span class="mention-item-badge internal">Built-in</span>';
    const description = tool.description ? escapeHtml(tool.description) : escapeHtml(t('chat.noDescription', 'No description'));
    const statusLabel = enabled ? 'Available' : (tool.roleEnabled !== undefined ? 'Disabled (this role)' : 'Disabled');
    const originLabel = tool.isExternal
      ? (tool.externalMcp ? `Source: ${escapeHtml(tool.externalMcp)}` : 'Source: external MCP')
      : 'Source: built-in tool';
    return `
      <button type="button" class="mention-item ${active} ${enabled ? '' : 'disabled'}" data-index="${index}">
        <div class="mention-item-name">
          <span class="mention-item-icon">🔧</span>
          <span class="mention-item-text">@${escapeHtml(tool.name)}</span>
          ${badge}
        </div>
        <div class="mention-item-desc">${description}</div>
        <div class="mention-item-meta">
          <span class="mention-status ${enabled ? 'enabled' : 'disabled'}">${statusLabel}</span>
          <span class="mention-origin">${originLabel}</span>
        </div>
      </button>
    `;
  }

  function scrollSelectionIntoView(target: Element | null = null): void {
    if (!suggestions) return;
    const active = target || suggestions.querySelector('.mention-item.active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
  }

  function render({ showLoading = false } = {}): void {
    if (lifecycle.signal.aborted) return;
    if (!suggestions || !state.active) {
      hide();
      return;
    }
    const element = suggestions;
    const currentQuery = state.query || '';
    const existingList = element.querySelector<HTMLElement>('.mention-suggestions-list');
    const keepScroll = !showLoading && !!existingList && element.dataset.lastMentionQuery === currentQuery;
    const previousScrollTop = keepScroll && existingList ? existingList.scrollTop : 0;

    if (showLoading) {
      element.innerHTML = '<div class="mention-empty">' + escapeHtml(t('chat.loadingTools', 'Loading tools...')) + '</div>';
      element.style.display = 'block';
      delete element.dataset.lastMentionQuery;
      return;
    }
    if (!filtered.length) {
      element.innerHTML = '<div class="mention-empty">' + escapeHtml(t('chat.noMatchTools', 'No matching tools')) + '</div>';
      element.style.display = 'block';
      element.dataset.lastMentionQuery = currentQuery;
      return;
    }

    const list = doc.createElement('div');
    list.className = 'mention-suggestions-list';
    list.innerHTML = filtered.map((tool, index) => itemHtml(tool, index)).join('');
    element.innerHTML = '';
    element.appendChild(list);
    element.style.display = 'block';
    element.dataset.lastMentionQuery = currentQuery;
    if (keepScroll) list.scrollTop = previousScrollTop;

    list.querySelectorAll<HTMLElement>('.mention-item').forEach(item => {
      item.addEventListener('mousedown', event => {
        // Keeps the input focused, so the choice is applied before the input loses its caret.
        event.preventDefault();
        const index = parseInt(item.dataset.index ?? '', 10);
        if (!Number.isNaN(index)) state.selectedIndex = index;
        applySelection();
      });
    });
    scrollSelectionIntoView();
  }

  function move(direction: number): void {
    if (!filtered.length) return;
    const max = filtered.length - 1;
    let next = state.selectedIndex + direction;
    if (next < 0) next = max;
    else if (next > max) next = 0;
    state.selectedIndex = next;
    updateActiveHighlight();
  }

  function updateActiveHighlight(): void {
    if (!suggestions) return;
    const items = suggestions.querySelectorAll<HTMLElement>('.mention-item');
    if (!items.length) return;
    items.forEach(item => item.classList.remove('active'));
    if (state.selectedIndex < 0) state.selectedIndex = 0;
    if (state.selectedIndex >= items.length) state.selectedIndex = items.length - 1;
    const active = items[state.selectedIndex];
    if (active) {
      active.classList.add('active');
      scrollSelectionIntoView(active);
    }
  }

  function applySelection(): void {
    const textarea = deps.input();
    if (!textarea || state.startIndex === -1 || !filtered.length) {
      deactivate();
      return;
    }
    const chosen = filtered[state.selectedIndex] || filtered[0];
    if (!chosen) {
      deactivate();
      return;
    }
    const insertion = insertMention(textarea.value, state.startIndex, textarea.selectionStart || 0, chosen.name);
    textarea.value = insertion.value;
    textarea.focus();
    textarea.setSelectionRange(insertion.caret, insertion.caret);
    fitTextareaHeight(textarea);
    deps.saveDraftDebounced(textarea.value);
    deactivate();
  }

  return {
    setup() {
      if (setup || lifecycle.signal.aborted) return;
      setup = true;
      suggestions = doc.getElementById('mention-suggestions');
      if (suggestions) {
        suggestions.style.display = 'none';
        suggestions.addEventListener('mousedown', event => event.preventDefault(), { signal: lifecycle.signal });
      }
      ensureLoaded().catch(() => undefined);
    },
    refreshTools() {
      loaded = false;
      tools = [];
      externalNames = [];
      loading = null;
      if (state.active) ensureLoaded().catch(() => undefined);
    },
    update(textarea) {
      const mention = textarea ? mentionAtCaret(textarea.value.slice(0, textarea.selectionStart || 0)) : null;
      if (!mention) {
        deactivate();
        return;
      }
      state.active = true;
      state.startIndex = mention.startIndex;
      state.query = mention.query;
      state.selectedIndex = 0;
      if (!loaded) {
        render({ showLoading: true });
      } else {
        updateCandidates();
        render();
      }
      ensureLoaded().then(() => {
        if (!state.active) return;
        updateCandidates();
        render();
      }, () => undefined);
    },
    handleKey(key) {
      if (!isOpen()) return false;
      if (key === 'ArrowDown') move(1);
      else if (key === 'ArrowUp') move(-1);
      else if (key === 'Enter' || key === 'Tab') applySelection();
      else if (key === 'Escape') deactivate();
      else return false;
      return true;
    },
    deactivate,
    isOpen,
    dispose() { lifecycle.abort(); deactivate(); suggestions?.replaceChildren(); },
  };
}
