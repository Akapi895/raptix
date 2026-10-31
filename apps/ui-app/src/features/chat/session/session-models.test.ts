import { describe, expect, it } from 'vitest';
import { buildChannelDirectory, channelConfigState, isFreshModelCache, modelCacheKey, normalizeChannelId, uniqueModelNames } from './channels';
import {
  normalizeReasoningEffort, normalizeReasoningMode, reasoningEffortLabel, reasoningMenuLabel, reasoningModeLabel, reasoningRequest,
} from './reasoning';
import { auditEngineLabel, auditModelLabel, hitlModeLabel, normalizeAuditBackend, truncateSummaryLabel } from './summary';

const t = (_key: string, fallback: string) => fallback;

describe('reasoning', () => {
  it('normalises unknown values to the defaults', () => {
    expect(normalizeReasoningMode(' on ')).toBe('on');
    expect(normalizeReasoningMode('maybe')).toBe('default');
    expect(normalizeReasoningEffort('max')).toBe('max');
    expect(normalizeReasoningEffort('extreme')).toBe('');
  });

  it('labels the mode and effort, and shows "off" in the shortcut before any effort', () => {
    expect(reasoningModeLabel('default', t)).toBe('System');
    expect(reasoningEffortLabel('', t)).toBe('Unspecified');
    expect(reasoningMenuLabel('off', 'high', t)).toBe('Off');
    expect(reasoningMenuLabel('auto', 'high', t)).toBe('high');
    expect(reasoningMenuLabel('auto', '', t)).toBe('Auto');
  });

  it('sends nothing at defaults, and only the fields that were chosen', () => {
    expect(reasoningRequest('default', '')).toBeUndefined();
    expect(reasoningRequest('default', 'low')).toEqual({ effort: 'low' });
    expect(reasoningRequest('on', '')).toEqual({ mode: 'on' });
  });
});

describe('AI channels', () => {
  const ai = {
    default_channel: 'openai_main',
    channels: {
      'openai-main': { name: 'OpenAI', provider: 'openai', api_key: 'k', model: 'gpt-x' },
      anthropic: { name: 'Claude', provider: 'anthropic', api_key: 'k2' },
    },
  };

  it('matches ids written in another spelling', () => {
    expect(normalizeChannelId(' Open_AI Main ')).toBe('open-ai-main');
    const directory = buildChannelDirectory(ai);
    expect(directory.resolve('OPENAI_MAIN')).toBe('openai-main');
    expect(directory.resolve('nope')).toBe('');
    expect(directory.defaultId).toBe('openai-main');
  });

  it('keeps the preferred channel, else the default, else the first', () => {
    expect(channelConfigState({ ai }, 'anthropic').channelId).toBe('anthropic');
    expect(channelConfigState({ ai }, 'missing').channelId).toBe('openai-main');
    expect(channelConfigState({ ai: { channels: { b: {}, a: {} } } }, '').channelId).toBe('b');
  });

  it('builds a channel from the legacy openai block when there is none', () => {
    const state = channelConfigState({ openai: { provider: 'openai', model: 'legacy-model' } }, '');
    expect(state.channelId).toBe('default');
    expect(state.channel).toMatchObject({ name: 'Default', model: 'legacy-model' });
    expect(state.ai.default_channel).toBe('default');
  });

  it('lists unique models with the current one first', () => {
    expect(uniqueModelNames('a', ['b', 'a', ' ', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('caches per channel, endpoint and provider for five minutes', () => {
    expect(modelCacheKey('c', { provider: 'openai', base_url: ' https://x ' })).toBe('c|openai|https://x');
    expect(isFreshModelCache(1_000, 1_000 + 299_000)).toBe(true);
    expect(isFreshModelCache(1_000, 1_000 + 300_000)).toBe(false);
  });
});

describe('composer summaries', () => {
  it('shortens by code points so a name is never cut inside a character', () => {
    expect(truncateSummaryLabel('\u77ed\u540d\u79f0')).toBe('\u77ed\u540d\u79f0');
    expect(truncateSummaryLabel('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u5341\u4e00')).toBe('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341...');
  });

  it('names the audit engine and its model, with the system model as the fallback', () => {
    expect(normalizeAuditBackend('JEV')).toBe('typesafe');
    expect(auditModelLabel('typesafe', '', 'sys')).toBe('jev-latest');
    expect(auditModelLabel('openai', '', 'sys')).toBe('sys');
    expect(auditEngineLabel('openai', 'm1', 'sys', t)).toBe('OpenAI-compatible model · m1');
  });

  it('labels the HITL mode with its built-in text when no translation exists', () => {
    expect(hitlModeLabel('review_edit', t)).toBe('Review & edit');
    expect(hitlModeLabel('off', t)).toBe('Off');
  });
});
