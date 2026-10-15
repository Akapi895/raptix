/**
 * Shared emergency-stop outcome policy. Governance writes these outcomes and
 * every gate (preflight, bind, closure) must agree on which of them keep an
 * engagement blocked until an explicit resolution.
 */

/** Outcomes that block work start and closure until an explicit resolution. */
export const ACTIVE_STOP_OUTCOMES = ['requested', 'acknowledged', 'stopped', 'failed', 'unknown'] as const;
