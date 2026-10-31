import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageLifecycle, type PageLifecycleDependencies } from './page-lifecycle';
import type { PageId } from './service';

const root = { getElementById: () => null, querySelector: () => null } as unknown as Document;
const route = (page: PageId) => ({ page, query: new URLSearchParams() });
afterEach(() => vi.useRealTimers());

describe('page lifecycle orchestration', () => {
  it('preserves all legacy domain entry hooks and cleanup boundaries', () => {
    const log: string[] = [];
    const hook = (name: string) => () => { log.push(name); };
    const deps: PageLifecycleDependencies = {
      onError: vi.fn(), stopExternalMcpPoll: hook('stop-external'), cleanupTasksPage: hook('cleanup-tasks'),
      stopTokenUsageRequests: hook('stop-token'),
      refreshDashboard: hook('dashboard'), prefetchProjectsForChat: hook('prefetch'), refreshChatProjectSelector: hook('selector'),
      loadToolGuardConfig: hook('tool-guard'), refreshHitlActivePanel: hook('hitl-active'), refreshHitlPending: hook('hitl-fallback'),
      initInfoCollectPage: hook('collect'), loadAssetOverview: hook('overview'), loadAssets: hook('assets'), initTasksPage: hook('tasks'),
      refreshMonitorPanel: hook('monitor'), startMonitorPoll: hook('monitor-poll'), initProjectsPage: hook('projects'),
      initVulnerabilityPage: hook('vulns'), initWebshellPage: hook('webshell'), initChatFilesPage: hook('files'),
      refreshWorkflows: hook('workflows'), loadSkillsMonitor: hook('skills-monitor'),
      initSkillsPagination: hook('skills-pages'), loadSkills: hook('skills'),
      loadKnowledgeCategories: hook('categories'), loadKnowledgePage: hook('knowledge'), updateIndexProgress: hook('index'), loadRetrievalLogs: hook('retrieval'),
      initC2: page => { log.push(page); },
    };
    const lifecycle = createPageLifecycle(root, deps);
    const cases: [PageId, string[]][] = [
      ['dashboard', ['dashboard']], ['chat', ['prefetch', 'selector']], ['tool-guard', ['tool-guard']], ['hitl', ['hitl-active']],
      ['info-collect', ['collect']], ['asset-overview', ['overview']], ['asset-library', ['assets']], ['tasks', ['tasks']],
      ['mcp-monitor', ['monitor', 'monitor-poll']], ['projects', ['projects']], ['vulnerabilities', ['vulns']], ['webshell', ['webshell']],
      ['chat-files', ['files']], ['workflows', ['workflows']], ['skills-monitor', ['skills-monitor']],
      ['skills-management', ['skills-pages', 'skills']],
      ['knowledge-management', ['categories', 'knowledge', 'index']], ['knowledge-retrieval-logs', ['retrieval']],
      ...(['c2-listeners', 'c2-sessions', 'c2-tasks', 'c2-payloads', 'c2-events', 'c2-profiles'] as const).map(page => [page, [page]] satisfies [PageId, string[]]),
    ];
    for (const [page, expected] of cases) {
      log.length = 0; lifecycle.init(route(page));
      expect(log, page).toEqual(['stop-external', ...expected, ...(page !== 'tasks' ? ['cleanup-tasks'] : []), 'stop-token']);
    }
    delete deps.refreshHitlActivePanel; log.length = 0; lifecycle.init(route('hitl'));
    expect(log).toContain('hitl-fallback');
  });

  it('continues MCP loading after config failure and delays tools until after rendering', async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const lifecycle = createPageLifecycle(root, {
      onError: () => { log.push('config-error'); },
      loadConfig: async () => { log.push('config'); throw new Error('unavailable'); },
      prepareToolsPagination: () => { log.push('pagination'); },
      loadExternalMCPs: () => { log.push('external'); },
      startExternalMcpPoll: () => { log.push('poll'); },
      loadToolsList: () => { log.push('tools'); },
    });
    lifecycle.init(route('mcp-management'));
    await vi.advanceTimersByTimeAsync(99);
    expect(log).toEqual(['config', 'config-error', 'pagination', 'external', 'poll']);
    await vi.advanceTimersByTimeAsync(1); expect(log.at(-1)).toBe('tools');
  });

  it('does not request full config without permission and cancels deferred tools on leave', async () => {
    vi.useFakeTimers();
    const loadConfig = vi.fn(); const loadToolsList = vi.fn(); const loadExternalMCPs = vi.fn();
    const lifecycle = createPageLifecycle(root, { onError: vi.fn(), hasPermission: () => false, loadConfig, loadToolsList, loadExternalMCPs });
    lifecycle.init(route('mcp-management'));
    expect(loadConfig).not.toHaveBeenCalled(); expect(loadExternalMCPs).toHaveBeenCalledOnce();
    lifecycle.invalidate(); await vi.runAllTimersAsync(); expect(loadToolsList).not.toHaveBeenCalled();
  });

  it('does not restart MCP polling or render roles after a newer page owns the view', async () => {
    let finishConfig: (() => void) | undefined;
    let finishRoles: (() => void) | undefined;
    const startExternalMcpPoll = vi.fn(); const renderRolesList = vi.fn();
    const lifecycle = createPageLifecycle(root, {
      onError: vi.fn(), loadConfig: () => new Promise<void>(resolve => { finishConfig = resolve; }),
      loadRoles: () => new Promise<void>(resolve => { finishRoles = resolve; }), startExternalMcpPoll, renderRolesList,
    });
    lifecycle.init(route('mcp-management')); await Promise.resolve();
    lifecycle.init(route('roles-management')); lifecycle.invalidate();
    finishConfig?.(); finishRoles?.(); await Promise.resolve(); await Promise.resolve();
    expect(startExternalMcpPoll).not.toHaveBeenCalled(); expect(renderRolesList).not.toHaveBeenCalled();
  });
});
