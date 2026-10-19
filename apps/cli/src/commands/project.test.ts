import { describe, expect, it } from "vitest";
import type { EnvironmentCommandResult, EnvironmentStateView, ProjectSummary } from "../transport/facadeClient.js";
import { runProjectCommand, type ProjectCommandDeps } from "./project.js";

const projects: ProjectSummary[] = [
  { id: "eng-a", name: "alpha", workspaceSlug: "alpha", status: "draft" },
  { id: "eng-b", name: "bravo", workspaceSlug: "bravo", status: "draft" },
];

function state(id: string, overrides: { held?: boolean; own?: boolean; version?: number; observed?: EnvironmentStateView["environment"]["observedState"] } = {}): EnvironmentStateView {
  return {
    engagementId: id,
    environment: { observedState: overrides.observed ?? "stopped", desiredState: "stopped", generation: 1, observedAt: null },
    slot: { phase: overrides.held ? "ready" : "idle", version: overrides.version ?? 3, held: overrides.held ?? false, ownedByThisProject: overrides.own ?? false, activeEngagementId: overrides.own ? id : null },
  };
}

function deps(options: { current: string; states: Record<string, EnvironmentStateView>; result?: EnvironmentCommandResult }) {
  const lines: string[] = [];
  const commands: { id: string; body: unknown }[] = [];
  const selected: string[] = [];
  const facade = {
    listProjects: async () => projects,
    environment: async (id: string) => options.states[id] ?? state(id),
    environmentCommand: async (id: string, body: unknown) => {
      commands.push({ id, body });
      return options.result ?? { status: "accepted", phase: "starting", version: 4, commandId: "cmd-1" };
    },
  };
  const d: ProjectCommandDeps = { facade, current: async () => options.current, select: id => selected.push(id), say: line => lines.push(line) };
  return { d, lines, commands, selected };
}

describe("project commands", () => {
  it("lists every project with the viewed one marked and each state shown", async () => {
    const { d, lines } = deps({ current: "eng-a", states: { "eng-a": state("eng-a", { held: true, own: true }), "eng-b": state("eng-b") } });
    await runProjectCommand("project", "", d);
    expect(lines[0]).toMatch(/^\* alpha \(eng-a\): stopped, holds the active slot/);
    expect(lines[1]).toMatch(/^  bravo \(eng-b\): stopped, slot free/);
  });

  it("views a project by name without starting anything", async () => {
    const { d, commands, selected, lines } = deps({ current: "eng-a", states: {} });
    await runProjectCommand("project", "bravo", d);
    expect(selected).toEqual(["eng-b"]);
    expect(commands).toHaveLength(0);
    expect(lines[0]).toMatch(/Nothing was started/);
  });

  it("says so for an unknown project and changes nothing", async () => {
    const { d, selected, lines } = deps({ current: "eng-a", states: {} });
    await runProjectCommand("project", "zulu", d);
    expect(selected).toHaveLength(0);
    expect(lines[0]).toMatch(/No project matches/);
  });

  it("activates the viewed project when the slot is free, with the slot version it observed", async () => {
    const { d, commands, lines } = deps({ current: "eng-b", states: { "eng-b": state("eng-b", { version: 7 }) } });
    await runProjectCommand("activate", "", d);
    expect(commands[0]).toMatchObject({ id: "eng-b", body: { action: "activate", expectedVersion: 7 } });
    expect(lines[0]).toMatch(/Activating/);
  });

  it("does not stop another project to activate; it names the holder and shows the explicit steps", async () => {
    const { d, commands, lines } = deps({ current: "eng-b", states: { "eng-a": state("eng-a", { held: true, own: true }), "eng-b": state("eng-b", { held: true }) } });
    await runProjectCommand("activate", "", d);
    expect(commands).toHaveLength(0);
    expect(lines[0]).toMatch(/alpha is running. Use \/project alpha then \/stop, then \/activate here/);
  });

  it("refuses to activate when the holder is not visible, and names nothing", async () => {
    const { d, commands, lines } = deps({ current: "eng-b", states: { "eng-b": state("eng-b", { held: true }) } });
    await runProjectCommand("activate", "", d);
    expect(commands).toHaveLength(0);
    expect(lines.join(" ")).not.toMatch(/eng-a|alpha/);
  });

  it("stops only the viewed project when it holds the slot", async () => {
    const owned = deps({ current: "eng-a", states: { "eng-a": state("eng-a", { held: true, own: true, version: 5 }) } });
    await runProjectCommand("stop", "", owned.d);
    expect(owned.commands[0]).toMatchObject({ id: "eng-a", body: { action: "stop", expectedVersion: 5 } });

    const notOwner = deps({ current: "eng-b", states: { "eng-b": state("eng-b") } });
    await runProjectCommand("stop", "", notOwner.d);
    expect(notOwner.commands).toHaveLength(0);
    expect(notOwner.lines[0]).toMatch(/nothing to stop/);
  });

  it("reports a refused stop with its status instead of claiming success", async () => {
    const { d, lines } = deps({ current: "eng-a", states: { "eng-a": state("eng-a", { held: true, own: true }) }, result: { status: "stale", phase: "ready", version: 9, commandId: null, reason: "stale_version" } });
    await runProjectCommand("stop", "", d);
    expect(lines[0]).toMatch(/was not applied \(stale: stale_version\)/);
  });
});
