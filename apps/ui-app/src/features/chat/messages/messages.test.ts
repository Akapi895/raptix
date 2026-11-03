import { describe, expect, it } from 'vitest';
import { formatProjectNameForDisplay } from './project-name';
import {
  CLAUDE_REASONING_UI_SUFFIX, formatMessageTime, isInterruptContinueInjectChatMessage, localizeAssistantError,
  mergeReasoningIntoProcessDetails, messageMoment, normalizeReasoningContentForDisplay, reasoningAlreadyInProcessDetails,
} from './text';
import { welcomeText } from './welcome';

const t = (key: string, fallback: string, values?: Record<string, unknown>) => {
  if (key === 'chat.projectWelcomeMessage') return `Project ${values?.project}`;
  return fallback;
};

describe('reasoning text', () => {
  it('drops the extended-thinking tail, and trims the rest', () => {
    expect(normalizeReasoningContentForDisplay(`  plan the scan ${CLAUDE_REASONING_UI_SUFFIX} blocks  `)).toBe('plan the scan');
    expect(normalizeReasoningContentForDisplay(null)).toBe('');
    expect(normalizeReasoningContentForDisplay('   ')).toBe('');
  });

  it('counts reasoning as already shown when a detail holds it, whole or in part', () => {
    const details = [{ eventType: 'thinking', message: 'step one and two' }];
    expect(reasoningAlreadyInProcessDetails(details, 'step one')).toBe(true);
    expect(reasoningAlreadyInProcessDetails(details, 'something else')).toBe(false);
    expect(reasoningAlreadyInProcessDetails([{ eventType: 'tool_call', message: 'x' }], 'x')).toBe(false);
    expect(reasoningAlreadyInProcessDetails([], '')).toBe(true);
  });

  it('adds the message reasoning to the details once, and leaves them alone when it is already there', () => {
    const added = mergeReasoningIntoProcessDetails([{ eventType: 'tool_call' }], 'reason');
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ eventType: 'reasoning_chain', message: 'reason' });
    expect(mergeReasoningIntoProcessDetails([{ eventType: 'thinking', message: 'reason' }], 'reason')).toHaveLength(1);
    expect(mergeReasoningIntoProcessDetails(null, '')).toEqual([]);
  });
});

describe('message text', () => {
  it('translates the known server error prefixes and keeps the rest', () => {
    const tr = (key: string) => (key === 'chat.executeFailed' ? 'Execution failed' : key === 'chat.callOpenAIFailed' ? 'OpenAI call failed' : key);
    expect(localizeAssistantError('\u6267\u884c\u5931\u8d25: timeout', tr)).toBe('Execution failed: timeout');
    expect(localizeAssistantError('\u8c03\u7528OpenAI\u5931\u8d25:401', tr)).toBe('OpenAI call failed:401');
    expect(localizeAssistantError('plain', tr)).toBe('plain');
  });

  it('recognises an interrupted-run continuation by its prefix', () => {
    expect(isInterruptContinueInjectChatMessage('  \u3010\u7528\u6237\u8865\u5145 / \u4e2d\u65ad\u540e\u7ee7\u7eed\u3011 more')).toBe(true);
    expect(isInterruptContinueInjectChatMessage('hello')).toBe(false);
  });

  it('uses the given time when it parses, and now otherwise', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(messageMoment('2026-10-29T08:30:00Z', now).toISOString()).toBe('2026-10-29T08:30:00.000Z');
    expect(messageMoment('not a date', now)).toBe(now);
    expect(messageMoment(null, now)).toBe(now);
  });

  it('shows 24-hour times for the Chinese and Russian pages', () => {
    const moment = new Date(2026, 9, 29, 15, 5);
    expect(formatMessageTime(moment, 'zh-CN')).toBe('15:05');
    expect(formatMessageTime(moment, 'ru-RU')).toBe('15:05');
  });
});

describe('project names and welcome', () => {
  it('shortens a long project name by characters, keeping whole characters', () => {
    expect(formatProjectNameForDisplay('\u77ed\u9879\u76ee')).toBe('\u77ed\u9879\u76ee');
    expect(formatProjectNameForDisplay('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u5341\u4e00\u5341\u4e8c\u5341\u4e09')).toBe('\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u5341\u4e00…');
  });

  it('welcomes the user to the named project, or with the generic line when there is none', () => {
    expect(welcomeText('Lab', '\u65e0\u9879\u76ee', t)).toBe('Project Lab');
    expect(welcomeText('\u65e0\u9879\u76ee', '\u65e0\u9879\u76ee', t)).toBe('No project is currently selected. Enter your test requirements and the system will run the corresponding security tests.');
  });
});
