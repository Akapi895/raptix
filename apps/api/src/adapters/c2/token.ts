/**
 * Mirrors the retired apps/web/server's config/sandbox-controller.ts-style
 * readSliver(): SLIVER_BRIDGE_URL + SLIVER_BRIDGE_TOKEN (32-512 chars),
 * loopback or `sliver-bridge` hostname allowed over plain HTTP, otherwise
 * HTTPS required.
 */
export interface C2BridgeConfig {
  apiUrl: string;
  apiKey: string;
}

const LAB_HOSTS = new Set(["sliver-bridge", "localhost", "127.0.0.1", "[::1]"]);

export function loadC2BridgeConfig(rawUrl: string | undefined, rawToken: string | undefined): C2BridgeConfig | undefined {
  if (!rawUrl && !rawToken) return undefined;
  if (!rawToken || rawToken.length < 32 || rawToken.length > 512 || rawToken.trim() !== rawToken || /[\r\n]/.test(rawToken)) {
    throw new Error("SLIVER_BRIDGE_TOKEN requires a private token of 32-512 characters");
  }
  let url: URL;
  try {
    url = new URL(rawUrl ?? "");
  } catch {
    throw new Error("SLIVER_BRIDGE_URL requires HTTPS or loopback/sliver-bridge lab HTTP, without credentials, path, query or fragment");
  }
  const isLab = url.protocol === "http:" && LAB_HOSTS.has(url.hostname);
  if ((url.protocol !== "https:" && !isLab) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SLIVER_BRIDGE_URL requires HTTPS or loopback/sliver-bridge lab HTTP, without credentials, path, query or fragment");
  }
  return { apiUrl: url.origin, apiKey: rawToken };
}
