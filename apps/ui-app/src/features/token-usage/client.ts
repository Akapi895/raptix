import { http } from '../../platform/http';
import type { TokenUsageStats } from './types';
export function createTokenUsageClient(transport: Pick<typeof http, 'get'> = http) {
  return {
    load(days: number, projectId: string, signal: AbortSignal): Promise<TokenUsageStats> {
      const params = new URLSearchParams({ days: String(days), limit: '20' });
      if (projectId) params.set('project_id', projectId);
      return transport.get<TokenUsageStats>('/api/usage/tokens?' + params, { signal });
    },
  };
}
export type TokenUsageClient = ReturnType<typeof createTokenUsageClient>;
