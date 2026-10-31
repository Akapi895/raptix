import { buildApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 8080);
const host = process.env.API_HOST ?? "127.0.0.1";

const app = buildApp();

app
  .listen({ port, host })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
