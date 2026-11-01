import { describe, expect, it } from 'vitest';
import { executionAgents, type ExecutionEvent } from './execution';

const event = (eventType: string, einoAgent?: string, data: Record<string, unknown> = {}): ExecutionEvent => ({ eventType, data: { einoAgent, ...data } });
const task = (caller: string, child: string, id: string) => event('tool_call', caller, { toolName: 'task', arguments: JSON.stringify({ subagent_type: child }), toolCallId: id });
const result = (caller: string, id: string, success: boolean) => event('tool_result', caller, { toolCallId: id, success });
function build(processDetails: ExecutionEvent[], active: boolean | null = true) {
  return executionAgents([{ id: 'turn', role: 'assistant', processDetails }], active);
}

describe('conversation execution evidence', () => {
  it('uses actual delegation calls for nested topology and correlates completion by call id', () => {
    const agents = build([
      event('iteration', 'lead', { einoScope: 'main' }),
      task('lead', 'recon', 'a'), task('recon', 'web', 'b'),
      event('progress', 'web'), result('recon', 'b', false),
      task('lead', 'writer', 'c'), result('lead', 'a', true),
    ]);
    const [lead, recon, web, writer] = agents;
    expect(lead).toMatchObject({ name: 'lead', status: 'running' });
    expect(recon).toMatchObject({ parentId: lead?.id, status: 'completed' });
    expect(web).toMatchObject({ parentId: recon?.id, status: 'failed' });
    expect(writer).toMatchObject({ parentId: lead?.id, status: 'pending' });
  });

  it('never infers a parent from roles, event order, handoffs, or agent definitions', () => {
    const agents = build([
      event('progress', 'lead', { einoRole: 'orchestrator' }),
      event('tool_call', 'lead', { toolName: 'transfer_to_agent', argumentsObj: { agent_name: 'expert' } }),
      event('progress', 'expert', { einoRole: 'sub' }),
    ]);
    expect(agents.map(agent => agent.parentId)).toEqual([undefined, undefined]);
    expect(build([])).toEqual([]);
  });

  it('does not infer success or continued running from missing terminal records or unavailable task data', () => {
    expect(build([event('progress', 'recon')], false)[0]?.status).toBe('unknown');
    expect(build([event('progress', 'recon')], null)[0]?.status).toBe('unknown');
    const agents = build([
      event('progress', 'lead', { einoRole: 'orchestrator' }),
      event('progress', 'expert'), event('response'),
    ], false);
    expect(agents.map(agent => agent.status)).toEqual(['completed', 'unknown']);
  });

  it('recognizes persisted final main output without treating unfinished placeholders as completion', () => {
    const message = { id: 'turn', role: 'assistant', content: 'Assessment complete.', processDetails: [event('iteration', 'lead', { einoScope: 'main' })] };
    expect(executionAgents([message], false)[0]?.status).toBe('completed');
    expect(executionAgents([{ ...message, content: 'Processing...' }], false)[0]?.status).toBe('unknown');
    expect(executionAgents([{ ...message, processDetails: [...message.processDetails, event('error')] }], false)[0]?.status).toBe('failed');
    expect(executionAgents([{ ...message, content: 'Execution cancelled.', processDetails: [...message.processDetails, event('cancelled')] }], false)[0]?.status).toBe('unknown');
  });

  it('keeps repeated agent invocations and turns distinct', () => {
    const agents = build([task('lead', 'recon', 'a'), result('lead', 'a', true), task('lead', 'recon', 'b'), result('lead', 'b', false)]);
    expect(agents.filter(agent => agent.name === 'recon').map(agent => agent.status)).toEqual(['completed', 'failed']);
    expect(new Set(agents.map(agent => agent.id)).size).toBe(agents.length);
    const turns = executionAgents([
      { id: 'old', role: 'assistant', processDetails: [event('progress', 'lead')] },
      { id: 'new', role: 'assistant', processDetails: [event('progress', 'lead')] },
    ], true);
    expect(turns.map(agent => agent.status)).toEqual(['unknown', 'running']);
  });

  it('does not guess which concurrent same-named agent emitted a name-only event', () => {
    const agents = build([task('lead', 'recon', 'a'), task('lead', 'recon', 'b'), event('progress', 'recon'), result('lead', 'a', true)]);
    expect(agents.filter(agent => agent.name === 'recon').map(agent => agent.status)).toEqual(['completed', 'unknown']);
  });

  it('does not impose a hierarchy depth limit', () => {
    const events = Array.from({ length: 100 }, (_, index) => task('agent-' + index, 'agent-' + (index + 1), String(index)));
    const agents = build(events);
    expect(agents).toHaveLength(101);
    expect(agents[100]?.parentId).toBe(agents[99]?.id);
  });
});
