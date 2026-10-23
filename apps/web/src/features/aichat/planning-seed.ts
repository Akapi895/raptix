/**
 * Project creation hands the planner its first message: the create form sets
 * this one-shot flag and the AI workspace clears it once the brief is sent.
 * Per-viewer convenience only: if the flag is lost the operator sends the brief
 * by hand, and an existing planning thread always wins over the flag. The flag
 * is keyed by the signed-in actor, so a session that signs in next in the same
 * tab does not inherit a brief the previous account has not sent yet.
 */

const key = (engagementId: string, actorId: string): string => `raptix.planning-seed.${encodeURIComponent(actorId)}.${encodeURIComponent(engagementId)}`

export function markPlanningSeed(engagementId: string, actorId: string): void {
  try { window.sessionStorage.setItem(key(engagementId, actorId), '1') } catch { /* storage is optional: the operator can send the brief by hand */ }
}

export function hasPlanningSeed(engagementId: string, actorId: string): boolean {
  try { return window.sessionStorage.getItem(key(engagementId, actorId)) !== null } catch { return false }
}

/** Called once the first message is dispatched, so a runtime that is not ready yet keeps the seed. */
export function clearPlanningSeed(engagementId: string, actorId: string): void {
  try { window.sessionStorage.removeItem(key(engagementId, actorId)) } catch { /* nothing to clear */ }
}

/** The first planner message: the operator's own brief and the declared target, nothing synthesized. */
export function planningSeedMessage(project: { displayName: string; targetType: string; targetValue: string; brief: string | null }): string {
  return [
    `Engagement: ${project.displayName}`,
    `Target (${project.targetType}): ${project.targetValue}`,
    '',
    'Operator brief:',
    project.brief?.trim() ?? '',
    '',
    'Start the planning interview.',
  ].join('\n')
}
