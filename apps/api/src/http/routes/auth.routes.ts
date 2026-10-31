import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import { hashPassword, verifyPassword } from "../../security/password.js";
import { buildSessionPayload, generateSessionToken } from "../../security/session.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface AuthRoutesOptions {
  store: AuthStore;
  sessionDurationHours: number;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

interface ChangePasswordBody {
  oldPassword?: unknown;
  newPassword?: unknown;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** Robots and bindings (wechat-robot): no Raptix equivalent, cut candidate pending the owner's call (ADR-0106 §2/§7). */
async function notImplementedForThisDeployment(_request: unknown, reply: FastifyReply): Promise<void> {
  await reply.code(501).send({ error: "Not implemented for this deployment" });
}

/** Everything under apps/ui-app/docs/api-contracts.md's "Authentication and account" module (7 ops). */
export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const { store, sessionDurationHours } = options;
  const requireSession = createRequireSession(store);

  app.post<{ Body: LoginBody }>("/api/auth/login", async (request, reply) => {
    const username = asString(request.body?.username);
    const password = asString(request.body?.password);
    if (!username || !password) {
      await reply.code(400).send({ error: "Password is required" });
      return;
    }

    const operator = await store.findOperatorByUsername(username);
    if (!operator || !verifyPassword(password, operator.passwordHash)) {
      await reply.code(401).send({ error: "Incorrect password" });
      return;
    }

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + sessionDurationHours * 3_600_000);
    await store.createSession({ token, operatorId: operator.id, expiresAt });
    await reply.send(buildSessionPayload({ token, expiresAt, sessionDurationHours, operator }));
  });

  app.get("/api/auth/validate", { preHandler: requireSession }, async (request, reply) => {
    const operator = request.operator;
    const token = request.headers.authorization?.slice("Bearer ".length);
    if (!operator || !token) return; // requireSession already replied 401

    const session = await store.findSession(token);
    if (!session) {
      await reply.code(401).send({ error: "Invalid session" });
      return;
    }
    await reply.send(
      buildSessionPayload({ token, expiresAt: session.expiresAt, sessionDurationHours, operator }),
    );
  });

  app.post("/api/auth/logout", { preHandler: requireSession }, async (request, reply) => {
    const token = request.headers.authorization?.slice("Bearer ".length);
    if (token) await store.deleteSession(token);
    await reply.send({ message: "Signed out" });
  });

  app.post<{ Body: ChangePasswordBody }>(
    "/api/auth/change-password",
    { preHandler: requireSession },
    async (request, reply) => {
      const operator = request.operator;
      if (!operator) return; // requireSession already replied 401

      const oldPassword = asString(request.body?.oldPassword);
      const newPassword = asString(request.body?.newPassword);
      if (!oldPassword || !newPassword) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }

      const current = await store.findOperatorById(operator.id);
      if (!current || !verifyPassword(oldPassword, current.passwordHash)) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }

      await store.updateOperatorPassword(operator.id, hashPassword(newPassword));
      await reply.send({ message: "Password changed" });
    },
  );

  app.post("/api/auth/robot-binding-code", { preHandler: requireSession }, notImplementedForThisDeployment);
  app.get("/api/auth/robot-bindings", { preHandler: requireSession }, notImplementedForThisDeployment);
  app.delete("/api/auth/robot-bindings/:id", { preHandler: requireSession }, notImplementedForThisDeployment);
}
