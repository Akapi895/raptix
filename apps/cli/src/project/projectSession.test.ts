import { describe, expect, it } from "vitest";
import type { EnvironmentStateView } from "../transport/facadeClient.js";
import { chooseProject, planActivation, verifyThreadForResume } from "./projectSession.js";

const view = (engagementId: string, overrides: Partial<EnvironmentStateView["slot"]> & { observedState?: EnvironmentStateView["environment"]["observedState"] } = {}): EnvironmentStateView => {
  const { observedState = "stopped", ...slot } = overrides;
  return {
    engagementId,
    environment: { observedState, desiredState: "stopped", generation: 1, observedAt: null },
    slot: { phase: "idle", version: 0, held: false, ownedByThisProject: false, activeEngagementId: null, ...slot },
  };
};

describe("planActivation", () => {
  it("activates directly when the slot is free", () => {
    expect(planActivation("eng-b", new Map([["eng-b", view("eng-b")]]))).toEqual({ kind: "activate", engagementId: "eng-b" });
  });

  it("activates directly when the target already holds the slot", () => {
    const states = new Map([["eng-b", view("eng-b", { phase: "ready", held: true, ownedByThisProject: true, activeEngagementId: "eng-b" })]]);
    expect(planActivation("eng-b", states)).toEqual({ kind: "activate", engagementId: "eng-b" });
  });

  it("offers stop-and-switch only for the project the caller can see as holding the slot", () => {
    const states = new Map([
      ["eng-a", view("eng-a", { phase: "ready", held: true, ownedByThisProject: true, activeEngagementId: "eng-a" })],
      ["eng-b", view("eng-b", { held: true })],
    ]);
    expect(planActivation("eng-b", states)).toEqual({ kind: "stop_then_activate", stopEngagementId: "eng-a", engagementId: "eng-b" });
  });

  it("reports busy and names nothing when the holder is not among the caller's own projects", () => {
    const states = new Map([["eng-b", view("eng-b", { held: true })]]);
    expect(planActivation("eng-b", states)).toEqual({ kind: "busy" });
  });
});

describe("verifyThreadForResume", () => {
  const ready = view("eng-a", { observedState: "ready", phase: "ready", held: true, ownedByThisProject: true, activeEngagementId: "eng-a" });

  it("refuses a conversation that belongs to another project before any history is shown", () => {
    expect(verifyThreadForResume("eng-b", "eng-a", ready)).toMatchObject({ ok: false, code: "thread_belongs_to_another_project" });
  });

  it("refuses a conversation whose project environment is not ready", () => {
    expect(verifyThreadForResume("eng-a", "eng-a", view("eng-a"))).toMatchObject({ ok: false, code: "environment_not_ready" });
    expect(verifyThreadForResume("eng-a", "eng-a", undefined)).toMatchObject({ ok: false, code: "environment_not_ready" });
  });

  it("allows the conversation of the viewed project when its environment is ready", () => {
    expect(verifyThreadForResume("eng-a", "eng-a", ready)).toEqual({ ok: true });
  });
});

describe("chooseProject", () => {
  const projects = [{ id: "eng-a", name: "alpha", workspaceSlug: "alpha", status: "draft" }, { id: "eng-b", name: "bravo", workspaceSlug: "bravo", status: "draft" }];
  const facadeWith = (holder: string | null) => ({
    listProjects: async () => projects,
    environment: async (id: string) => view(id, { held: holder !== null, ownedByThisProject: id === holder, phase: holder !== null ? "ready" : "idle" }),
  });

  it("reattaches to the project whose environment this caller holds", async () => {
    await expect(chooseProject(facadeWith("eng-b"))).resolves.toBe("eng-b");
  });

  it("falls back to the first visible project when nothing is held", async () => {
    await expect(chooseProject(facadeWith(null))).resolves.toBe("eng-a");
  });

  it("refuses to start without a project and says what to do", async () => {
    await expect(chooseProject({ listProjects: async () => [], environment: async () => view("x") })).rejects.toThrow(/Create one in the Web UI/);
  });
});
