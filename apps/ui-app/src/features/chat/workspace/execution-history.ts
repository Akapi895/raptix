import type { ExecutionEvent, ExecutionMessage } from './execution';

/** Keep immutable historical turns cached; use the existing paginated, payload-light API. */
export function createExecutionHistory(getJson: (path: string) => Promise<unknown>) {
  const cache = new Map<string, { stamp?: string; events: ExecutionEvent[] }>();
  return {
    clear: () => cache.clear(),
    async hydrate(conversationId: string, messages: ExecutionMessage[], active: boolean | null, current: () => boolean): Promise<ExecutionMessage[]> {
      let latest = -1;
      messages.forEach((message, index) => { if (message.role === 'assistant') latest = index; });
      const hydrated: ExecutionMessage[] = [];
      for (const [index, message] of messages.entries()) {
        if (!current()) break;
        if (message.role !== 'assistant' || !message.id || Array.isArray(message.processDetails)) {
          hydrated.push(message);
          continue;
        }
        const key = conversationId + ':' + message.id;
        const cached = cache.get(key);
        if (cached && message.updatedAt && cached.stamp === message.updatedAt && (index !== latest || active === false)) {
          hydrated.push({ ...message, processDetails: cached.events });
          continue;
        }
        const events: ExecutionEvent[] = [];
        let offset = 0;
        let more = true;
        while (more && current()) {
          const page = await getJson('/api/messages/' + encodeURIComponent(message.id) + '/process-details?limit=200&offset=' + offset) as { processDetails?: ExecutionEvent[]; hasMore?: boolean };
          events.push(...(page.processDetails || []));
          more = page.hasMore === true;
          offset += 200;
        }
        if (current()) cache.set(key, { stamp: message.updatedAt, events });
        hydrated.push({ ...message, processDetails: events });
      }
      return hydrated;
    },
  };
}
