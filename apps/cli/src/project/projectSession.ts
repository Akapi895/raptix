/**
 * Pure project-session decisions for the CLI (ADR-0092 §1.2, §4.3). Nothing here performs I/O. The caller gathers
 * the environment states it is allowed to see and acts on the plan it gets back.
 */

import type { EnvironmentStateView } from "../transport/facadeClient.js";

export type ActivationPlan =
  | { kind: "activate"; engagementId: string }
  | { kind: "stop_then_activate"; stopEngagementId: string; engagementId: string }
  | { kind: "busy" };

/**
 * Plans the activation of `target`. A free slot, or a slot the target already holds, activates directly. A slot
 * held by another project yields `stop_then_activate` only when that project is among the states the caller can
 * see as its own. The CLI never guesses the holder from a display name, and it never stops a project it cannot name.
 */
export function planActivation(target: string, states: ReadonlyMap<string, EnvironmentStateView>): ActivationPlan {
  const self = states.get(target);
  if (self === undefined || !self.slot.held || self.slot.ownedByThisProject) return { kind: "activate", engagementId: target };
  for (const [engagementId, view] of states) {
    if (engagementId !== target && view.slot.ownedByThisProject) {
      return { kind: "stop_then_activate", stopEngagementId: engagementId, engagementId: target };
    }
  }
  return { kind: "busy" };
}

export type ResumeCheck =
  | { ok: true }
  | { ok: false; code: "thread_belongs_to_another_project" | "environment_not_ready"; message: string };

/**
 * Checks a thread before its history is rendered or a message is dispatched on it. The thread must belong to the
 * project being viewed, and that project's environment must be ready.
 */
export function verifyThreadForResume(threadEngagementId: string, viewing: string, environment: EnvironmentStateView | undefined): ResumeCheck {
  if (threadEngagementId !== viewing) {
    return { ok: false, code: "thread_belongs_to_another_project", message: "That conversation belongs to a different project. Switch to that project to open it." };
  }
  if (environment?.environment.observedState !== "ready") {
    return { ok: false, code: "environment_not_ready", message: "This project's environment is not running. Activate it before resuming." };
  }
  return { ok: true };
}
