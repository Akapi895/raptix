import type { AppConfigStore } from "../db/app-config-store.js";
import type { LlmChannelConfig } from "../adapters/llm/client.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Resolves the AI channel apps/api uses for its own derivations (attack
 * chains): the "ai" config section the Settings page saves
 * ({default_channel, channels: {<id>: {base_url, api_key, model, ...}}}).
 * Falls back to the first channel with all three fields set. Returns null
 * when nothing usable is configured -- callers fail 503 honestly rather
 * than inventing a provider.
 */
export async function resolveLlmChannel(appConfigStore: AppConfigStore): Promise<LlmChannelConfig | null> {
  const config = await appConfigStore.get("ai");
  if (!config) return null;
  const channels = isRecord(config.channels) ? config.channels : {};
  const defaultId = asString(config.default_channel);
  const candidates = isRecord(channels[defaultId]) ? [channels[defaultId], ...Object.values(channels)] : Object.values(channels);
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const baseUrl = asString(candidate.base_url);
    const apiKey = asString(candidate.api_key);
    const model = asString(candidate.model);
    if (baseUrl && apiKey && model) return { baseUrl, apiKey, model };
  }
  return null;
}
