import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./http/routes/health.routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  registerHealthRoutes(app);
  return app;
}
