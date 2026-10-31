import type { RequestFn } from '../roles/service';
import { type MonitorPayload } from './model';
import type { TimelineRange } from './timeline';

export interface TimelineResult {
  timeline: Record<string, unknown> | null;
  timelineError: string | null;
}

export class MonitorError extends Error {}

/** Server message when present, otherwise the fallback. Non-JSON error bodies fall back to the message. */
async function failure(response: Response, fallback: string): Promise<MonitorError> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return new MonitorError(body.error || fallback);
}

export function createMonitorService(request: RequestFn) {
  return {
    async page(page: number, pageSize: number, status: string, tool: string, fallback: string): Promise<MonitorPayload> {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (status && status !== 'all') params.set('status', status);
      if (tool && tool !== 'all') params.set('tool', tool);
      const response = await request(`/api/monitor?${params.toString()}`, { method: 'GET' });
      if (!response.ok) throw await failure(response, fallback);
      return await response.json() as MonitorPayload;
    },

    /** The trend is optional: a failure is returned as text so the rest of the page still renders. */
    async timeline(range: TimelineRange, fallback: string): Promise<TimelineResult> {
      try {
        const response = await request(`/api/monitor/calls-timeline?range=${encodeURIComponent(range)}`, { method: 'GET' });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) return { timeline: null, timelineError: body.error || fallback };
        return { timeline: body as Record<string, unknown>, timelineError: null };
      } catch (error) {
        return { timeline: null, timelineError: error instanceof Error && error.message ? error.message : fallback };
      }
    },

    async deleteExecution(id: string, fallback: string): Promise<void> {
      const response = await request(`/api/monitor/execution/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw await failure(response, fallback);
    },

    async deleteExecutions(ids: string[], fallback: string): Promise<number> {
      const response = await request('/api/monitor/executions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw await failure(response, fallback);
      const result = await response.json().catch(() => ({})) as { deleted?: number };
      return result.deleted ?? ids.length;
    },
  };
}

export type MonitorService = ReturnType<typeof createMonitorService>;
