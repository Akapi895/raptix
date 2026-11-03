import type { FastifyInstance } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { ProjectStore } from "../../db/project-store.js";
import type { VaultSecretRecord, VaultStore } from "../../db/vault-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface VaultRoutesOptions {
  authStore: AuthStore;
  vaultStore: VaultStore;
  projectStore: ProjectStore;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Never includes cipherText or plaintext -- redacted by construction (VaultSecretRecord has no such field). */
function toWire(secret: VaultSecretRecord): Record<string, unknown> {
  return {
    id: secret.id,
    project_id: secret.projectId,
    scope: secret.scope,
    name: secret.name,
    description: secret.description,
    kind: secret.kind,
    source_project_id: secret.sourceProjectId,
    revoked_at: secret.revokedAt?.toISOString() ?? null,
    created_at: secret.createdAt.toISOString(),
    updated_at: secret.updatedAt.toISOString(),
    created_by: secret.createdBy,
  };
}

export function registerVaultRoutes(app: FastifyInstance, options: VaultRoutesOptions): void {
  const { authStore, vaultStore, projectStore } = options;
  const requireSession = createRequireSession(authStore);

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/vault/secrets",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.findById(request.params.projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      const secrets = await vaultStore.listForProject(project.id);
      await reply.send({ secrets: secrets.map(toWire) });
    },
  );

  app.post<{ Params: { projectId: string }; Body: Record<string, unknown> }>(
    "/api/projects/:projectId/vault/secrets",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.findById(request.params.projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      const name = asString(request.body?.name);
      const plaintext = asString(request.body?.plaintext);
      if (!name || !plaintext) {
        await reply.code(400).send({ error: "name and plaintext are required" });
        return;
      }
      const secret = await vaultStore.create({
        projectId: project.id,
        name,
        description: asString(request.body?.description),
        kind: asString(request.body?.kind),
        plaintext,
        createdBy: request.operator?.username ?? "",
      });
      await reply.send(toWire(secret));
    },
  );

  app.post<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/vault/secrets/:id/reveal",
    { preHandler: requireSession },
    async (request, reply) => {
      const plaintext = await vaultStore.reveal(request.params.id, request.params.projectId, {
        actor: request.operator?.username ?? "",
        actorKind: "operator",
      });
      if (plaintext === null) {
        await reply.code(404).send({ error: "Secret not found or revoked" });
        return;
      }
      await reply.send({ plaintext });
    },
  );

  app.delete<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/vault/secrets/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const revoked = await vaultStore.revoke(request.params.id, request.params.projectId, request.operator?.username ?? "");
      if (!revoked) {
        await reply.code(404).send({ error: "Secret not found or already revoked" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.post<{ Params: { projectId: string; id: string } }>(
    "/api/projects/:projectId/vault/secrets/:id/promote",
    { preHandler: requireSession },
    async (request, reply) => {
      const secrets = await vaultStore.listForProject(request.params.projectId);
      if (!secrets.some((secret) => secret.id === request.params.id)) {
        await reply.code(404).send({ error: "Secret not found in this project" });
        return;
      }
      const promoted = await vaultStore.promoteToGlobal(request.params.id, request.operator?.username ?? "");
      if (!promoted) {
        await reply.code(404).send({ error: "Secret not found, revoked, or already global" });
        return;
      }
      await reply.send(toWire(promoted));
    },
  );

  app.get("/api/vault/global-secrets", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send({ secrets: (await vaultStore.listGlobal()).map(toWire) });
  });
}
