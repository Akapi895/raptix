import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../../db/project-store.js";
import type { VaultSecretRecord, VaultStore } from "../../db/vault-store.js";
import { createRequireInternalToken } from "../plugins/internal-auth-guard.js";

export interface VaultInternalRoutesOptions {
  vaultStore: VaultStore;
  projectStore: ProjectStore;
  internalToken: string | undefined;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function toWire(secret: VaultSecretRecord): Record<string, unknown> {
  return { name: secret.name, kind: secret.kind, description: secret.description, revoked: secret.revokedAt !== null };
}

/**
 * Called only by the Python runtime's vault tools (execution/tools/vault/),
 * never by apps/ui-app. Keyed by workspace_slug, not projectId -- that is
 * the only identity the agent legitimately has (see
 * adapters/sandbox/routing.ts::runConfigurableFor, which sets both
 * engagement_name and kg_engagement to workspaceSlug). No route here
 * accepts scope=GLOBAL or a raw projectId: promotion to global is an
 * operator-only action via vault.routes.ts.
 */
export function registerVaultInternalRoutes(app: FastifyInstance, options: VaultInternalRoutesOptions): void {
  const { vaultStore, projectStore, internalToken } = options;
  const requireInternalToken = createRequireInternalToken(internalToken);

  app.post<{ Body: Record<string, unknown> }>(
    "/api/internal/vault/secrets",
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const workspaceSlug = asString(request.body?.workspace_slug);
      const name = asString(request.body?.name);
      const plaintext = asString(request.body?.plaintext);
      if (!workspaceSlug || !name || !plaintext) {
        await reply.code(400).send({ error: "workspace_slug, name and plaintext are required" });
        return;
      }
      const project = await projectStore.findByWorkspaceSlug(workspaceSlug);
      if (!project) {
        await reply.code(404).send({ error: "Unknown workspace_slug" });
        return;
      }
      const actor = asString(request.body?.actor) ?? `agent@${workspaceSlug}`;
      const existing = await vaultStore.findByProjectAndName(project.id, name);
      if (existing && !existing.revokedAt) {
        await vaultStore.revoke(existing.id, project.id, actor);
      }
      const secret = await vaultStore.create({
        projectId: project.id,
        name,
        description: asString(request.body?.description),
        kind: asString(request.body?.kind),
        plaintext,
        createdBy: actor,
      });
      await reply.send({ status: "stored", name: secret.name, vault_ref: `vault://${secret.id}` });
    },
  );

  app.get<{ Params: { workspaceSlug: string; name: string } }>(
    "/api/internal/vault/secrets/:workspaceSlug/:name",
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const project = await projectStore.findByWorkspaceSlug(request.params.workspaceSlug);
      if (!project) {
        await reply.code(404).send({ error: "Unknown workspace_slug" });
        return;
      }
      const secret = await vaultStore.findByProjectAndName(project.id, request.params.name);
      if (!secret) {
        await reply.code(404).send({ error: "Secret not found" });
        return;
      }
      const plaintext = await vaultStore.reveal(secret.id, project.id, {
        actor: `agent@${request.params.workspaceSlug}`,
        actorKind: "runtime",
      });
      if (plaintext === null) {
        await reply.code(404).send({ error: "Secret not found or revoked" });
        return;
      }
      await reply.send({ plaintext });
    },
  );

  app.get<{ Params: { workspaceSlug: string } }>(
    "/api/internal/vault/secrets/:workspaceSlug",
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const project = await projectStore.findByWorkspaceSlug(request.params.workspaceSlug);
      if (!project) {
        await reply.code(404).send({ error: "Unknown workspace_slug" });
        return;
      }
      const secrets = await vaultStore.listForProject(project.id);
      await reply.send({ secrets: secrets.map(toWire) });
    },
  );
}
