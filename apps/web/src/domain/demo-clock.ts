/**
 * The demo wall-clock projection (ticket 67 enabler C).
 *
 * The console's display clock is a host-elapsed projection anchored at the
 * dataset's demo instant — Oct 13, 2026, 10:42 AM (UTC+7) — advancing minute
 * by minute with the host wall clock. It stays in lockstep with the service
 * clock (ServicesProvider advances the factory clock by the same elapsed host
 * time every 15 s), and it is the single anchor for every display label:
 * audit/notice stamps, the live operation logs and the C2 grant countdown.
 *
 * One module owns the anchor so every projection agrees (the store and the
 * C2 service used to hold private copies with independent module-eval
 * anchors — same value, duplicated mechanism).
 */
import { DEMO_TZ_LABEL } from './clock'

let T0 = Date.now()
const pad = (n: number) => String(n).padStart(2, '0')
const nowMin = () => 10 * 60 + 42 + Math.floor((Date.now() - T0) / 60000)

/** Restores display elapsed time alongside the factory's dataset clock. */
export function resetDemoClock(): void {
  T0 = Date.now()
}

/** The projected demo time as a 24-hour `HH:MM` label. */
export function hhmm() {
  const m = nowMin()
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
}

/** The projected demo time as a 12-hour `H:MM AM/PM` label. */
export function hhmm12() {
  const m = nowMin(), h = Math.floor(m / 60) % 24
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`
}

/** The dataset's display stamp, e.g. "Oct 13, 2026, 10:42 AM (UTC+7)". */
export function stamp() {
  return `Oct 13, 2026, ${hhmm12()} ${DEMO_TZ_LABEL}`
}

/** The dataset's demo date label. */
export function today() {
  return 'Oct 13, 2026'
}
