import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SandboxFilesTransport } from "../../adapters/sandbox/client.js";
import { SandboxInvalidPathError, SandboxUnavailableError } from "../../adapters/sandbox/errors.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { ProjectStore } from "../../db/project-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface FileRoutesOptions {
  authStore: AuthStore;
  projectStore: ProjectStore;
  conversationStore: ConversationStore;
  sandbox: SandboxFilesTransport;
}

/**
 * CyberStrikeAI's chat-uploads feature is one global file tree; a `path`
 * alone (no project/conversation) identifies a file. Raptix has no global
 * project-spanning tree -- files live only in each project's own sandbox
 * (ADR-0102) -- so every `path` here is `<projectId>/<relativePathInThatSandbox>`.
 * This is a deliberate deviation from the upstream contract's assumption,
 * not an oversight; apps/ui-app's own `path` values are opaque strings it
 * round-trips, so prefixing them is compatible with how it already works.
 */
function splitProjectPath(path: string): { projectId: string; rel: string } {
  const slash = path.indexOf("/");
  if (slash <= 0) return { projectId: path, rel: "" };
  return { projectId: path.slice(0, slash), rel: path.slice(slash + 1) };
}

async function resolveProject(
  projectStore: ProjectStore,
  conversationStore: ConversationStore,
  args: { projectId?: string; conversationId?: string },
) {
  if (args.projectId) return projectStore.findById(args.projectId);
  if (args.conversationId) {
    const conversation = await conversationStore.findById(args.conversationId);
    if (!conversation?.projectId) return null;
    return projectStore.findById(conversation.projectId);
  }
  return null;
}

async function sendSandboxError(reply: FastifyReply, error: unknown): Promise<void> {
  if (error instanceof SandboxInvalidPathError) {
    await reply.code(400).send({ error: error.message });
    return;
  }
  if (error instanceof SandboxUnavailableError) {
    await reply.code(503).send({ error: error.message });
    return;
  }
  throw error;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

export function registerFileRoutes(app: FastifyInstance, options: FileRoutesOptions): void {
  const { authStore, projectStore, conversationStore, sandbox } = options;
  const requireSession = createRequireSession(authStore);

  async function listEntries(
    reply: FastifyReply,
    projectId: string,
    workspaceSlug: string,
    rel: string,
  ): Promise<void> {
    try {
      const entries = await sandbox.list(workspaceSlug, rel);
      if (entries === null) {
        await reply.send({ files: [], folders: [] });
        return;
      }
      const files = entries
        .filter((entry) => !entry.isDirectory)
        .map((entry) => ({
          relativePath: `${projectId}/${rel ? `${rel}/` : ""}${entry.name}`,
          name: entry.name,
        }));
      const folders = entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
      await reply.send({ files, folders });
    } catch (error) {
      await sendSandboxError(reply, error);
    }
  }

  app.get<{ Querystring: { project?: string; conversation?: string; path?: string } }>(
    "/api/chat-uploads",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await resolveProject(projectStore, conversationStore, {
        projectId: request.query.project,
        conversationId: request.query.conversation,
      });
      if (!project) {
        await reply.code(400).send({ error: "Files require a project (ADR-0086 A: sandboxes are per-project)." });
        return;
      }
      await listEntries(reply, project.id, project.workspaceSlug, "");
    },
  );

  app.get<{ Querystring: { project?: string; conversation?: string } }>(
    "/api/chat-uploads/export",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await resolveProject(projectStore, conversationStore, {
        projectId: request.query.project,
        conversationId: request.query.conversation,
      });
      if (!project) {
        await reply.code(400).send({ error: "Files require a project (ADR-0086 A: sandboxes are per-project)." });
        return;
      }
      await listEntries(reply, project.id, project.workspaceSlug, "");
    },
  );

  app.get<{ Querystring: { kind?: string; path?: string } }>(
    "/api/chat-uploads/path",
    { preHandler: requireSession },
    async (request, reply) => {
      const path = asString(request.query.path);
      if (!path) {
        await reply.code(400).send({ error: "Invalid request" });
        return;
      }
      const { projectId, rel } = splitProjectPath(path);
      const project = await projectStore.findById(projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await listEntries(reply, project.id, project.workspaceSlug, rel);
    },
  );

  app.delete<{ Body: { path?: unknown } }>("/api/chat-uploads", { preHandler: requireSession }, async (request, reply) => {
    const path = asString(request.body?.path);
    if (!path) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }
    const { projectId, rel } = splitProjectPath(path);
    const project = await projectStore.findById(projectId);
    if (!project) {
      await reply.code(404).send({ error: "Project not found" });
      return;
    }
    try {
      await sandbox.remove(project.workspaceSlug, rel);
      await reply.send({ ok: true });
    } catch (error) {
      await sendSandboxError(reply, error);
    }
  });

  app.get<{ Querystring: { path?: string } }>(
    "/api/chat-uploads/download",
    { preHandler: requireSession },
    async (request, reply) => {
      const path = asString(request.query.path);
      if (!path) {
        await reply.code(400).send({ error: "Invalid request" });
        return;
      }
      const { projectId, rel } = splitProjectPath(path);
      const project = await projectStore.findById(projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      try {
        const data = await sandbox.read(project.workspaceSlug, rel);
        if (data === null) {
          await reply.code(404).send({ error: "File not found" });
          return;
        }
        await reply.type("application/octet-stream").send(data);
      } catch (error) {
        await sendSandboxError(reply, error);
      }
    },
  );

  app.get<{ Querystring: { path?: string } }>(
    "/api/chat-uploads/content",
    { preHandler: requireSession },
    async (request, reply) => {
      const path = asString(request.query.path);
      if (!path) {
        await reply.code(400).send({ error: "Invalid request" });
        return;
      }
      const { projectId, rel } = splitProjectPath(path);
      const project = await projectStore.findById(projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      try {
        const data = await sandbox.read(project.workspaceSlug, rel);
        if (data === null) {
          await reply.code(404).send({ error: "File not found" });
          return;
        }
        await reply.send({ content: data.toString("utf8") });
      } catch (error) {
        await sendSandboxError(reply, error);
      }
    },
  );

  app.put<{ Body: { path?: unknown; content?: unknown } }>(
    "/api/chat-uploads/content",
    { preHandler: requireSession },
    async (request, reply) => {
      const path = asString(request.body?.path);
      const content = typeof request.body?.content === "string" ? request.body.content : undefined;
      if (!path || content === undefined) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const { projectId, rel } = splitProjectPath(path);
      const project = await projectStore.findById(projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      try {
        await sandbox.write(project.workspaceSlug, rel, Buffer.from(content, "utf8"));
        await reply.send({ ok: true });
      } catch (error) {
        await sendSandboxError(reply, error);
      }
    },
  );

  app.put<{ Body: { path?: unknown; newName?: unknown } }>(
    "/api/chat-uploads/rename",
    { preHandler: requireSession },
    async (request, reply) => {
      const path = asString(request.body?.path);
      const newName = asString(request.body?.newName);
      if (!path || !newName) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const { projectId, rel } = splitProjectPath(path);
      const project = await projectStore.findById(projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const to = dir ? `${dir}/${newName}` : newName;
      try {
        await sandbox.rename(project.workspaceSlug, rel, to);
        await reply.send({ ok: true });
      } catch (error) {
        await sendSandboxError(reply, error);
      }
    },
  );

  app.post<{ Body: { parent?: unknown; name?: unknown } }>(
    "/api/chat-uploads/mkdir",
    { preHandler: requireSession },
    async (request, reply) => {
      const parent = asString(request.body?.parent) ?? "";
      const name = asString(request.body?.name);
      if (!parent || !name) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const { projectId, rel } = splitProjectPath(parent);
      const project = await projectStore.findById(projectId);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      try {
        await sandbox.mkdir(project.workspaceSlug, rel ? `${rel}/${name}` : name);
        await reply.send({ ok: true });
      } catch (error) {
        await sendSandboxError(reply, error);
      }
    },
  );

  async function handleUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.isMultipart()) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }
    let fileName: string | undefined;
    let fileData: Buffer | undefined;
    let relativeDir: string | undefined;
    let conversationId: string | undefined;
    // @fastify/multipart's part iterator hangs on the next part until the current file
    // stream is drained -- buffer it immediately rather than holding the live MultipartFile.
    for await (const part of request.parts()) {
      if (part.type === "file" && part.fieldname === "file") {
        fileName = part.filename;
        fileData = await part.toBuffer();
      } else if (part.type === "field" && part.fieldname === "relativeDir") {
        relativeDir = part.value as string;
      } else if (part.type === "field" && part.fieldname === "conversationId") {
        conversationId = part.value as string;
      }
    }
    if (!fileName || !fileData) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }

    let projectId: string | undefined;
    let rel: string;
    if (relativeDir) {
      ({ projectId, rel } = splitProjectPath(relativeDir));
      rel = rel ? `${rel}/${fileName}` : fileName;
    } else if (conversationId) {
      const conversation = await conversationStore.findById(conversationId);
      projectId = conversation?.projectId ?? undefined;
      rel = `uploads/${conversationId}/${fileName}`;
    } else {
      await reply.code(400).send({ error: "Files require a project (ADR-0086 A: sandboxes are per-project)." });
      return;
    }
    const project = projectId ? await projectStore.findById(projectId) : null;
    if (!project) {
      await reply.code(400).send({ error: "Files require a project (ADR-0086 A: sandboxes are per-project)." });
      return;
    }
    try {
      await sandbox.write(project.workspaceSlug, rel, fileData);
      await reply.send({ files: [{ relativePath: `${project.id}/${rel}`, name: fileName, size: fileData.length }], folders: [] });
    } catch (error) {
      await sendSandboxError(reply, error);
    }
  }

  app.post("/api/chat-uploads", { preHandler: requireSession }, handleUpload);
  // Mock-only aliases in apps/ui-app (no real frontend caller found, src/mock/routes/platform.ts only).
  // No project/conversation query param to resolve a sandbox from, so there is nothing to list.
  app.get("/api/files", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send({ files: [], folders: [] });
  });
  app.post("/api/files/upload", { preHandler: requireSession }, handleUpload);
}
