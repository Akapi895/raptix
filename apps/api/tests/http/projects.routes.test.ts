import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxProvisionError } from "../../src/adapters/sandbox/controller.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeProjectStore } from "../support/fake-project-store.js";
import { FakeSandboxProvisioner } from "../support/fake-sandbox-provisioner.js";

describe("project routes", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/projects" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects create with no name", async () => {
    const response = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("creates, lists, reads, updates and deletes a project", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: auth(),
      payload: { name: "Lab Web Perimeter", description: "demo", scope_json: "{}" },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json();
    expect(created).toMatchObject({
      name: "Lab Web Perimeter",
      status: "active",
      pinned: false,
      conversation_count: 0,
      vulnerability_count: 0,
      asset_count: 0,
    });

    const list = await app.inject({ method: "GET", url: "/api/projects", headers: auth() });
    expect(list.json()).toMatchObject({ projects: [expect.objectContaining({ id: created.id })], total: 1, limit: 20, offset: 0 });

    const get = await app.inject({ method: "GET", url: `/api/projects/${created.id}`, headers: auth() });
    expect(get.statusCode).toBe(200);
    expect(get.json().id).toBe(created.id);

    const update = await app.inject({
      method: "PUT",
      url: `/api/projects/${created.id}`,
      headers: auth(),
      payload: { status: "archived", pinned: true },
    });
    expect(update.json()).toMatchObject({ status: "archived", pinned: true });

    const del = await app.inject({ method: "DELETE", url: `/api/projects/${created.id}`, headers: auth() });
    expect(del.json()).toEqual({ success: true });

    const getAfterDelete = await app.inject({ method: "GET", url: `/api/projects/${created.id}`, headers: auth() });
    expect(getAfterDelete.statusCode).toBe(404);
  });

  it("stats and conversations sub-resources are real, not fabricated", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;

    const stats = await app.inject({ method: "GET", url: `/api/projects/${id}/stats`, headers: auth() });
    expect(stats.json()).toEqual({
      fact_count: 0,
      vuln_count: 0,
      conversation_count: 0,
      asset_count: 0,
      vulnerability_stats: { total: 0, by_severity: {}, by_status: {} },
    });

    const conversations = await app.inject({ method: "GET", url: `/api/projects/${id}/conversations`, headers: auth() });
    expect(conversations.json()).toMatchObject({ conversations: [], total: 0 });
  });

  it("stats count the project's facts and vulnerability breakdown (T518 + vulnerability_stats)", async () => {
    const { FakeFactStore } = await import("../support/fake-fact-store.js");
    const { FakeVulnerabilityStore } = await import("../support/fake-vulnerability-store.js");
    const factStore = new FakeFactStore();
    const vulnerabilityStore = new FakeVulnerabilityStore();
    ({ app, token } = await buildAuthedTestApp({ factStore, vulnerabilityStore }));
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "a" } });
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "b" } });
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts/deprecate`, headers: auth(), payload: { fact_key: "b" } });
    await vulnerabilityStore.create({ projectId: id, title: "V1", severity: "high", status: "open" });
    await vulnerabilityStore.create({ projectId: id, title: "V2", severity: "low", status: "fixed" });

    const stats = await app.inject({ method: "GET", url: `/api/projects/${id}/stats`, headers: auth() });
    expect(stats.json()).toEqual({
      fact_count: 1,
      vuln_count: 2,
      conversation_count: 0,
      asset_count: 0,
      vulnerability_stats: {
        total: 2,
        by_severity: { high: 1, low: 1 },
        by_status: { open: 1, fixed: 1 },
      },
    });
  });

  it("dashboard-summary aggregates real counts across stores", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "a" } });
    await app.inject({ method: "POST", url: "/api/assets/import", headers: auth(), payload: { assets: [{ host: "h1", ip: "10.0.0.1" }], source: "manual" } });

    const summary = await app.inject({ method: "GET", url: "/api/projects/dashboard-summary?fact_limit=10", headers: auth() });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      active_projects: 1,
      total_facts: 1,
      totals: { projects: 1, conversations: 0, vulnerabilities: 0, assets: 1, open_vulnerabilities: 0 },
    });
    expect(summary.json().recent_facts).toHaveLength(1);
    expect(summary.json().recent_facts[0]).toMatchObject({ fact_key: "a", project_id: id });
  });

  it("fact CRUD works against the fact store, with wire aliases the Go backend used", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;

    const fact = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/facts`,
      headers: auth(),
      payload: { fact_key: "host.10.0.0.1", category: "host", summary: "nginx", body: "observed", confidence: "high" },
    });
    expect(fact.statusCode).toBe(200);
    expect(fact.json()).toMatchObject({ fact_key: "host.10.0.0.1", category: "host", confidence: "high", pinned: false, deprecated: false, incoming_links: 0 });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/facts`,
      headers: auth(),
      payload: { fact_key: "host.10.0.0.1" },
    });
    expect(duplicate.statusCode).toBe(409);

    const list = await app.inject({ method: "GET", url: `/api/projects/${id}/facts`, headers: auth() });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);
    expect(list.json()).toHaveLength(1);

    const factId = fact.json().id;
    const update = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}/facts/${factId}`,
      headers: auth(),
      payload: { confidence: "medium", pinned: true },
    });
    expect(update.json()).toMatchObject({ confidence: "medium", pinned: true });

    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${id}/facts/${factId}`, headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
    const missing = await app.inject({ method: "DELETE", url: `/api/projects/${id}/facts/${factId}`, headers: auth() });
    expect(missing.statusCode).toBe(404);
  });

  it("a single fact read carries incoming links as edge details plus link counts", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "src" } });
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "dst" } });
    const edge = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/fact-edges`,
      headers: auth(),
      payload: { source_fact_key: "src", target_fact_key: "dst", edge_type: "related" },
    });
    expect(edge.statusCode).toBe(200);
    expect(edge.json()).toMatchObject({
      source: "src", target: "dst", source_fact_key: "src", target_fact_key: "dst", type: "related", edge_type: "related", confidence: "medium",
    });

    const detail = await app.inject({ method: "GET", url: `/api/projects/${id}/facts?fact_key=dst`, headers: auth() });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      fact_key: "dst",
      incoming_links: [{ edge_type: "related", source_fact_key: "src" }],
      link_counts: { incoming: 1, outgoing: 0 },
    });

    const list = await app.inject({ method: "GET", url: `/api/projects/${id}/facts`, headers: auth() });
    const dst = list.json().find((f: { fact_key: string }) => f.fact_key === "dst");
    expect(dst.incoming_links).toBe(1);
  });

  it("an edge to a fact that does not exist is a 400, never a dangling row", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/fact-edges`,
      headers: auth(),
      payload: { source_fact_key: "nope", target_fact_key: "also-nope" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("nope");
  });

  it("deprecate/restore match fact keys and ids, and restore can downgrade confidence", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "a", confidence: "high" } });
    const b = (await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "b" } })).json();

    const deprecate = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/facts/deprecate`,
      headers: auth(),
      payload: { fact_keys: ["a"], ids: [b.id] },
    });
    expect(deprecate.json()).toEqual({ success: true });
    let list = await app.inject({ method: "GET", url: `/api/projects/${id}/facts`, headers: auth() });
    expect(list.json().every((f: { deprecated: boolean }) => f.deprecated)).toBe(true);

    // Excluded from the graph by default; included with exclude_deprecated=0.
    const graph = await app.inject({ method: "GET", url: `/api/projects/${id}/fact-graph`, headers: auth() });
    expect(graph.json().nodes).toHaveLength(0);
    const graphAll = await app.inject({ method: "GET", url: `/api/projects/${id}/fact-graph?exclude_deprecated=0`, headers: auth() });
    expect(graphAll.json().nodes).toHaveLength(2);

    const restore = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/facts/restore`,
      headers: auth(),
      payload: { fact_key: "a", confidence: "tentative" },
    });
    expect(restore.json()).toEqual({ success: true });
    list = await app.inject({ method: "GET", url: `/api/projects/${id}/facts?fact_key=a`, headers: auth() });
    expect(list.json()).toMatchObject({ deprecated: false, confidence: "tentative" });
  });

  it("deleting a fact removes its edges; the graph derives nodes from facts and edges from links", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "src", category: "host" } });
    await app.inject({ method: "POST", url: `/api/projects/${id}/facts`, headers: auth(), payload: { fact_key: "dst", category: "note" } });
    await app.inject({ method: "POST", url: `/api/projects/${id}/fact-edges`, headers: auth(), payload: { source_fact_key: "src", target_fact_key: "dst" } });

    const graph = await app.inject({ method: "GET", url: `/api/projects/${id}/fact-graph`, headers: auth() });
    expect(graph.json()).toEqual({
      nodes: [
        { id: "src", fact_key: "src", label: "src", summary: "", category: "host", type: "host", confidence: "medium", pinned: false },
        { id: "dst", fact_key: "dst", label: "dst", summary: "", category: "note", type: "note", confidence: "medium", pinned: false },
      ],
      edges: [{ id: expect.any(String), source: "src", target: "dst", type: "related", confidence: "medium" }],
    });

    const srcFact = (await app.inject({ method: "GET", url: `/api/projects/${id}/facts?fact_key=src`, headers: auth() })).json();
    await app.inject({ method: "DELETE", url: `/api/projects/${id}/facts/${srcFact.id}`, headers: auth() });
    const edgesAfter = await app.inject({ method: "GET", url: `/api/projects/${id}/fact-edges`, headers: auth() });
    expect(edgesAfter.json()).toEqual([]);
  });

  it("fact routes 404 for a project that does not exist", async () => {
    for (const [method, url] of [
      ["GET", "/api/projects/nope/facts"],
      ["POST", "/api/projects/nope/facts"],
      ["GET", "/api/projects/nope/fact-edges"],
      ["GET", "/api/projects/nope/fact-graph"],
    ] as const) {
      const response = await app.inject({ method, url, headers: auth(), payload: method === "POST" ? {} : undefined });
      expect(response.statusCode).toBe(404);
    }
  });

  it("creation provisions the project's sandbox before the row exists (ADR-0086 A)", async () => {
    const provisioner = new FakeSandboxProvisioner();
    ({ app, token } = await buildAuthedTestApp({ sandboxProvisioner: provisioner }));
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    expect(create.statusCode).toBe(200);
    expect(provisioner.ensured).toHaveLength(1);
    expect(provisioner.ensured[0]).toMatch(/^proj-[0-9a-f]{12}$/);
  });

  it("a failed sandbox start returns 503 and leaves no project", async () => {
    const provisioner = new FakeSandboxProvisioner();
    provisioner.failure = new SandboxProvisionError();
    const projectStore = new FakeProjectStore();
    ({ app, token } = await buildAuthedTestApp({ sandboxProvisioner: provisioner, projectStore }));
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    expect(create.statusCode).toBe(503);
    expect(create.json().error).toContain("sandbox could not be started");
    expect(provisioner.ensured).toHaveLength(1);
    expect((await projectStore.list({ limit: 20, offset: 0 })).total).toBe(0);
  });

  it("an unconfigured sandbox controller names its missing configuration in the 503", async () => {
    const { UnconfiguredSandboxProvisioner } = await import("../../src/adapters/sandbox/controller.js");
    ({ app, token } = await buildAuthedTestApp({ sandboxProvisioner: new UnconfiguredSandboxProvisioner() }));
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    expect(create.statusCode).toBe(503);
    expect(create.json().error).toContain("RAPTIX_SANDBOX_CONTROLLER_URL");
  });

  it("promote-attack-chain derives the chain into facts and edges, idempotently", async () => {
    const { FakeConversationStore } = await import("../support/fake-conversation-store.js");
    const { FakeLlm } = await import("../support/fake-llm.js");
    const { FakeRuntime } = await import("../support/fake-runtime.js");
    const llm = new FakeLlm();
    llm.response = JSON.stringify({
      nodes: [
        { id: "n1", type: "target", label: "Web app", risk_score: 0, tool_call_id: "call-1", metadata: {} },
        { id: "n2", type: "vulnerability", label: "No lockout on /admin", risk_score: 78, tool_call_id: "", metadata: { severity: "high" } },
      ],
      edges: [{ source: "n1", target: "n2" }],
    });
    const runtime = new FakeRuntime();
    runtime.stateValues = { messages: [{ type: "ai", content: "probe", tool_calls: [{ id: "call-1", name: "nmap", args: {} }] }] };
    const conversationStore = new FakeConversationStore();
    const conversation = await conversationStore.create({ title: "Recon", runtimeThreadId: "thread-1" });
    ({ app, token } = await buildAuthedTestApp({ llm, runtime, conversationStore }));
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;

    const first = await app.inject({ method: "POST", url: `/api/projects/${id}/promote-attack-chain/${conversation.id}`, headers: auth() });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ success: true, conversation_id: conversation.id, facts_created: 2, facts_updated: 0, edges_created: 1 });

    const facts = await app.inject({ method: "GET", url: `/api/projects/${id}/facts`, headers: auth() });
    const byKey = Object.fromEntries(facts.json().map((f: { fact_key: string }) => [f.fact_key, f]));
    expect(Object.keys(byKey)).toContain("chain/target/web.app");
    expect(byKey["chain/vulnerability/no.lockout.on.admin"]).toMatchObject({ confidence: "high", source_conversation_id: conversation.id });

    const second = await app.inject({ method: "POST", url: `/api/projects/${id}/promote-attack-chain/${conversation.id}`, headers: auth() });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ facts_created: 0, facts_updated: 2, edges_created: 0 });
    const factsAfter = await app.inject({ method: "GET", url: `/api/projects/${id}/facts`, headers: auth() });
    expect(factsAfter.json()).toHaveLength(2);
  });

  it("promote-attack-chain 404s for an unknown conversation without deriving", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    const response = await app.inject({ method: "POST", url: `/api/projects/${id}/promote-attack-chain/nope`, headers: auth() });
    expect(response.statusCode).toBe(404);
  });
});
