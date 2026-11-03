import { readFileSync } from "node:fs";

const MIN_TOKEN_BYTES = 32;

/**
 * Mirrors loadRuntimeApiToken, in the reverse direction: the web API refuses
 * every internal-vault caller without this token, read from the file named
 * by RAPTIX_WEB_API_INTERNAL_TOKEN_FILE. The runtime (langgraph) presents
 * the same file's contents as a bearer token; apps/ui-app never holds it.
 */
export function loadWebApiInternalToken(tokenFilePath: string | undefined): string | undefined {
  if (!tokenFilePath) return undefined;
  const token = readFileSync(tokenFilePath, "utf8").trim();
  if (token.length < MIN_TOKEN_BYTES) {
    throw new Error(`RAPTIX_WEB_API_INTERNAL_TOKEN_FILE token must be at least ${MIN_TOKEN_BYTES} bytes`);
  }
  return token;
}
