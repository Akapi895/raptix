/** GRAPH_CHECK_DATABASE_URL must point to a disposable database with migrations applied. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createDbClient } from "../../src/db/client.js";
import { PrismaProjectStore } from "../../src/db/project-store.js";
import { PrismaVaultStore } from "../../src/db/vault-store.js";
import { decryptSecret, loadVaultMasterKey } from "../../src/security/vault-crypto.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

const connectionString = process.env.GRAPH_CHECK_DATABASE_URL;
if (!connectionString) throw new Error("GRAPH_CHECK_DATABASE_URL is required (disposable database only)");
const db = createDbClient({ connectionString });
const projects = new PrismaProjectStore(db);
const runtime = new FakeRuntime();

const masterKeyHex = randomBytes(32).toString("hex");
const { writeFileSync, mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const keyDir = mkdtempSync(join(tmpdir(), "vault-key-"));
const keyFile = join(keyDir, "vault-master-key");
writeFileSync(keyFile, masterKeyHex);
const masterKey = loadVaultMasterKey(keyFile);
const vaultStore = new PrismaVaultStore(db, masterKey);

const internalToken = "live-check-internal-token".repeat(2);
const built = await buildAuthedTestApp({ projectStore: projects, runtime, vaultStore, webApiInternalToken: internalToken });
built.app.log.level = "silent";
const address = await built.app.listen({ host: "127.0.0.1", port: 0 });
const headers = { authorization: `Bearer ${built.token}`, "content-type": "application/json" };
const ids: string[] = [];

try {
  const [projectA, projectB] = await Promise.all(
    ["Vault A", "Vault B"].map(async (name) => {
      const response = await fetch(`${address}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name }) });
      assert.equal(response.status, 200);
      const project = (await response.json()) as { id: string };
      ids.push(project.id);
      return project;
    }),
  );

  // Store -> list is redacted -> reveal round-trips -> VaultAudit recorded.
  const store = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "found-password", plaintext: "Sup3rSecret!" }),
  });
  assert.equal(store.status, 200);
  const stored = (await store.json()) as { id: string };
  assert.ok(!("cipherText" in stored) && !("plaintext" in stored), "create response must not leak secret bytes");

  const list = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets`, { headers });
  const listBody = JSON.stringify(await list.json());
  assert.ok(!listBody.includes("Sup3rSecret!"), "list DTO must never contain plaintext");

  const reveal = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets/${stored.id}/reveal`, { method: "POST", headers, body: "{}" });
  assert.equal(reveal.status, 200);
  assert.equal(((await reveal.json()) as { plaintext: string }).plaintext, "Sup3rSecret!");

  const auditCount = await db.vaultAudit.count({ where: { secretId: stored.id, action: "reveal" } });
  assert.equal(auditCount, 1, "reveal must write exactly one VaultAudit row");

  // Cross-project reveal is denied.
  const crossProject = await fetch(`${address}/api/projects/${projectB.id}/vault/secrets/${stored.id}/reveal`, { method: "POST", headers, body: "{}" });
  assert.equal(crossProject.status, 404);

  // Revoke -> reveal-after-revoke never regenerates a value.
  const revoke = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets/${stored.id}`, { method: "DELETE", headers, body: "{}" });
  assert.equal(revoke.status, 200);
  const revealAfterRevoke = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets/${stored.id}/reveal`, { method: "POST", headers, body: "{}" });
  assert.equal(revealAfterRevoke.status, 404);

  // Stable key across independent loads of the same file ("restart").
  const keyAgain = loadVaultMasterKey(keyFile);
  const second = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "restart-check", plaintext: "survives-restart" }),
  });
  const secondStored = (await second.json()) as { id: string };
  const row = await db.vaultSecret.findUniqueOrThrow({ where: { id: secondStored.id } });
  assert.equal(decryptSecret(row.cipherText, keyAgain), "survives-restart", "a second independent key-file load still decrypts the row (no rotation on restart)");

  // Promote to global, then it's visible via the global listing.
  const promote = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets/${secondStored.id}/promote`, { method: "POST", headers, body: "{}" });
  assert.equal(promote.status, 200);
  const globalList = await fetch(`${address}/api/vault/global-secrets`, { headers });
  const globalBody = (await globalList.json()) as { secrets: Array<{ id: string }> };
  assert.ok(globalBody.secrets.some((s) => s.id === secondStored.id));

  // Session auth and internal auth are independent guards.
  const unauthenticated = await fetch(`${address}/api/projects/${projectA.id}/vault/secrets`, { headers: { "content-type": "application/json" } });
  assert.equal(unauthenticated.status, 401);

  // workspaceSlug is internal-only (never on the public wire) -- the internal caller only ever
  // knows it because the runtime itself set engagement_name/kg_engagement to it at dispatch time.
  const projectARow = await db.project.findUniqueOrThrow({ where: { id: projectA.id } });
  const internalStore = await fetch(`${address}/api/internal/vault/secrets`, {
    method: "POST",
    headers: { authorization: `Bearer ${internalToken}`, "content-type": "application/json" },
    body: JSON.stringify({ workspace_slug: projectARow.workspaceSlug, name: "agent-found", plaintext: "harvested" }),
  });
  assert.equal(internalStore.status, 200);
  assert.deepEqual(Object.keys(await internalStore.json()).sort(), ["name", "status", "vault_ref"]);

  const internalBadToken = await fetch(`${address}/api/internal/vault/secrets`, {
    method: "POST",
    headers: { authorization: "Bearer wrong-token-wrong-token-wrong-token", "content-type": "application/json" },
    body: JSON.stringify({ workspace_slug: "whatever", name: "x", plaintext: "y" }),
  });
  assert.equal(internalBadToken.status, 401);

  const internalNoToken = await fetch(`${address}/api/internal/vault/secrets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace_slug: "whatever", name: "x", plaintext: "y" }),
  });
  assert.equal(internalNoToken.status, 401);

  process.stdout.write(
    "Live HTTP + Postgres: vault store/list(redacted)/reveal(audited)/revoke/promote round-trip; cross-project and unauthenticated/internal-token-less calls refused\n",
  );
} finally {
  await built.app.close();
  await db.vaultAudit.deleteMany({ where: { projectId: { in: ids } } });
  await db.vaultSecret.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { sourceProjectId: { in: ids } }] } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
