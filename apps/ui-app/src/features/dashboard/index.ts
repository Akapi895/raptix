import { dashboardBrowser } from '../../platform/dashboard-browser';
import { sessionStorage, storage } from '../../platform/storage';
import { createDashboardClient } from './client';
import { createDashboardService } from './service';
import { createDashboardView } from './view';
import type { DashboardDependencies } from './types';

export type { DashboardDependencies } from './types';
// Transitional consumers: token-usage charts, audit and HITL still call these helpers.
export { formatTokenUsageCompact, esc as escapeDashboardHtml } from './dom';
export function initDashboard(document: Document, dependencies: DashboardDependencies) {
  const view = createDashboardView(document, dependencies);
  const service = createDashboardService({
    client: createDashboardClient(), storage, sessionStorage, context: dependencies, observer: view.observer,
    runtime: {
      now: dashboardBrowser.now, every: dashboardBrowser.every, cancelEvery: dashboardBrowser.cancelEvery,
      isActive: () => document.getElementById('page-dashboard')?.classList.contains('active') ?? false,
      isVisible: () => !document.hidden,
    },
  });
  view.bind(service);
  return {
    refresh: service.refresh,
    syncAccessTabs: view.syncAccessTabs,
    startAutoRefresh: service.startAutoRefresh,
    stopAutoRefresh: service.stopAutoRefresh,
    dispose(): void { service.dispose(); view.dispose(); },
  };
}
export type Dashboard = ReturnType<typeof initDashboard>;
