import type { NotificationSummary, Request } from './types';

export function createNotificationClient(request: Request) {
  async function json<T>(url: string, options?: RequestInit): Promise<T | null> {
    try { const response = await request(url, options); return response.ok ? await response.json() as T : null; }
    catch { return null; }
  }
  return {
    summary: (since: number, lang: string) => json<NotificationSummary>(
      '/api/notifications/summary?since=' + encodeURIComponent(String(since)) + '&limit=80&lang=' + encodeURIComponent(lang)),
    async read(eventIds: string[]): Promise<boolean> {
      if (!eventIds.length) return true;
      return !!await json<unknown>('/api/notifications/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventIds }),
      });
    },
  };
}
export type NotificationClient = ReturnType<typeof createNotificationClient>;
