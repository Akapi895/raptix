import { describe, expect, it } from 'vitest';
import {
  einoMainStreamPlanningTitle,
  finalizationNoticeMarkdown,
  formatTimelineStreamBody,
  localeTag,
  resolveFinalAssistantResponseText,
  timeFormatOptions,
  translatePlanExecuteAgentName,
} from './labels';

const t = (key: string) => key;

describe('timeline wording', () => {
  it('reads the reader language for the time, and uses the 24-hour clock for Russian', () => {
    expect(localeTag('en-US', null)).toBe('en-US');
    expect(localeTag(null, 'ru-RU')).toBe('ru-RU');
    expect(localeTag('fr', null)).toBe('en-US');
    expect(localeTag(null, null)).toBe('en-US');
    expect(timeFormatOptions('ru-RU').hour12).toBe(false);
    expect(timeFormatOptions('en-US').hour12).toBeUndefined();
  });

  it('names a Plan-Execute agent in the progress wording', () => {
    expect(translatePlanExecuteAgentName('Planner', t)).toBe('progress.peAgentPlanner');
    expect(translatePlanExecuteAgentName('execute_replan', t)).toBe('progress.peAgentReplanning');
    expect(translatePlanExecuteAgentName('custom', t)).toBe('custom');
  });
});

describe('Plan-Execute bodies', () => {
  it('turns a planner step list into a numbered list', () => {
    expect(formatTimelineStreamBody('{"steps":["scan","report"]}', { orchestration: 'plan_execute', einoAgent: 'planner' }))
      .toBe('1. scan\n2. report');
  });

  it('unwraps an executor response and keeps a stream piece that is not JSON', () => {
    expect(formatTimelineStreamBody('{"response":"line\\nnext"}', { orchestration: 'plan_execute', einoAgent: 'executor' }))
      .toBe('line\nnext');
    expect(formatTimelineStreamBody('{"partial', { orchestration: 'plan_execute', einoAgent: 'executor' })).toBe('{"partial');
    expect(formatTimelineStreamBody('{"response":"x"}', { orchestration: 'eino_single', einoAgent: 'executor' })).toBe('{"response":"x"}');
  });
});

describe('titles of main stream steps', () => {
  it('names the Plan-Execute phase, and the answer stream of the other orchestrations', () => {
    expect(einoMainStreamPlanningTitle({ orchestration: 'plan_execute', einoAgent: 'planner' }, '[A] ', t)).toBe('[A] 📝 chat.planExecuteStreamPlanner');
    expect(einoMainStreamPlanningTitle({ orchestration: 'eino_single' }, '', t)).toBe('📝 chat.assistantStreamPhase');
    expect(einoMainStreamPlanningTitle({}, '', t)).toBe('📝 chat.planning');
  });
});

describe('finalization', () => {
  it('keeps the final text, unless the final text is only the placeholder and the stream has text', () => {
    expect(resolveFinalAssistantResponseText('done', { buffer: 'x' })).toBe('done');
    expect(resolveFinalAssistantResponseText('no assistant text was captured', { buffer: 'streamed' })).toBe('streamed');
  });

  it('lists what an unfinished answer still waits for, with at most three of each', () => {
    const md = finalizationNoticeMarkdown({
      completionReason: 'pending_tool_executions',
      pendingExecutionIds: ['a', 'b', 'c', 'd'],
      missingChecks: ['workflow is awaiting HITL approval'],
      finalized: false,
    }, '');
    expect(md).toContain('Status: Waiting for tool executions to finish');
    expect(md).toContain('Pending tools: `a`, `b`, `c`, `and 1 more`');
    expect(md).toContain('Pending checks: The workflow is awaiting HITL approval');
  });

  it('says a candidate answer was moved to the process details when there is no contract', () => {
    expect(finalizationNoticeMarkdown({}, 'candidate')).toContain('The candidate output was moved into the process details so it is not mistaken for the final answer.');
  });
});
