import { describe, expect, it } from 'vitest';
import {
  describeHitlApprovalRequest,
  findHitlArgumentValue,
  formatHitlRemaining,
  getHitlApprovalTiming,
  hitlApprovalArguments,
  hitlRemainingPercent,
  isAgentReviewedHitl,
  type HitlTranslate,
} from './describe';

const tr: HitlTranslate = (key, fallback) => (key === 'hitl.requestBrowser' ? 'Browser' : fallback);

describe('approval request', () => {
  it('reads the arguments from the object the server sent, or from its JSON text', () => {
    expect(hitlApprovalArguments({ payload: { argumentsObj: { a: 1 } } })).toEqual({ a: 1 });
    expect(hitlApprovalArguments({ payload: { arguments: '{"b":2}' } })).toEqual({ b: 2 });
    expect(hitlApprovalArguments({ payload: { arguments: 'not json' } })).toEqual({});
  });

  it('finds a value in the arguments, and in the nested ones', () => {
    expect(findHitlArgumentValue({ url: ' https://x.test ' }, ['url'])).toBe('https://x.test');
    expect(findHitlArgumentValue({ request: { command: 'ls -la' } }, ['command'])).toBe('ls -la');
    expect(findHitlArgumentValue({}, ['path'])).toBe('');
  });

  it('asks about a browser visit, a command or a file change by what the call touches', () => {
    const browser = describeHitlApprovalRequest({ toolName: 'open_url', payload: { argumentsObj: { url: 'https://x.test' } } }, tr);
    expect(browser.kind).toBe('browser');
    expect(browser.question).toBe('Allow Raptix to visit https://x.test?');
    expect(browser.primary).toBe('https://x.test');

    const command = describeHitlApprovalRequest({ toolName: 'run_command', payload: { argumentsObj: { command: 'id' } } }, tr);
    expect(command).toMatchObject({ kind: 'command', primary: 'id', question: 'Allow Raptix to run this command?' });

    const file = describeHitlApprovalRequest({ toolName: 'write_file', payload: { argumentsObj: { path: '/tmp/a' } } }, tr);
    expect(file).toMatchObject({ kind: 'file', question: 'Allow Raptix to modify /tmp/a?' });
  });

  it('falls back to a generic question naming the tool', () => {
    const generic = describeHitlApprovalRequest({ toolName: 'lookup' }, tr);
    expect(generic).toMatchObject({ kind: 'generic', question: 'Allow Raptix to call lookup?', primary: '' });
  });

  it('counts a review by an agent as not waiting for a person', () => {
    expect(isAgentReviewedHitl({ reviewer: 'audit_agent' })).toBe(true);
    expect(isAgentReviewedHitl({ status: 'audit_running' })).toBe(true);
    expect(isAgentReviewedHitl({ reviewer: 'human' })).toBe(false);
    expect(isAgentReviewedHitl(null)).toBe(false);
  });
});

describe('approval timing', () => {
  it('counts the expiry from the creation when the request gives only a timeout', () => {
    const created = '2026-01-01T00:00:00Z';
    const timing = getHitlApprovalTiming({ timeoutSeconds: 300, createdAt: created });
    expect(timing.timeoutSeconds).toBe(300);
    expect(timing.expiresAt).toBe(Date.parse(created) + 300_000);
    expect(getHitlApprovalTiming({})).toEqual({ timeoutSeconds: 0, createdAt: 0, expiresAt: 0 });
  });

  it('shows the time left as minutes and seconds, and the share of the timeout left', () => {
    expect(formatHitlRemaining(65_400)).toBe('01:06');
    expect(formatHitlRemaining(-5)).toBe('00:00');
    const timing = { timeoutSeconds: 100, createdAt: 0, expiresAt: 50_000 };
    expect(hitlRemainingPercent(timing, 0)).toBe(50);
    expect(hitlRemainingPercent(timing, 60_000)).toBe(0);
  });
});
