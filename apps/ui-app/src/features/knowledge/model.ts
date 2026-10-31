/** JSON contracts: internal/knowledge/types.go and internal/handler/knowledge.go. */
export interface KnowledgeItem { id: string; category: string; title: string; content?: string; filePath?: string; createdAt?: string; updatedAt?: string }
export interface KnowledgeCategory { category: string; itemCount: number; items: KnowledgeItem[] }
export interface RetrievalLog { id: string; query?: string; conversationId?: string; messageId?: string; riskType?: string; retrievedItems: string[]; createdAt?: string; hits?: number }
export interface IndexStatus {
  enabled?: boolean;
  total_items: number; indexed_items: number; progress_percent: number; is_complete: boolean;
  last_error?: string; is_rebuilding?: boolean; rebuild_total?: number; rebuild_current?: number; rebuild_failed?: number;
  rebuild_last_item_id?: string; rebuild_last_chunks?: number; rebuild_start_time?: string;
}
export interface KnowledgePayload { category: string; title: string; content: string }
export interface KnowledgeState {
  enabled: boolean;
  categories: string[];
  groups: KnowledgeCategory[];
  pagination: { currentPage: number; pageSize: number; total: number; currentCategory: string };
  search: string;
  editor: (KnowledgePayload & { id: string | null; loading: boolean }) | null;
  saving: boolean;
  logs: RetrievalLog[];
  logFilter: { conversationId: string; messageId: string };
  index: IndexStatus | null;
}
export const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
export function retrievedCount(log: RetrievalLog): number {
  const real = log.retrievedItems.filter(id => id !== '_has_results').length;
  return real || (log.retrievedItems.includes('_has_results') ? -1 : log.hits ?? 0);
}
export function preview(content: string, length: number): string {
  const text = content.replace(/^#+\s+/gm, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}
export function formatTime(time?: string): string {
  if (!time) return '';
  let date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    const matched = time.match(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?/);
    if (matched) { let value = matched[0].replace(' ', 'T'); if (!/Z|[+-]\d{2}:\d{2}$/.test(value)) value += 'Z'; date = new Date(value); }
  }
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1970 || date.getFullYear() > 2100) return '';
  return date.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
export function timeAgo(time?: string): string {
  if (!time || !formatTime(time)) return '';
  const diff = Date.now() - new Date(time).getTime();
  if (!Number.isFinite(diff) || diff < 0 || diff > 365 * 86400000 * 10) return formatTime(time);
  if (diff >= 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  if (diff >= 3600000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff >= 60000) return `${Math.floor(diff / 60000)}min ago`;
  return 'Just now';
}
export function knowledgeIndexErrorAdvice(error: string): string {
  if (/\b401\b|incorrect api key|invalid api key|unauthorized/i.test(error)) return 'The embedding service rejected the credentials. Check the API key and service URL of the knowledge-base embedding settings, save, and retry.';
  if (/\b403\b|forbidden/i.test(error)) return 'The embedding service denied access. Check the account permissions and the access rights of the selected embedding model.';
  if (/\b429\b|rate limit|quota/i.test(error)) return 'The embedding service is rate-limiting requests. Check the request rate and the account quota, then retry later.';
  if (/timeout|deadline exceeded/i.test(error)) return 'The embedding service request timed out. Check service availability, the network and proxy settings, then retry.';
  if (/connection refused|no such host|network is unreachable/i.test(error)) return 'Cannot reach the embedding service. Check the service URL, DNS, network and proxy settings.';
  return 'Review the error above, fix the embedding model and service configuration, and retry.';
}
