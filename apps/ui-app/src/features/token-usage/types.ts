// JSON names from internal/database/model_token_usage.go. Optional collections
// and counters accommodate the demo's compact response and older servers.
export interface TokenUsageSummary {
  events?: number; modelCalls?: number; promptTokens?: number; completionTokens?: number;
  totalTokens?: number; cacheWriteTokens?: number; cachedTokens?: number; reasoningTokens?: number;
}
export interface TokenUsageBreakdown extends TokenUsageSummary { key: string; label?: string }
export interface TokenUsageRecent extends TokenUsageSummary {
  createdAt: string; model?: string; reason: string; id?: string; processDetailId?: string; messageId?: string;
  conversationId?: string; projectId?: string; source?: string; orchestration?: string; updatedAt?: string;
}
export interface TokenUsageStats {
  summary: TokenUsageSummary; today?: TokenUsageSummary; byDay?: TokenUsageBreakdown[] | null;
  byModel?: TokenUsageBreakdown[] | null; byOrchestration?: TokenUsageBreakdown[] | null; recent?: TokenUsageRecent[] | null;
}
export type TrendMetric = 'totalTokens' | 'modelCalls' | 'cacheRate';
export interface TokenUsageDependencies {
  translate(key: string, options?: Record<string, string | number>): string;
  getLocale(): string; getActiveProjectId(): string;
  navigate(page: string): void; settingsSection(section: string): void;
  hash(): string; setHash(value: string): void;
}
