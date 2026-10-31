import { describe, expect, it } from 'vitest';
import {
  formatToolCallTitle,
  getToolExecutionDisplayStatus,
  getToolResultDisplayState,
  isToolGuardBlockedResult,
  parseToolCallArgs,
  toolCallArgsEmpty,
  toolDisplayStatusFromState,
} from './tool-result';

const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key);

describe('timeline tool calls', () => {
  it('reads the arguments of a call from the object it carries, or from its JSON text', () => {
    expect(parseToolCallArgs({ argumentsObj: { target: 'a' } })).toEqual({ target: 'a' });
    expect(parseToolCallArgs({ arguments: '{"port":80}' })).toEqual({ port: 80 });
    expect(parseToolCallArgs({ arguments: 'not json' })).toEqual({ _raw: 'not json' });
    expect(parseToolCallArgs(null)).toEqual({});
    expect(toolCallArgsEmpty({})).toBe(true);
    expect(toolCallArgsEmpty({ a: 1 })).toBe(false);
  });

  it('titles a call with its name and its place among the calls of the step', () => {
    expect(formatToolCallTitle('nmap', 2, 3, translate)).toBe('chat.callTool {"name":"nmap","index":2,"total":3}');
    expect(formatToolCallTitle('', 0, 0, translate)).toBe('chat.callTool {"name":"chat.unknownTool","index":0,"total":0}');
  });
});

describe('timeline tool results', () => {
  it('recognises a block by the tool guard, in its structured form or by its legacy prefix', () => {
    expect(isToolGuardBlockedResult({ blocked: true })).toBe(true);
    expect(isToolGuardBlockedResult({ _meta: { 'raptix.ai/blocked': true } })).toBe(true);
    expect(isToolGuardBlockedResult('\u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a\uff1arm -rf')).toBe(true);
    expect(isToolGuardBlockedResult('the report says \u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a in the middle')).toBe(false);
    expect(isToolGuardBlockedResult({ success: true, result: '\u5de5\u5177\u8c03\u7528\u5df2\u88ab\u5b89\u5168\u89c4\u5219\u62e6\u622a\uff1ax' })).toBe(false);
  });

  it('shows a blocked execution as blocked, and any other as its own status in lower case', () => {
    expect(getToolExecutionDisplayStatus({ status: 'Completed' })).toBe('completed');
    expect(getToolExecutionDisplayStatus({ status: 'done', displayStatus: 'blocked' } as { status: string })).toBe('blocked');
    expect(getToolExecutionDisplayStatus(undefined)).toBe('unknown');
  });

  it('keeps a background run out of the failures, and a poll of it a success', () => {
    const running = {
      executionId: '1f2e3d4c-aaaa-bbbb-cccc-ddddeeeeffff',
      isError: true,
      result: 'wait_timeout: \u5de5\u5177\u5df2\u63d0\u4ea4\u5230\u540e\u53f0\u6267\u884c\uff0cstatus: running',
    };
    expect(getToolResultDisplayState({ ...running, toolName: 'nmap' })).toEqual({ kind: 'background_running', isError: false, success: false });
    expect(getToolResultDisplayState({ ...running, toolName: 'wait_tool_execution' })).toEqual({ kind: 'success', isError: false, success: true });
    expect(toolDisplayStatusFromState(getToolResultDisplayState({ ...running, toolName: 'nmap' }))).toBe('background_running');
  });

  it('reads a cancel and an error as such, and a plain result as a success', () => {
    expect(getToolResultDisplayState({ displayStatus: 'cancelled' }).kind).toBe('cancelled');
    expect(getToolResultDisplayState({ isError: true, result: 'boom' })).toEqual({ kind: 'error', isError: true, success: false });
    expect(getToolResultDisplayState({ result: 'ok' })).toEqual({ kind: 'success', isError: false, success: true });
    expect(toolDisplayStatusFromState(null)).toBe('completed');
    expect(toolDisplayStatusFromState({ kind: 'error', isError: true, success: false })).toBe('failed');
  });
});
