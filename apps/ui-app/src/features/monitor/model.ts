// internal/handler/monitor.go execution and summary DTOs.
export interface MonitorExecution {
  id?: string; toolName?: string; status?: string; startTime?: string | null; endTime?: string | null;
  [key: string]: unknown;
}
export interface MonitorToolStat {
  toolName?: string; totalCalls?: number; successCalls?: number; failedCalls?: number; blockedCalls?: number;
}
export interface MonitorSummary {
  totalCalls?: number; successCalls?: number; failedCalls?: number; blockedCalls?: number;
  lastCallTime?: string | null; toolCount?: number;
}
export interface MonitorPagination { page: number; pageSize: number; total: number; totalPages: number }
export interface MonitorPayload {
  executions?: MonitorExecution[]; summary?: MonitorSummary | null; topTools?: MonitorToolStat[];
  retentionDays?: number; total?: number; page?: number; pageSize?: number; totalPages?: number;
}

export const MONITOR_POLL_INTERVAL_MS = 3000;
export const MONITOR_PAGE_SIZE_KEY = 'monitorPageSize';
export const MONITOR_TIMELINE_RANGE_KEY = 'mcpMonitorTimelineRange';
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100] as const;

/** Display name: the server's `::` namespace becomes `__`, which is how tool names appear in chat. */
export function formatMonitorToolName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return name ?? '';
  return name.includes('::') ? name.replace('::', '__') : name;
}

/** Filter and API form: `mcp__tool` becomes the inventory key `mcp::tool`. */
export function canonicalMonitorToolName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return name ?? '';
  if (name.includes('::')) return name;
  const idx = name.indexOf('__');
  return idx > 0 ? `${name.slice(0, idx)}::${name.slice(idx + 2)}` : name;
}

export function monitorToolNamesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalMonitorToolName(a) === canonicalMonitorToolName(b);
}

export const STATUS_KEYS: Record<string, string> = {
  pending: 'statusPending', queued: 'statusQueued', running: 'statusRunning', completed: 'statusCompleted',
  failed: 'statusFailed', blocked: 'statusBlocked', cancelled: 'statusCancelled',
  hard_timeout: 'statusHardTimeout', orphaned: 'statusOrphaned',
};

/** Duration in the largest sensible units: seconds, then minutes, then hours. */
export type DurationParts =
  | { kind: 'unknown' }
  | { kind: 'seconds'; n: number }
  | { kind: 'minutesSeconds'; minutes: number; seconds: number }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hoursMinutes'; hours: number; minutes: number }
  | { kind: 'hours'; hours: number };

export function durationParts(start: string | null | undefined, end: string | null | undefined, now = Date.now()): DurationParts {
  if (!start) return { kind: 'unknown' };
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : now;
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return { kind: 'unknown' };
  const seconds = Math.floor(Math.max(0, endTime - startTime) / 1000);
  if (seconds < 60) return { kind: 'seconds', n: seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remain = seconds % 60;
    return remain > 0 ? { kind: 'minutesSeconds', minutes, seconds: remain } : { kind: 'minutes', minutes };
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? { kind: 'hoursMinutes', hours, minutes: remainMinutes } : { kind: 'hours', hours };
}

/** Pagination for the executions list. */
export function paginationOf(total: number, page: number, pageSize: number): MonitorPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), totalPages), pageSize, total, totalPages };
}

export function parsePageSize(saved: string | null): number {
  const n = saved ? parseInt(saved, 10) : DEFAULT_PAGE_SIZE;
  return Number.isNaN(n) || n <= 0 ? DEFAULT_PAGE_SIZE : n;
}
