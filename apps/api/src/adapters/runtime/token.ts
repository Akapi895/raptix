import { readFileSync } from "node:fs";

const MIN_TOKEN_BYTES = 32;

/**
 * Mirrors packages/raptix/raptix/interfaces/api/auth.py: the runtime refuses
 * every caller without this token, read from the file named by
 * RAPTIX_RUNTIME_API_TOKEN_FILE. Project sandboxes never receive it --
 * apps/api is the only process that may hold it, and apps/ui-app never does.
 */
export function loadRuntimeApiToken(tokenFilePath: string | undefined): string | undefined {
  if (!tokenFilePath) return undefined;
  const token = readFileSync(tokenFilePath, "utf8").trim();
  if (token.length < MIN_TOKEN_BYTES) {
    throw new Error(`RAPTIX_RUNTIME_API_TOKEN_FILE token must be at least ${MIN_TOKEN_BYTES} bytes`);
  }
  return token;
}
