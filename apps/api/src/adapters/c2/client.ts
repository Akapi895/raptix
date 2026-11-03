import { C2RejectedError, C2UnavailableError } from "./errors.js";
import type { C2BridgeConfig } from "./token.js";

const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * Port for the C2 bridge -- routes depend on this, never the concrete
 * client, mirroring RuntimeTransport/SandboxFilesTransport.
 */
export interface C2Transport {
  call(op: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Thin HTTP client for the private Sliver gRPC bridge, ported from the
 * retired apps/web/server's integrations/c2/sliver-client.ts: one endpoint
 * (`${apiUrl}/v1/c2`), one generic `{op, ...params}` JSON-RPC-shaped call,
 * Bearer auth. The bridge itself (a separate service translating these
 * ops into real Sliver gRPC calls) is unchanged by this port.
 */
export class C2BridgeClient implements C2Transport {
  public constructor(private readonly config: C2BridgeConfig) {}

  public async call(op: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutMs = op === "sessions.execute" ? 100_000 : 25_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL("/v1/c2", this.config.apiUrl), {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ op, ...params }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new C2RejectedError([400, 404, 409].includes(response.status) ? response.status : 503, "C2 operation was not confirmed");
      }
      if (!response.body) throw new C2UnavailableError("Empty C2 bridge response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new C2UnavailableError("C2 bridge response exceeded its limit");
        }
        chunks.push(chunk.value);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new C2UnavailableError("Invalid C2 bridge response");
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof C2RejectedError || error instanceof C2UnavailableError) throw error;
      throw new C2UnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Used when SLIVER_BRIDGE_URL/_TOKEN are not configured -- C2 read routes fail 503 instead of crashing startup. */
export class UnconfiguredC2Client implements C2Transport {
  public async call(): Promise<Record<string, unknown>> {
    throw new C2UnavailableError("SLIVER_BRIDGE_URL/SLIVER_BRIDGE_TOKEN are not configured for this deployment.");
  }
}
