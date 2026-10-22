import type { DetectState, Technique } from '../../domain/entities'

/** Seeded recommendation text for the two techniques the demo analysis reports most often; other techniques get the generic line. */
const RECS: Record<string, string> = {
  T1078: 'Add alert rules for unusual privileged-account sign-ins and review privileged groups on a regular schedule.',
  T1110: 'Set an alert threshold for consecutive failed authentications on the authentication log source.',
}

/** The detection step for one technique's state: a tuning step when it was not detected, a reconciliation step when it is unverified. */
export const recFor = (t: Technique, st: DetectState) =>
  st === 'undetected' ? RECS[t.id] || `Add or tune detection rules for ${t.id} (${t.name}) and retest after the update.` : `Unverified: reconcile ${t.id} logs with the Blue Team before concluding whether a signal exists.`
