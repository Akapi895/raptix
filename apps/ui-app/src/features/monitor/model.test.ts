import { describe, expect, it } from 'vitest';
import { canonicalMonitorToolName, durationParts, formatMonitorToolName, monitorToolNamesEqual, paginationOf, parsePageSize } from './model';

describe('monitor tool names', () => {
  it('shows the namespace separator as a double underscore and canonicalises it back', () => {
    expect(formatMonitorToolName('github::search')).toBe('github__search');
    expect(canonicalMonitorToolName('github__search')).toBe('github::search');
    expect(monitorToolNamesEqual('github__search', 'github::search')).toBe(true);
  });
});

describe('durations', () => {
  const start = '2026-10-29T10:00:00Z';
  it('chooses the largest sensible unit', () => {
    expect(durationParts(start, '2026-10-29T10:00:42Z')).toEqual({ kind: 'seconds', n: 42 });
    expect(durationParts(start, '2026-10-29T10:03:05Z')).toEqual({ kind: 'minutesSeconds', minutes: 3, seconds: 5 });
    expect(durationParts(start, '2026-10-29T11:00:00Z')).toEqual({ kind: 'hours', hours: 1 });
    expect(durationParts(null, null)).toEqual({ kind: 'unknown' });
  });
});

describe('pagination', () => {
  it('clamps the page into the available range and keeps at least one page', () => {
    expect(paginationOf(0, 3, 20)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
    expect(paginationOf(45, 9, 20)).toMatchObject({ page: 3, totalPages: 3 });
    expect(parsePageSize('abc')).toBe(20);
  });
});
