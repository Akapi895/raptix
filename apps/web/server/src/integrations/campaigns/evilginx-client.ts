/** Read credential-free lab artifacts through the typed evilginx2 bridge. */
import { createHash } from 'node:crypto';
export interface EvilginxBridgeConfig { readonly apiUrl: string; readonly apiKey: string }
export interface EvilginxManifest {
  provider: 'evilginx2'; phishlet: string; lureId: number; url: string;
  providerId: string; providerStatus: 'enabled' | 'disabled'; version: number; fingerprint: string;
}
export class EvilginxBridgeError extends Error {
  public constructor() { super('Evilginx lab bridge operation was not confirmed'); this.name = 'EvilginxBridgeError'; }
}
export class EvilginxClient {
  public constructor(private readonly config: EvilginxBridgeConfig) {}
  public async operate(engagementId: string, campaignId: string, version: number, operation: 'prepare' | 'deploy' | 'inspect'): Promise<EvilginxManifest> {
    try {
      const response = await fetch(new URL('/v1/campaigns', this.config.apiUrl), {
        method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, campaignId, version, operation }), redirect: 'manual', signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new EvilginxBridgeError(); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16384) { await reader.cancel(); throw new EvilginxBridgeError(); }
        chunks.push(chunk.value);
      }
      const manifest: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof manifest !== 'object' || manifest === null) throw new EvilginxBridgeError();
      const raw = manifest as Record<string, unknown>;
      const label = createHash('sha256').update(JSON.stringify([engagementId, campaignId, version])).digest('hex').slice(0, 20);
      if (raw.provider !== 'evilginx2' || raw.phishlet !== `lab:${label}` ||
          typeof raw.lureId !== 'number' || !Number.isSafeInteger(raw.lureId) || raw.lureId < 0 ||
          raw.providerId !== `${raw.phishlet}:${raw.lureId}` || !['enabled', 'disabled'].includes(String(raw.providerStatus)) ||
          raw.version !== version || typeof raw.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.fingerprint) || typeof raw.url !== 'string') throw new EvilginxBridgeError();
      const url = new URL(raw.url);
      if (url.protocol !== 'https:' || url.hostname !== `login.${raw.phishlet.slice(4)}.lab.test` || url.port !== '8443' || url.username || url.password || url.search || url.hash) throw new EvilginxBridgeError();
      return { provider: 'evilginx2', phishlet: raw.phishlet, lureId: raw.lureId, url: raw.url, providerId: raw.providerId as string,
        providerStatus: raw.providerStatus as 'enabled' | 'disabled', version, fingerprint: raw.fingerprint };
    } catch (error) {
      if (error instanceof EvilginxBridgeError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof DOMException) throw new EvilginxBridgeError();
      throw error;
    }
  }
}
