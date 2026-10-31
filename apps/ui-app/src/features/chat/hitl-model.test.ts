import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HITL_SESSION_TOOL_WHITELIST, DEFAULT_HITL_TIMEOUT_SECONDS, HITL_MODE_APPROVAL, HITL_MODE_OFF, defaultHitlConfig, mergeToolsForDisplay,
  normalizeHitlMode, normalizeHitlReviewer, normalizeHitlTimeout, parseStoredConfig, serialiseConfig, sessionToolsForUI, splitTools,
  storageKeyFor, stripGlobalTools,
} from './hitl-model';

describe('HITL normalisers', () => {
  it('maps legacy mode names and falls back to off', () => {
    expect(normalizeHitlMode('feedback')).toBe(HITL_MODE_APPROVAL);
    expect(normalizeHitlMode('review-edit')).toBe('review_edit');
    expect(normalizeHitlMode('nonsense')).toBe(HITL_MODE_OFF);
  });

  it('treats only the agent aliases as the audit reviewer', () => {
    expect(normalizeHitlReviewer('AI')).toBe('audit_agent');
    expect(normalizeHitlReviewer('someone')).toBe('human');
  });

  it('clamps timeouts to a day and rejects non-numbers', () => {
    expect(normalizeHitlTimeout(-5, 300)).toBe(0);
    expect(normalizeHitlTimeout(999999, 300)).toBe(86400);
    expect(normalizeHitlTimeout('abc', 300)).toBe(300);
  });
});

describe('default config', () => {
  it('uses the server default and the built-in baseline for anything missing', () => {
    const cfg = defaultHitlConfig({ mode: 'approval', timeoutSeconds: 60 }, 'audit_agent');
    expect(cfg).toMatchObject({ mode: 'approval', reviewer: 'audit_agent', timeoutSeconds: 60, sensitiveTools: DEFAULT_HITL_SESSION_TOOL_WHITELIST });
    expect(defaultHitlConfig(undefined).timeoutSeconds).toBe(DEFAULT_HITL_TIMEOUT_SECONDS);
  });
});

describe('tool lists', () => {
  it('splits on commas and line breaks', () => {
    expect(splitTools('a, b\nc,,  d ')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shows global tools first and drops repeats ignoring case', () => {
    expect(mergeToolsForDisplay(['Read', 'write'], ['read', 'exec'])).toBe('Read, write, exec');
  });

  it('removes global tools from the session text before it is stored', () => {
    expect(stripGlobalTools(['Read'], 'read, exec')).toBe('exec');
    expect(stripGlobalTools([], '  exec  ')).toBe('exec');
  });

  it('shows the baseline when the session has no list of its own', () => {
    expect(sessionToolsForUI({ mode: 'off', reviewer: 'human', sensitiveTools: '  ', timeoutSeconds: 1, updatedAt: '' })).toBe(DEFAULT_HITL_SESSION_TOOL_WHITELIST);
  });
});

describe('storage', () => {
  it('keys the config by the trimmed conversation id', () => {
    expect(storageKeyFor(' c1 ')).toBe('raptix-chat-hitl:c1');
  });

  it('reads a stored config, normalising it, and falls back on bad JSON', () => {
    const fallback = defaultHitlConfig(undefined);
    const stored = JSON.stringify({ mode: 'feedback', reviewer: 'agent', timeoutSeconds: 10 });
    expect(parseStoredConfig(stored, fallback)).toMatchObject({ mode: 'approval', reviewer: 'audit_agent', timeoutSeconds: 10 });
    expect(parseStoredConfig('{bad', fallback)).toBe(fallback);
    expect(parseStoredConfig(null, fallback)).toBe(fallback);
  });

  it('serialises every field normalised', () => {
    expect(serialiseConfig({ mode: 'x' as never, timeoutSeconds: 1e9 })).toMatchObject({ mode: 'off', timeoutSeconds: 86400, sensitiveTools: '' });
  });
});
