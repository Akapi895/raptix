/**
 * Mock clock and scheduling for the console service layer (ticket 04,
 * ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Time is an absolute instant (ms since the Unix epoch). The mock clock is
 * anchored to the dataset's demo date — "Oct 13, 2026, 10:42 AM (UTC+7)" —
 * and advances elapsed time as absolute instants, including date rollover.
 * The project timezone (Asia/Ho_Chi_Minh, UTC+7) applies to display strings
 * and window checks only; expiry enforcement compares instants parsed from
 * the seeded demo strings at the service boundary, never host wall-clock.
 */
import type { Clock, Instant } from './service'

/** Project timezone for display/window checks (Asia/Ho_Chi_Minh, UTC+7). */
export const DEMO_TZ = 'Asia/Ho_Chi_Minh'
export const DEMO_TZ_LABEL = '(UTC+7)'

/** Absolute instant of the dataset's demo anchor: Oct 13, 2026, 10:42 AM (UTC+7). */
export const DEMO_ANCHOR: Instant = Date.parse('2026-10-13T10:42:00+07:00')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Formats an absolute instant as the dataset's display string, e.g. "Oct 13, 2026, 10:42 AM (UTC+7)". */
export function formatDemoInstant(t: Instant): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DEMO_TZ, month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(t))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${DEMO_TZ_LABEL}`
}

/**
 * Normalizes a seeded expiry string ("Oct 14, 2026, 9:25 AM (UTC+7)") into an
 * absolute instant at the service boundary. Returns undefined for strings
 * that are not demo timestamps (e.g. "—", date-only retention labels).
 */
export function parseDemoInstant(value: string): Instant | undefined {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM) \(UTC\+7\)$/.exec(value)
  if (!m) return undefined
  const month = MONTHS.indexOf(m[1])
  if (month < 0) return undefined
  const hour = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0)
  return Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5])) - 7 * 60 * 60 * 1000
}

/**
 * Discrete scheduler driven by the mock clock: callbacks fire when the clock
 * advances past their absolute instant. No real timers are used, so deadline
 * and sweep events run without any screen mounted and are deterministic under
 * test. Reset clears every pending callback.
 */
export class Scheduler {
  private items: { at: Instant; fn: () => void }[] = []

  schedule(at: Instant, fn: () => void): () => void {
    const item = { at, fn }
    this.items.push(item)
    return () => { this.items = this.items.filter((x) => x !== item) }
  }

  /**
   * Runs every callback due at or before `now`, in scheduling order. Callbacks
   * scheduled while draining (e.g. a recurring sweep's next tick) also run
   * when still due, so one advance covers every elapsed interval.
   */
  runDue(now: Instant): void {
    for (;;) {
      const due = this.items.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)[0]
      if (!due) return
      this.items = this.items.filter((x) => x !== due)
      due.fn()
    }
  }

  clear(): void { this.items = [] }
  get pending(): number { return this.items.length }
}

/**
 * Mock clock: anchored at the dataset's demo date, advances elapsed time as
 * absolute instants and notifies the scheduler so due callbacks fire in order.
 * Reset restores the anchor; wiring (onAdvance) belongs to the factory that
 * owns the clock lifecycle.
 */
export class MockClock implements Clock {
  private elapsedMs = 0
  private listeners = new Set<(now: Instant) => void>()

  now(): Instant { return DEMO_ANCHOR + this.elapsedMs }

  /** Advances elapsed time, then runs scheduler callbacks due at the new instant. */
  advance(ms: number): void {
    this.elapsedMs += ms
    const now = this.now()
    this.listeners.forEach((fn) => fn(now))
  }

  reset(): void { this.elapsedMs = 0 }

  onAdvance(fn: (now: Instant) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}
