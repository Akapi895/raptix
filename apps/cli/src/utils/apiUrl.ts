/**
 * Resolve the LangGraph API base URL shared by every CLI HTTP surface.
 *
 * The compose stack publishes LangGraph on the host at
 * ``127.0.0.1:${LANGGRAPH_PORT:-2024}`` (see docker-compose.yml). Reading the
 * same ``LANGGRAPH_PORT`` here keeps the CLI pointed at the stack an operator
 * actually started — e.g. ``LANGGRAPH_PORT=2400`` in ``.env`` — instead of
 * silently dialing the 2024 default and failing with "Unable to connect".
 *
 * Precedence (first non-empty wins):
 *   1. ``RAPTIX_API_URL``  — explicit override (launcher, docker exec, CI, tests)
 *   2. ``http://localhost:${LANGGRAPH_PORT}`` — the compose-published port
 *   3. ``http://localhost:2024`` — upstream compose default
 *
 * Values are trimmed because ``.env`` is commonly authored on Windows (CRLF)
 * and the Makefile forwards the raw value.
 */
export function resolveApiUrl(): string {
  const explicit = process.env.RAPTIX_API_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const port = process.env.LANGGRAPH_PORT?.trim();
  if (port) {
    return `http://localhost:${port}`;
  }
  return "http://localhost:2024";
}

/**
 * The web control plane that serves the project facade. The CLI talks only to it. Precedence: RAPTIX_CONTROL_URL,
 * then WEB_API_PORT on localhost, then the compose default.
 */
export function resolveControlUrl(): string {
  const explicit = process.env.RAPTIX_CONTROL_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const port = process.env.WEB_API_PORT?.trim();
  return `http://127.0.0.1:${port || "8081"}`;
}
