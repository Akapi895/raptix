/** Shared UTC instant formatting for real-mode projections: `2026-10-15 08:12Z`. */
export function utcMinute(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16) + 'Z'
}

/** Null-tolerant variant that renders a placeholder when the instant is absent. */
export function utcMinuteOr(iso: string | null | undefined, fallback = '—'): string {
  return iso === null || iso === undefined || iso === '' ? fallback : utcMinute(iso)
}
