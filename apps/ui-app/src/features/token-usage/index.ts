import { createTokenUsageClient } from './client';
import { createTokenUsageService } from './service';
import { createTokenUsageView } from './view';
import type { TokenUsageDependencies } from './types';
export type { TokenUsageDependencies, TokenUsageSummary, TokenUsageBreakdown, TokenUsageStats, TrendMetric } from './types';
export { createTokenUsageClient } from './client';
export { createTokenUsageService, tokenUsageCacheRate, tokenUsageCount, tokenUsageMetrics, tokenUsageTimeline } from './service';
export function initTokenUsage(document: Document, dependencies: TokenUsageDependencies) {
  const view = createTokenUsageView(document, dependencies);
  const service = createTokenUsageService(createTokenUsageClient(), dependencies.getActiveProjectId, view.observer);
  view.bind(service);
  return { view, service, afterClassicScripts: view.mount, dispose(): void { service.dispose(); view.dispose(); } };
}
