/** Explicit live check: GRAPH_CHECK_DATABASE_URL must point to a disposable DB with migrations applied. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDbClient } from "../../src/db/client.js";
import { PrismaFactStore } from "../../src/db/fact-store.js";
import { FactConflictError } from "../../src/db/fact-verification.js";
import { observationSnapshot } from "../../src/services/fact-promotion.js";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { RuntimeClient } from "../../src/adapters/runtime/client.js";
import { PrismaProjectStore } from "../../src/db/project-store.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";

const connectionString = process.env.GRAPH_CHECK_DATABASE_URL;
if (!connectionString) throw new Error("GRAPH_CHECK_DATABASE_URL is required (disposable database only)");
const db = createDbClient({ connectionString });
const store = new PrismaFactStore(db);
const project = await db.project.create({ data: { name: "Graph verification", workspaceSlug: `check-${randomUUID()}` } });
const other = await db.project.create({ data: { name: "Other graph verification", workspaceSlug: `check-${randomUUID()}` } });
try {
  const snapshot = observationSnapshot(project.workspaceSlug, { kind: "Host", key: "host::1", label: "Observed host", props: { observation_id: randomUUID(), provenance_channel: "tool_autoingest" } });
  const fact = await store.propose(project.id, { factKey: "finding/host", summary: "Host finding", body: "Reviewed detail" }, [snapshot], "operator");
  assert.equal((await store.evidence(project.id, fact.id)).evidence.length, 1);
  assert.equal(await store.findById(other.id, fact.id), null);
  const transitions = await Promise.allSettled([
    store.transition(project.id, fact.id, fact.revision, "verified", "operator", "Reviewed evidence"),
    store.transition(project.id, fact.id, fact.revision, "rejected", "operator", "Competing review"),
  ]);
  assert.equal(transitions.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(transitions.some(result => result.status === "rejected" && result.reason instanceof FactConflictError));
  const retained = await store.evidence(project.id, fact.id);
  assert.equal(JSON.parse(retained.evidence[0]!.snapshotJson).label, "Observed host");
  assert.equal(retained.history.length, 2);
  await assert.rejects(db.projectFactEvidence.create({ data: { ...snapshot, projectId: other.id, factId: fact.id } }));
  process.stdout.write("Live Postgres: atomic promotion, evidence retention, project FK and concurrent transitions passed\n");
  if (process.env.GRAPH_CHECK_RUNTIME_URL) {
    const runtime = new RuntimeClient({ apiUrl: process.env.GRAPH_CHECK_RUNTIME_URL, apiToken: "graph-check-runtime-token-0123456789abcdef" });
    const python = resolve(".venv/Scripts/python.exe");
    const seed = "import sys; from raptix.knowledge.graph.store import KGStore; s=KGStore.from_env(); s.record_observations([{'kind':'Vulnerability','key':'vuln::live','label':'Live observed issue','props':{'severity':'high'}}], engagement=sys.argv[1], created_by='recon', source_episode_id='scan-live', provenance_channel='tool_autoingest'); s.close()";
    execFileSync(python, ["-c", seed, project.workspaceSlug], { env: { ...process.env, RAPTIX_SKIP_BOOT: "1" } });
    const built = await buildAuthedTestApp({ runtime, factStore: store, projectStore: new PrismaProjectStore(db) });
    built.app.log.level = "silent";
    const address = await built.app.listen({ host: "127.0.0.1", port: 0 });
    const headers = { authorization: `Bearer ${built.token}`, "content-type": "application/json" };
    try {
      const candidates = await fetch(`${address}/api/projects/${project.id}/akg-candidates`, { headers });
      assert.equal(candidates.status, 200);
      const found = await candidates.json() as { nodes: { kind: string; key: string; snapshot_hash: string }[] };
      assert.equal(found.nodes.length, 1);
      const proposal = await fetch(`${address}/api/projects/${project.id}/facts/propose`, { method: "POST", headers, body: JSON.stringify({ fact_key: "finding/live", observations: found.nodes.map(({ kind, key, snapshot_hash }) => ({ kind, key, snapshot_hash })) }) });
      assert.equal(proposal.status, 200);
      const proposed = await proposal.json() as { id: string; revision: number };
      const verify = await fetch(`${address}/api/projects/${project.id}/facts/${proposed.id}/promote`, { method: "POST", headers, body: JSON.stringify({ verification_state: "verified", expected_revision: proposed.revision }) });
      assert.equal(verify.status, 200);
      const foreign = await fetch(`${address}/api/projects/${other.id}/facts/${proposed.id}/evidence`, { headers });
      assert.equal(foreign.status, 404);
      process.stdout.write("Live HTTP: BFF -> authenticated Python -> Neo4j -> proposal -> Postgres -> verification passed\n");
    } finally { await built.app.close(); }
  }
} finally {
  await db.project.deleteMany({ where: { id: { in: [project.id, other.id] } } });
  await db.$disconnect();
}
