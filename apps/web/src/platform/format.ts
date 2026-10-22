/** Shared UTC instant formatting for real-mode projections: `2026-10-15 08:12Z`. */
export function utcMinute(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16) + 'Z'
}

/** Null-tolerant variant that renders a placeholder when the instant is absent. */
export function utcMinuteOr(iso: string | null | undefined, fallback = '—'): string {
  return iso === null || iso === undefined || iso === '' ? fallback : utcMinute(iso)
}

/** Offset (ms) of `timeZone` at the given instant — DST-aware via Intl. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second))
  return asUtc - date.getTime()
}

/**
 * W07: converts a naive `datetime-local` value (`YYYY-MM-DDTHH:mm`) entered
 * for the chosen IANA zone into an absolute ISO instant (offset/Z suffix).
 * A second pass keeps DST boundaries truthful; the API machine's clock can
 * never shift the authorized window.
 */
export function zonedToIso(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error(`Invalid datetime: ${local}`)
  const guess = new Date(`${local}:00Z`)
  if (Number.isNaN(guess.getTime())) throw new Error(`Invalid datetime: ${local}`)
  const first = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone))
  return new Date(guess.getTime() - zoneOffsetMs(first, timeZone)).toISOString()
}
