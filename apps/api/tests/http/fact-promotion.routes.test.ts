import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("project graph promotion", () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  async function setup() {
    const runtime = new FakeRuntime();
    const built = await buildAuthedTestApp({ runtime });
    app = built.app;
    app.log.level = "silent";
    const headers = { authorization: `Bearer ${built.token}` };
    const project = await built.options.projectStore.create({ name: "Graph", workspaceSlug: "graph-project" });
    runtime.graphResponses.set(project.workspaceSlug, { nodes: [{ kind: "Vulnerability", key: "vuln::one", label: "Observed issue", props: { observation_id: "obs-1", provenance_channel: "tool_autoingest", severity: "high" } }], edges: [], truncated: false });
    return { ...built, runtime, headers, project };
  }

  it("retains reviewed evidence after runtime reset and rejects stale verification", async () => {
    const { headers, project, runtime } = await setup();
    const candidates = await app.inject({ method: "GET", url: `/api/projects/${project.id}/akg-candidates`, headers });
    expect(candidates.statusCode).toBe(200);
    const candidate = candidates.json().nodes[0];
    const proposal = await app.inject({ method: "POST", url: `/api/projects/${project.id}/facts/propose`, headers, payload: { fact_key: "finding/one", observations: [{ kind: candidate.kind, key: candidate.key, snapshot_hash: candidate.snapshot_hash }] } });
    expect(proposal.statusCode).toBe(200);
    const fact = proposal.json();
    runtime.graphResponses.clear();
    const verified = await app.inject({ method: "POST", url: `/api/projects/${project.id}/facts/${fact.id}/promote`, headers, payload: { verification_state: "verified", expected_revision: fact.revision } });
    expect(verified.statusCode).toBe(200);
    const conflict = await app.inject({ method: "POST", url: `/api/projects/${project.id}/facts/${fact.id}/promote`, headers, payload: { verification_state: "rejected", expected_revision: fact.revision } });
    expect(conflict.statusCode).toBe(409);
    const retained = await app.inject({ method: "GET", url: `/api/projects/${project.id}/facts/${fact.id}/evidence`, headers });
    expect(JSON.parse(retained.json().evidence[0].snapshotJson).label).toBe("Observed issue");
    expect(retained.json().history.map((event: { toState: string }) => event.toState)).toEqual(["verified", "proposed"]);
  });

  it("resolves scope from the project and refuses another project's observation", async () => {
    const { headers, project, options, runtime } = await setup();
    const other = await options.projectStore.create({ name: "Other", workspaceSlug: "other-project" });
    const response = await app.inject({ method: "GET", url: `/api/projects/${other.id}/akg-candidates?engagement=${project.workspaceSlug}`, headers });
    expect(response.json().nodes).toEqual([]);
    expect(runtime.graphQueries.at(-1)?.engagement).toBe(other.workspaceSlug);
    const attempt = await app.inject({ method: "POST", url: `/api/projects/${other.id}/facts/propose`, headers, payload: { fact_key: "foreign", observations: [{ kind: "Vulnerability", key: "vuln::one", snapshot_hash: "0".repeat(64) }] } });
    expect(attempt.statusCode).toBe(404);
  });

  it("rejects evidence that changed since the operator retrieved it", async () => {
    const { headers, project } = await setup();
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/facts/propose`, headers, payload: { fact_key: "changed", observations: [{ kind: "Vulnerability", key: "vuln::one", snapshot_hash: "0".repeat(64) }] } });
    expect(response.statusCode).toBe(409);
  });
});
