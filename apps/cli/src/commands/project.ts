/**
 * Project commands: list and view a project, activate it, and stop it (ADR-0092 §1.2, §4.3). Each is a separate,
 * explicit step. Viewing never activates. Activating never stops another project. Stopping applies only to the
 * project this CLI is viewing when that project holds the slot.
 */

import { randomUUID } from "node:crypto";
import { planActivation } from "../project/projectSession.js";
import { controlPlane, currentEngagement, setCurrentEngagement } from "../project/session.js";
import type { EnvironmentStateView, FacadeClient, ProjectSummary } from "../transport/facadeClient.js";
import type { Command, CommandContext } from "./types.js";

export interface ProjectCommandDeps {
  facade: Pick<FacadeClient, "listProjects" | "environment" | "environmentCommand">;
  current: () => Promise<string>;
  select: (engagementId: string) => void;
  say: (line: string) => void;
}

const VISIBLE_LIMIT = 50;

async function visibleStates(facade: ProjectCommandDeps["facade"], projects: ProjectSummary[]): Promise<Map<string, EnvironmentStateView>> {
  const states = new Map<string, EnvironmentStateView>();
  for (const project of projects.slice(0, VISIBLE_LIMIT)) states.set(project.id, await facade.environment(project.id));
  return states;
}

function describeState(view: EnvironmentStateView | undefined): string {
  if (view === undefined) return "unknown";
  const held = view.slot.ownedByThisProject ? "holds the active slot" : view.slot.held ? "another project holds the slot" : "slot free";
  return `${view.environment.observedState}, ${held}`;
}

async function listOrView(deps: ProjectCommandDeps, args: string): Promise<void> {
  const projects = await deps.facade.listProjects();
  const current = await deps.current();
  if (args.trim() === "") {
    const states = await visibleStates(deps.facade, projects);
    if (projects.length === 0) deps.say("No project exists yet. Create one in the Web UI first.");
    for (const project of projects) {
      const marker = project.id === current ? "*" : " ";
      deps.say(`${marker} ${project.displayName} (${project.id}): ${describeState(states.get(project.id))}`);
    }
    deps.say("Use /project <name or id> to view a project. Activation is a separate step: /activate.");
    return;
  }
  const wanted = args.trim();
  const match = projects.find(project => project.id === wanted || project.displayName === wanted || project.workspaceSlug === wanted);
  if (match === undefined) {
    deps.say(`No project matches "${wanted}".`);
    return;
  }
  deps.select(match.id);
  deps.say(`Viewing ${match.displayName}. Nothing was started; use /activate to start it.`);
}

async function activate(deps: ProjectCommandDeps): Promise<void> {
  const projects = await deps.facade.listProjects();
  const current = await deps.current();
  const states = await visibleStates(deps.facade, projects);
  const self = states.get(current);
  if (self === undefined) {
    deps.say("The viewed project is not visible to you.");
    return;
  }
  const plan = planActivation(current, states);
  if (plan.kind === "busy") {
    deps.say("Another project holds the active slot and is not visible to you. Ask its owner to stop it.");
    return;
  }
  if (plan.kind === "stop_then_activate") {
    const holder = projects.find(project => project.id === plan.stopEngagementId);
    deps.say(`${holder?.displayName ?? "Another project"} is running. Use /project ${holder?.displayName ?? plan.stopEngagementId} then /stop, then /activate here.`);
    return;
  }
  const result = await deps.facade.environmentCommand(current, { requestId: `activate-${randomUUID()}`, action: "activate", expectedVersion: self.slot.version });
  if (result.status === "busy") {
    deps.say("Another project holds the active slot. Stop it first.");
    return;
  }
  if (result.status === "stale") {
    deps.say("The environment changed while you were looking at it. Run /activate again.");
    return;
  }
  if (result.status === "refused") {
    deps.say(`The environment cannot be activated now (${result.reason ?? "refused"}).`);
    return;
  }
  deps.say(`Activating. The environment is ${result.phase}.`);
}

async function stop(deps: ProjectCommandDeps): Promise<void> {
  const current = await deps.current();
  const view = await deps.facade.environment(current);
  if (!view.slot.ownedByThisProject) {
    deps.say("This project is not the active one, so there is nothing to stop.");
    return;
  }
  const result = await deps.facade.environmentCommand(current, { requestId: `stop-${randomUUID()}`, action: "stop", expectedVersion: view.slot.version });
  if (result.status === "accepted" || result.status === "replayed") {
    deps.say(`Stopping. The environment is ${result.phase}.`);
    return;
  }
  deps.say(`The stop was not applied (${result.status}${result.reason ? `: ${result.reason}` : ""}). Check /project and try again.`);
}

/** Runs one project command against the given dependencies. */
export async function runProjectCommand(verb: "project" | "activate" | "stop", args: string, deps: ProjectCommandDeps): Promise<void> {
  if (verb === "project") return listOrView(deps, args);
  if (verb === "activate") return activate(deps);
  return stop(deps);
}

function liveDeps(context: CommandContext): ProjectCommandDeps {
  return {
    facade: controlPlane(),
    current: currentEngagement,
    select: setCurrentEngagement,
    say: context.addSystemEvent,
  };
}

const project: Command = {
  name: "project",
  description: "List projects, or view one (viewing starts nothing)",
  argumentHint: "[name or id]",
  execute(args, context) {
    void runProjectCommand("project", args, liveDeps(context)).catch(error => context.addSystemEvent(`Project command failed: ${error instanceof Error ? error.message : "unknown error"}`));
  },
};

const activateCommand: Command = {
  name: "activate",
  description: "Start the viewed project's environment",
  execute(_args, context) {
    void runProjectCommand("activate", "", liveDeps(context)).catch(error => context.addSystemEvent(`Activation failed: ${error instanceof Error ? error.message : "unknown error"}`));
  },
};

const stopCommand: Command = {
  name: "stop",
  description: "Stop the viewed project's environment, if it holds the slot",
  execute(_args, context) {
    void runProjectCommand("stop", "", liveDeps(context)).catch(error => context.addSystemEvent(`Stop failed: ${error instanceof Error ? error.message : "unknown error"}`));
  },
};

export const projectCommands: Command[] = [project, activateCommand, stopCommand];
