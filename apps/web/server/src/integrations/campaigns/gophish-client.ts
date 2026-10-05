/** Read native GoPhish assets into a credential-free preparation manifest. */
import { createHash } from 'node:crypto';

export interface GoPhishConfig { readonly apiUrl: string; readonly apiKey: string; readonly labDeployment?: boolean }
export interface GoPhishAssets { templateId: number; pageId: number; groupId: number; smtpId: number }
export interface GoPhishManifest {
  provider: 'gophish';
  assets: Array<{ kind: 'templates' | 'pages' | 'groups' | 'smtp'; id: number; name: string }>;
  recipientCount: number;
  fingerprint: string;
}
type NativeAsset = Record<string, unknown> & { id: number; name: string };
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export class GoPhishError extends Error {
  public constructor(message: string, public readonly uncertain = false) { super(message); this.name = 'GoPhishError'; }
}

export interface GoPhishOutcome { providerId: string; providerStatus: string; total: number; sent: number; errors: number }

export class GoPhishClient {
  public constructor(private readonly config: GoPhishConfig) {}
  public get canDeploy(): boolean { return this.config.labDeployment === true; }

  public async prepare(selection: GoPhishAssets): Promise<GoPhishManifest> {
    const refs = [
      { kind: 'templates', id: selection.templateId }, { kind: 'pages', id: selection.pageId },
      { kind: 'groups', id: selection.groupId }, { kind: 'smtp', id: selection.smtpId },
    ] as const;
    const native = await Promise.all(refs.map(ref => this.read(ref.kind, ref.id)));
    const [template, page, group, smtp] = native;
    if (!template || !page || !group || !smtp ||
        typeof template.text !== 'string' || typeof template.html !== 'string' || typeof page.html !== 'string' ||
        !Array.isArray(group.targets) || group.targets.length === 0 ||
        !group.targets.every(target => typeof target === 'object' && target !== null && 'email' in target && typeof target.email === 'string') ||
        typeof smtp.host !== 'string' || typeof smtp.from_address !== 'string') {
      throw new GoPhishError('GoPhish asset response has an invalid shape');
    }
    // SMTP credentials are deliberately excluded even from the fingerprint.
    const fingerprint = createHash('sha256').update(JSON.stringify([
      template, page, group, { id: smtp.id, name: smtp.name, host: smtp.host, from_address: smtp.from_address, modified_date: smtp.modified_date },
    ])).digest('hex');
    return {
      provider: 'gophish', assets: refs.map((ref, index) => ({ ...ref, name: native[index]!.name })),
      recipientCount: group.targets.length, fingerprint,
    };
  }

  public async deployLab(selection: GoPhishAssets, fingerprint: string, name: string, url: string): Promise<Pick<GoPhishOutcome, 'providerId' | 'providerStatus'>> {
    if (!this.canDeploy) throw new GoPhishError('GoPhish lab deployment is not enabled');
    let target: URL;
    try { target = new URL(url); } catch { throw new GoPhishError('GoPhish lab target is invalid'); }
    if (target.origin !== 'http://gophish:8080' || target.username || target.password) throw new GoPhishError('GoPhish lab deployment requires the isolated gophish target');
    const manifest = await this.prepare(selection);
    if (manifest.fingerprint !== fingerprint) throw new GoPhishError('GoPhish assets changed after preparation; generate a new bundle');
    const [group, smtp, page] = await Promise.all([this.read('groups', selection.groupId), this.read('smtp', selection.smtpId), this.read('pages', selection.pageId)]);
    const targets = group.targets;
    if (!Array.isArray(targets) || !targets.every(target => typeof target === 'object' && target !== null && 'email' in target &&
        typeof target.email === 'string' && /^[A-Za-z0-9._+-]+@example\.test$/.test(target.email)) ||
        smtp.host !== 'mail-sink:1025' || page.capture_credentials !== false || page.capture_passwords !== false) {
      throw new GoPhishError('GoPhish lab deployment requires test recipients, mail sink, and a non-capturing page');
    }
    // Freeze recipients in a job-owned group: the selected source group is mutable.
    const frozen: unknown = await this.request('/api/groups/', 'POST', { name, targets });
    if (!isObject(frozen) || typeof frozen.id !== 'number' || frozen.name !== name) throw new GoPhishError('GoPhish lab group creation returned an invalid identity');
    const campaign: unknown = await this.request('/api/campaigns/', 'POST', {
      name, url, groups: [{ name }], template: { name: manifest.assets[0]!.name }, page: { name: page.name }, smtp: { name: smtp.name },
    }, true);
    if (!isObject(campaign) || typeof campaign.id !== 'number' || !Number.isSafeInteger(campaign.id) || campaign.id < 1 || campaign.name !== name || typeof campaign.status !== 'string') {
      throw new GoPhishError('GoPhish campaign creation returned an invalid identity', true);
    }
    return { providerId: String(campaign.id), providerStatus: campaign.status };
  }

  public async summary(providerId: string, name: string): Promise<GoPhishOutcome> {
    if (!/^[1-9]\d{0,15}$/.test(providerId)) throw new GoPhishError('GoPhish campaign identity is invalid');
    const summary = await this.request(`/api/campaigns/${providerId}/summary`);
    if (!isObject(summary) || summary.id !== Number(providerId) || summary.name !== name || typeof summary.status !== 'string' ||
        !isObject(summary.stats) || ![summary.stats.total, summary.stats.sent, summary.stats.error].every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)) {
      throw new GoPhishError('GoPhish summary response has an invalid shape');
    }
    return { providerId, providerStatus: summary.status, total: summary.stats.total as number, sent: summary.stats.sent as number, errors: summary.stats.error as number };
  }

  public async discover(name: string): Promise<GoPhishOutcome | null> {
    const summary = await this.request('/api/campaigns/summary');
    if (!isObject(summary) || !Array.isArray(summary.campaigns)) throw new GoPhishError('GoPhish campaign summary list has an invalid shape');
    const matches = summary.campaigns.filter(campaign => isObject(campaign) && campaign.name === name);
    if (matches.length > 1) throw new GoPhishError('GoPhish reconciliation found conflicting campaign identities');
    const match = matches[0];
    if (!match) return null;
    if (!isObject(match) || typeof match.id !== 'number') throw new GoPhishError('GoPhish reconciliation returned an invalid identity');
    return this.summary(String(match.id), name);
  }

  private async read(resource: string, id: number): Promise<NativeAsset> {
    const asset = await this.request(`/api/${resource}/${id}`);
    if (!isObject(asset) || asset.id !== id || typeof asset.name !== 'string' || asset.name.length < 1 || asset.name.length > 200) {
      throw new GoPhishError('GoPhish asset response has an invalid identity');
    }
    return asset as NativeAsset;
  }

  private async request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, uncertain = false): Promise<unknown> {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const response = await fetch(new URL(path, this.config.apiUrl), {
        method, body: body === undefined ? undefined : JSON.stringify(body),
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        redirect: 'manual', signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GoPhishError(`GoPhish asset request returned HTTP ${response.status}`, uncertain && (response.status < 400 || response.status === 408 || response.status >= 500));
      }
      if (!response.body) throw new GoPhishError('GoPhish asset response is empty', uncertain);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new GoPhishError('GoPhish asset response exceeds the size limit', uncertain);
        }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof GoPhishError) throw error;
      if (error instanceof SyntaxError) throw new GoPhishError('GoPhish asset response is not valid JSON', uncertain);
      if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
      throw new GoPhishError(signal.aborted ? 'GoPhish asset request timed out' : 'GoPhish asset request failed', uncertain);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
