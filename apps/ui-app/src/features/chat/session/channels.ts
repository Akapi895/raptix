// AI channels of the system configuration: how ids are matched, which channel is the default, and how the
// session's model is written back into the configuration. Pure: the caller supplies the configuration object.

export interface ChannelConfig {
  name?: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  [key: string]: unknown;
}
export type ChannelMap = Record<string, ChannelConfig>;

export interface AIConfig {
  default_channel?: string;
  channels?: ChannelMap;
  [key: string]: unknown;
}

/** Lower-case, dash-separated form used to match a channel id typed or stored in a different spelling. */
export function normalizeChannelId(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface ChannelDirectory {
  channels: ChannelMap;
  /** The channel the system uses when the session does not pick one; empty when there is none. */
  defaultId: string;
  /** Resolves an id, or a differently spelled one, to the configured id; empty when unknown. */
  resolve(value: unknown): string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function buildChannelDirectory(ai: unknown): ChannelDirectory {
  const source = asRecord(ai);
  const channels: ChannelMap = source.channels && typeof source.channels === 'object' ? source.channels as ChannelMap : {};
  const byNormalized = new Map<string, string>();
  Object.keys(channels).forEach(id => {
    const normalized = normalizeChannelId(id);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, id);
  });
  const resolve = (value: unknown): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (Object.prototype.hasOwnProperty.call(channels, raw) && channels[raw]) return raw;
    const normalized = normalizeChannelId(raw);
    return normalized ? byNormalized.get(normalized) ?? '' : '';
  };
  return { channels, defaultId: resolve(source.default_channel || ''), resolve };
}

export interface ChannelConfigState {
  ai: AIConfig & { channels: ChannelMap };
  channelId: string;
  channel: ChannelConfig;
}

/**
 * The AI configuration with a usable channel chosen: the preferred one when it exists, else the default, else the
 * first channel, else a channel built from the legacy `openai` block. Used before a model is written back.
 */
export function channelConfigState(cfg: unknown, preferredChannelId: unknown): ChannelConfigState {
  const source = asRecord(cfg);
  const sourceAI = asRecord(source.ai) as AIConfig;
  const channels: ChannelMap = sourceAI.channels && typeof sourceAI.channels === 'object' ? { ...sourceAI.channels } : {};
  const resolveFromChannels = (value: unknown): string => {
    const raw = String(value || '').trim();
    if (raw && channels[raw]) return raw;
    const normalized = normalizeChannelId(raw);
    return normalized ? Object.keys(channels).find(id => normalizeChannelId(id) === normalized) || '' : '';
  };
  let defaultChannelId = resolveFromChannels(sourceAI.default_channel);
  let channelId = resolveFromChannels(preferredChannelId) || defaultChannelId;
  if (!channels[channelId]) channelId = Object.keys(channels)[0] || 'default';
  if (!channels[channelId]) {
    const legacy = asRecord(source.openai);
    channels[channelId] = {
      name: channelId === 'default' ? 'Default' : channelId,
      provider: String(legacy.provider || 'openai'),
      api_key: String(legacy.api_key || ''),
      base_url: String(legacy.base_url || ''),
      model: String(legacy.model || ''),
    };
  }
  if (!defaultChannelId) defaultChannelId = channelId;
  return {
    ai: { ...sourceAI, default_channel: defaultChannelId, channels },
    channelId,
    channel: channels[channelId]!,
  };
}

/** The unique, non-empty model names with the current one first, as the picker lists them. */
export function uniqueModelNames(current: string, models: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  [current, ...models].forEach(value => {
    const model = String(value ?? '').trim();
    if (!model || seen.has(model)) return;
    seen.add(model);
    out.push(model);
  });
  return out;
}

/** Model lists are cached per channel and endpoint, so switching back does not refetch. */
export function modelCacheKey(channelId: string, channel: ChannelConfig): string {
  return [channelId, String(channel.provider || 'openai'), String(channel.base_url || '').trim()].join('|');
}

export const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

export function isFreshModelCache(fetchedAt: number, now: number): boolean {
  return now - fetchedAt < MODEL_CACHE_TTL_MS;
}
