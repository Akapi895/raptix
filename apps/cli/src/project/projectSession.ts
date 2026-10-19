/**
 * Pure project-session decisions for the CLI (ADR-0092 §1.2, §4.3). Nothing here performs I/O. The caller gathers
 * the environment states it is allowed to see and acts on the plan it gets back.
 */

import type { EnvironmentStateView, FacadeClient } from "../transport/facadeClient.js";

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

/**
 * The project this CLI session works in. The one whose environment this caller owns and holds is preferred, so a
 * restarted CLI reattaches to the project it was running. Otherwise the first project the caller can see is used.
 */
export async function chooseProject(facade: Pick<FacadeClient, "listProjects" | "environment">): Promise<string> {
  const projects = await facade.listProjects();
  if (projects.length === 0) throw new Error("No project exists yet. Create one in the Web UI first.");
  for (const project of projects.slice(0, 50)) {
    const state = await facade.environment(project.id);
    if (state.slot.ownedByThisProject) return project.id;
  }
  return projects[0]!.id;
}
