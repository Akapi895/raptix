import { readFileSync } from "node:fs";

const MIN_KEY_BYTES = 32;

/**
 * Mirrors adapters/runtime/token.ts's RAPTIX_RUNTIME_API_TOKEN_FILE pattern:
 * RAPTIX_SANDBOX_KEY_FILE names a file holding the HMAC key the retired
 * apps/web/server read the same way (config/sandbox-controller.ts). The
 * launcher derives each sandbox's token from the same key
 * (apps/launcher/internal/sandboxes/secrets.go) when it starts that sandbox.
 * An inline RAPTIX_SANDBOX_KEY is the accepted fallback for deployments that
 * run the API through docker compose without a secrets bind mount -- the
 * same trust domain compose's other secrets already live in; the file form
 * remains the recommended one.
 */
export function loadSandboxKey(keyFilePath: string | undefined, inlineKey?: string): string | undefined {
  if (!keyFilePath) return validatedInline("RAPTIX_SANDBOX_KEY", inlineKey);
  const key = readFileSync(keyFilePath, "utf8").trim();
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(`RAPTIX_SANDBOX_KEY_FILE key must be at least ${MIN_KEY_BYTES} bytes`);
  }
  return key;
}

/**
 * RAPTIX_SANDBOX_CONTROLLER_TOKEN_FILE names a file holding the bearer token
 * that authenticates apps/api to the host sandbox controller
 * (`raptix web sandboxes start`, apps/launcher/internal/sandboxes). Only
 * apps/api holds it; the controller compares it constant-time. An inline
 * RAPTIX_SANDBOX_CONTROLLER_TOKEN is the accepted fallback for deployments
 * that run the API through docker compose without a secrets bind mount.
 */
export function loadSandboxControllerToken(
  tokenFilePath: string | undefined,
  inlineToken?: string,
): string | undefined {
  if (!tokenFilePath) return validatedInline("RAPTIX_SANDBOX_CONTROLLER_TOKEN", inlineToken);
  const token = readFileSync(tokenFilePath, "utf8").trim();
  if (token.length < MIN_KEY_BYTES) {
    throw new Error(`RAPTIX_SANDBOX_CONTROLLER_TOKEN_FILE token must be at least ${MIN_KEY_BYTES} bytes`);
  }
  return token;
}

function validatedInline(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length < MIN_KEY_BYTES) {
    throw new Error(`${name} must be at least ${MIN_KEY_BYTES} bytes`);
  }
  return value;
}
