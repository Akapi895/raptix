import { describe, expect, it } from 'vitest';
import { getToolExecutionDisplayStatus, isToolGuardBlockedResult } from './status';

describe('tool guard status', () => {
  it('reads an explicit blocked marker on the execution', () => {
    expect(getToolExecutionDisplayStatus({ status: 'completed', displayStatus: 'blocked' })).toBe('blocked');
  });

  it('reads a blocked JSON result nested in the output', () => {
    expect(isToolGuardBlockedResult(JSON.stringify({ result: { blocked: true } }))).toBe(true);
  });

  it('ignores the legacy prefix once the result is known to be a success', () => {
    expect(isToolGuardBlockedResult({ success: true, result: '\u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a\uff1ax' })).toBe(false);
    expect(isToolGuardBlockedResult('\u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a\uff1ax')).toBe(true);
  });

  it('falls back to the stored status and lower-cases it', () => {
    expect(getToolExecutionDisplayStatus({ status: 'RUNNING' })).toBe('running');
    expect(getToolExecutionDisplayStatus({})).toBe('unknown');
  });
});
