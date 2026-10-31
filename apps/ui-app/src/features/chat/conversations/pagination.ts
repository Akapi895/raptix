// The conversation list's paging and ordering rules: which page is shown, how the total is known, when a list response is
// stale, and how the conversations are grouped by when they were last touched. Pure; the list controller drives them.

export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
export type SortBy = 'created_at' | 'updated_at';

export function normalizeSortBy(value: unknown): SortBy {
  return value === 'created_at' ? 'created_at' : 'updated_at';
}

export function normalizePageSize(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export interface ConversationLike {
  id?: string;
  pinned?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

/** The time a conversation sorts by; the epoch when it has none, so it sinks to the bottom. */
export function sortTime(conversation: ConversationLike | null | undefined, sortBy: SortBy): Date {
  const field = sortBy === 'created_at' ? 'createdAt' : 'updatedAt';
  const raw = conversation?.[field];
  if (!raw) return new Date(0);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function totalPagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil((total || 0) / pageSize) || 1);
}

/** A total the server sent, or the number of items when it sent none (or a bad one). */
export function parseTotal(raw: unknown, itemsLength: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (raw != null && raw !== '') {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return itemsLength;
}

export function parseOffset(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (raw != null && raw !== '') {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

export interface ParsedList {
  items: ConversationLike[];
  total: number;
  limit: number;
  offset: number;
  isLegacyArray: boolean;
}

/** A list response: the current one carries a total, the legacy one is a bare array. */
export function parseListResponse(data: unknown): ParsedList {
  if (Array.isArray(data)) {
    return { items: data as ConversationLike[], total: data.length, limit: data.length, offset: 0, isLegacyArray: true };
  }
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const raw = body.conversations ?? body.items ?? [];
  const items = Array.isArray(raw) ? raw as ConversationLike[] : [];
  return {
    items,
    total: parseTotal(body.total, items.length),
    limit: parseTotal(body.limit, items.length) || items.length,
    offset: parseOffset(body.offset),
    isLegacyArray: false,
  };
}

export interface PagingState {
  page: number;
  pageSize: number;
  total: number;
}

/** Which page a request is for, what the list is loaded with, and whether a newer decision has overtaken it. */
export interface LoadIntent {
  loadSeq: number;
  intentPage: number | null;
  navigateGenAtStart: number;
  activePage: number;
}

export interface LoadCounters {
  loadSeq: number;
  navigateGen: number;
}

/**
 * Whether a list response is stale. A newer load, a page the user moved to since the request started, or a page that
 * was clamped meanwhile all make the response stale.
 */
export function isStaleLoad(intent: LoadIntent, counters: LoadCounters, currentPage: number): boolean {
  if (intent.loadSeq !== counters.loadSeq) return true;
  if (intent.intentPage == null && intent.navigateGenAtStart !== counters.navigateGen) return true;
  if (intent.intentPage != null && intent.intentPage !== currentPage) return true;
  if (intent.intentPage == null && intent.activePage != null && intent.activePage !== currentPage) return true;
  return false;
}

/** The page to show after the total is known, or null when the page still exists. */
export function clampPage(page: number, total: number, pageSize: number): number | null {
  const pages = totalPagesOf(total, pageSize);
  return page > pages ? pages : null;
}

/**
 * Reconciles the total with a page the user asked for: a stale or low total must not pull a page the server has data
 * for back to the first page. Returns the total to keep, and a page to move to when the page is out of range.
 */
export function reconcileTotal(
  activePage: number,
  asked: boolean,
  parsed: ParsedList,
  pageSize: number,
  offset: number,
  resolvedTotal: number,
  knownTotal: number,
): { total: number; clampedPage: number | null } {
  let total = resolvedTotal;
  if (activePage <= totalPagesOf(total, pageSize)) return { total, clampedPage: null };
  const serverTotal = parseTotal(parsed.total, parsed.items.length);
  const hasPageData = parsed.items.length > 0;
  if (asked && (hasPageData || serverTotal > offset || total > offset || knownTotal > offset)) {
    total = Math.max(total, serverTotal, knownTotal, offset + parsed.items.length);
    if (activePage <= totalPagesOf(total, pageSize)) return { total, clampedPage: null };
  }
  return { total, clampedPage: totalPagesOf(total, pageSize) };
}

export interface ConversationGroups {
  pinned: ConversationLike[];
  today: ConversationLike[];
  yesterday: ConversationLike[];
  last7Days: ConversationLike[];
  earlier: ConversationLike[];
}

/** Day boundaries for the groups: start of today, of yesterday, and the cut-off of the last seven days. */
export function dayBoundaries(now: Date): { todayStart: Date; yesterdayStart: Date; sevenDaysCutoff: Date } {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);
  const sevenDaysCutoff = new Date(todayStart);
  sevenDaysCutoff.setDate(todayStart.getDate() - 7);
  return { todayStart, yesterdayStart, sevenDaysCutoff };
}

/** The group a moment belongs to. */
export function groupOf(date: Date, bounds: { todayStart: Date; yesterdayStart: Date; sevenDaysCutoff: Date }): 'today' | 'yesterday' | 'last7Days' | 'earlier' {
  if (date >= bounds.todayStart) return 'today';
  if (date >= bounds.yesterdayStart) return 'yesterday';
  if (date >= bounds.sevenDaysCutoff) return 'last7Days';
  return 'earlier';
}

/** Splits the unique conversations into the pinned ones and the groups of the rest, each newest first. */
export function groupConversations(conversations: ConversationLike[], sortBy: SortBy): ConversationGroups {
  const byTime = (a: ConversationLike, b: ConversationLike) => sortTime(b, sortBy).getTime() - sortTime(a, sortBy).getTime();
  const pinned = conversations.filter(item => item.pinned).sort(byTime);
  const normal = conversations.filter(item => !item.pinned).sort(byTime);
  const groups: ConversationGroups = { pinned, today: [], yesterday: [], last7Days: [], earlier: [] };
  const bounds = dayBoundaries(new Date());
  normal.forEach(item => {
    groups[groupOf(validDate(sortTime(item, sortBy)), bounds)].push(item);
  });
  return groups;
}

/** A conversation whose time is unknown is shown as just updated. */
export function validDate(date: Date): Date {
  return date.getTime() === 0 ? new Date() : date;
}

/** Keeps the first conversation of each id: a list can briefly repeat one when the server changes meanwhile. */
export function uniqueById(items: ConversationLike[]): ConversationLike[] {
  const seen = new Set<string>();
  const out: ConversationLike[] = [];
  items.forEach(item => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  });
  return out;
}
