import Fastify, { type FastifyInstance } from "fastify";
import type { AuthStore } from "./db/auth-store.js";
import { handleError } from "./http/error-handler.js";
import { registerAuthRoutes } from "./http/routes/auth.routes.js";
import { registerHealthRoutes } from "./http/routes/health.routes.js";

export interface BuildAppOptions {
  authStore: AuthStore;
  sessionDurationHours: number;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.decorateRequest("operator", undefined);
  app.setErrorHandler(handleError);

  registerHealthRoutes(app);
  registerAuthRoutes(app, { store: options.authStore, sessionDurationHours: options.sessionDurationHours });

  return app;
}
