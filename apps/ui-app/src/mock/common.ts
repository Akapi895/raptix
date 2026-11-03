import type { Context } from './router';

export function q(ctx: Context, name: string, fallback: string): string { return ctx.query.get(name) || fallback; }
export function qInt(ctx: Context, name: string, fallback: number): number { const value = parseInt(q(ctx, name, ''), 10); return isNaN(value) ? fallback : value; }
export function matchSearch<T extends object>(item: T, term: string, fields: readonly string[]): boolean {
  return !term || fields.some(field => Object.entries(item).some(([key, value]) => key === field && value != null && String(value).toLowerCase().includes(term.toLowerCase())));
}
export function filterList<T extends object>(items: T[], ctx: Context, opts: { searchKey?: string; searchFields?: string[]; filters?: Record<string, string> } = {}): T[] {
  return items.filter(item => matchSearch(item, q(ctx, opts.searchKey || 'search', ''), opts.searchFields || ['name', 'title']) && Object.entries(opts.filters || {}).every(([field, query]) => {
    const wanted = q(ctx, query, '');
    return !wanted || Object.entries(item).some(([key, value]) => key === field && String(value) === wanted);
  }));
}
export function limitOffset<T>(items: T[], ctx: Context, defaultLimit = 50) {
  const limit = qInt(ctx, 'limit', defaultLimit); const offset = qInt(ctx, 'offset', 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}
export function pagePaged<T>(items: T[], ctx: Context, defaultSize = 20) {
  const size = qInt(ctx, 'page_size', qInt(ctx, 'pageSize', defaultSize)); const page = qInt(ctx, 'page', 1);
  return { items: items.slice((page - 1) * size, page * size), total: items.length, page, pageSize: size, totalPages: Math.max(1, Math.ceil(items.length / size)) };
}
export function findById<T extends { id: string }>(list: T[], id: string | undefined): { item: T; index: number } | null {
  const index = list.findIndex(item => item.id === id); const item = list[index];
  return item ? { item, index } : null;
}
export function mergeInto<T extends object>(target: T, body: Partial<T> | null | undefined, allowed?: readonly (keyof T)[]): T {
  if (!body) return target;
  const source = body;
  function copy<K extends keyof T>(key: K): void { if (Object.hasOwn(source, key)) Object.assign(target, { [key]: source[key] }); }
  if (allowed) allowed.forEach(copy);
  else Object.assign(target, body);
  return target;
}
