import { readFileSync } from "node:fs";

const MIN_KEY_BYTES = 32;

/**
 * Mirrors adapters/runtime/token.ts's RAPTIX_RUNTIME_API_TOKEN_FILE pattern:
 * RAPTIX_SANDBOX_KEY_FILE names a file holding the HMAC key the retired
 * apps/web/server read the same way (config/sandbox-controller.ts). The
 * launcher derives each sandbox's token from the same key
 * (apps/launcher/internal/sandboxes/secrets.go) when it starts that sandbox.
 */
export function loadSandboxKey(keyFilePath: string | undefined): string | undefined {
  if (!keyFilePath) return undefined;
  const key = readFileSync(keyFilePath, "utf8").trim();
  if (key.length < MIN_KEY_BYTES) {
    throw new Error(`RAPTIX_SANDBOX_KEY_FILE key must be at least ${MIN_KEY_BYTES} bytes`);
  }
  return key;
}
