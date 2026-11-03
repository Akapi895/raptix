/*
 * Chat: conversations, messages, and the scripted agent runs.
 *
 * Agent runs behave like the backend: a run is a background task per
 * conversation that appends events to a buffer. The HTTP stream is only a reader
 * of that buffer, so closing the stream (navigating away, reloading) does not stop
 * the run. The UI then reattaches through GET /api/agent-loop/task-events, and
 * /api/agent-loop/tasks reports the run as running until it finishes.
 *
 * Events use the backend envelope { type, message, data }. The scenario is picked
 * from the prompt: "scan"/"nmap" runs a tool, "token"/"replay" pauses for HITL,
 * "error" fails the model call, anything else gets a plain answer.
 */
import type { MockRuntime } from '../runtime';
import type { Conversation, Message } from '../types';
import type { Context } from '../router';
import type { StreamEvent } from '../../platform/mock-transport';
import { bodies, type AgentBody } from '../bodies';
import type { RunEventData } from '../events';

interface Run {
  convId: string; prompt: string; orchestration: string; events: StreamEvent[];
  listeners: (() => void)[]; done: boolean; cancelled: boolean; startedAt: string;
}
type Scenario = 'scan' | 'hitl' | 'error' | 'reply';

export function registerChat(M: MockRuntime): void {

  function convView(c: Conversation, withMessages: boolean) {
    const out: Conversation & { messages?: Message[] } = {
      id: c.id, title: c.title, projectId: c.projectId || '', roleName: c.roleName || '',
      agentMode: c.agentMode || '', pinned: !!c.pinned, createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
    if (withMessages) {
      out.messages = M.state.messages.filter(function (m) { return m.conversationId === c.id; });
    }
    return out;
  }
  M.convView = convView;

  function findConv(id: string) {
    return M.findById(M.state.conversations, id);
  }

  M.route('GET', '/api/conversations', function (ctx) {
    const projectId = M.q(ctx, 'project_id', M.q(ctx, 'projectId', ''));
    const list = M.state.conversations.filter(function (c) {
      if (projectId === '__none__' ? !!c.projectId : projectId && c.projectId !== projectId) return false;
      return M.matchSearch(c, M.q(ctx, 'search', ''), ['title']);
    });
    list.sort(function (a, b) { return a.pinned === b.pinned ? (a.updatedAt < b.updatedAt ? 1 : -1) : (a.pinned ? -1 : 1); });
    const page = M.limitOffset(list, ctx, 50);
    return M.ok({ conversations: page.items.map(function (c) { return convView(c, false); }), total: page.total, limit: page.limit, offset: page.offset });
  });

  M.route('POST', '/api/conversations', bodies.conversation, function (ctx) {
    const b = ctx.body || {};
    const conv = {
      id: M.id('conv'), title: b.title || 'New conversation', projectId: b.projectId || '', roleName: b.role || '',
      agentMode: b.agentMode || 'eino_single', pinned: false, createdAt: M.nowISO(), updatedAt: M.nowISO(),
    };
    M.state.conversations.unshift(conv);
    M.save();
    return M.ok(convView(conv, false));
  });

  M.route('GET', '/api/conversations/:id', function (ctx) {
    const found = findConv(ctx.params.id);
    if (!found) return M.fail(404, 'Conversation not found');
    return M.ok(convView(found.item, true));
  });

  M.route('PUT', '/api/conversations/:id', bodies.conversation, function (ctx) {
    const found = findConv(ctx.params.id);
    if (!found) return M.fail(404, 'Conversation not found');
    if (ctx.body && ctx.body.title) found.item.title = ctx.body.title;
    found.item.updatedAt = M.nowISO();
    M.save();
    return M.ok(convView(found.item, false));
  });

  M.route('DELETE', '/api/conversations/:id', function (ctx) {
    const found = findConv(ctx.params.id);
    if (!found) return M.fail(404, 'Conversation not found');
    M.removeAt(M.state.conversations, found.index);
    M.state.messages = M.state.messages.filter(function (m) { return m.conversationId !== ctx.params.id; });
    M.save();
    return M.ok({ message: 'Conversation deleted' });
  });

  M.route('PUT', '/api/conversations/:id/pinned', bodies.conversation, function (ctx) {
    const found = findConv(ctx.params.id);
    if (!found) return M.fail(404, 'Conversation not found');
    found.item.pinned = !!(ctx.body && ctx.body.pinned);
    M.save();
    return M.ok({ success: true, pinned: found.item.pinned });
  });

  M.route('PUT', '/api/conversations/:id/project', bodies.conversation, function (ctx) {
    const found = findConv(ctx.params.id);
    if (!found) return M.fail(404, 'Conversation not found');
    found.item.projectId = (ctx.body && ctx.body.projectId) || '';
    M.save();
    return M.ok({ success: true });
  });

  M.route('POST', '/api/conversations/:id/delete-turn', bodies.deleteTurn, function (ctx) {
    const convId = ctx.params.id;
    const b = ctx.body || {};
    const msgs = M.state.messages.filter(function (m) { return m.conversationId === convId; });
    const idx = msgs.findIndex(function (m) { return m.id === b.messageId; });
    if (idx === -1) return M.fail(404, 'Message not found');
    const toDrop = msgs.slice(idx).map(function (m) { return m.id; });
    M.state.messages = M.state.messages.filter(function (m) { return toDrop.indexOf(m.id) === -1; });
    M.save();
    return M.ok({ success: true, deleted: toDrop.length });
  });

  M.route('GET', '/api/conversations/:id/results', function (ctx) {
    const vulns = M.state.vulnerabilities.filter(function (v) { return v.conversation_id === ctx.params.id; });
    return M.ok({ conversationId: ctx.params.id, results: vulns, total: vulns.length });
  });

  // Mirrors GetConversationPlanTasks: the list only exists while a run is active.
  // Task statuses advance with the run's event count so the Progress tab moves.
  M.route('GET', '/api/conversations/:id/plan-tasks', function (ctx) {
    const run = runs[ctx.params.id];
    if (!run || run.done) {
      return M.ok({ tasks: [], total: 0, completed: 0, activeStep: 0, running: false });
    }
    const step = Math.min(3, Math.floor(run.events.length / 6));
    const subjects = [
      { id: '1', subject: 'Scope the target', activeForm: 'Scoping the target' },
      { id: '2', subject: 'Run the tool checks', activeForm: 'Running the tool checks' },
      { id: '3', subject: 'Summarize findings', activeForm: 'Summarizing findings' },
    ];
    const tasks = subjects.map(function (t, i) {
      const status = i < step ? 'completed' : (i === step ? 'in_progress' : 'pending');
      return { id: t.id, subject: t.subject, activeForm: t.activeForm, status: status, description: '', blockedBy: [], owner: '' };
    });
    const completed = tasks.filter(function (t) { return t.status === 'completed'; }).length;
    return M.ok({ tasks: tasks, total: tasks.length, completed: completed, activeStep: Math.min(step + 1, tasks.length), running: true });
  });

  M.route('GET', '/api/conversations/:id/token-usage', function (ctx) {
    return M.ok({ conversationId: ctx.params.id, promptTokens: 6120, completionTokens: 1840, totalTokens: 7960, calls: 4 });
  });

  M.route('GET', '/api/messages/:id/process-details', function (ctx) {
    const msg = M.state.messages.filter(function (m) { return m.id === ctx.params.id; })[0];
    return M.ok({ processDetails: msg ? msg.processDetails || [] : [] });
  });

  M.route('GET', '/api/process-details/:id', function (ctx) {
    return M.ok({ processDetails: [], id: ctx.params.id });
  });

  // Shape follows internal/attackchain/builder.go ChainJSON: nodes{id,type,label,risk_score,tool_call_id}, edges{source,target}.
  M.route('GET', '/api/attack-chain/:conversationId', function (ctx) {
    const convId = ctx.params.conversationId;
    if (!findConv(convId)) return M.fail(404, 'Conversation not found');
    const chain = attackChainFor(convId);
    if (!chain) return M.fail(404, 'Attack chain not generated yet');
    return M.ok(chain);
  });

  function attackChainFor(convId: string) {
    if (convId !== 'conv-recon-01' && convId !== 'conv-webapp-02') return null;
    return {
      nodes: [
        { id: 'n1', type: 'target', label: 'Port scan 198.51.100.0/24', risk_score: 0, tool_call_id: 'call-scan-1', metadata: {} },
        { id: 'n2', type: 'vulnerability', label: 'Admin login without rate limiting', risk_score: 78, tool_call_id: '', metadata: { severity: 'high' } },
        { id: 'n3', type: 'action', label: 'Validate lockout behaviour', risk_score: 40, tool_call_id: 'call-probe-2', metadata: {} },
      ],
      edges: [{ source: 'n1', target: 'n2' }, { source: 'n2', target: 'n3' }],
    };
  }

  M.route('POST', '/api/attack-chain/:conversationId/regenerate', function (ctx) {
    return M.ok({ conversationId: ctx.params.conversationId, status: 'queued' });
  });

  /* ---------- agent runs (background tasks) ---------- */

  // In-memory run registry: conversationId -> run. Runs are not persisted; a page
  // reload during a run simply shows the conversation as it was saved.
  const runs: Record<string, Run> = {};

  function activeRuns() {
    return Object.values(runs).filter(function (r) { return !r.done; });
  }

  function publish<K extends keyof RunEventData>(run: Run, type: K, message: string, data: RunEventData[K]) {
    const ev = { type: type, message: message || '', data: Object.assign({ conversationId: run.convId }, data || {}) };
    run.events.push(ev);
    run.listeners.forEach(function (fn) { fn(); });
  }

  function finish(run: Run) {
    run.done = true;
    run.listeners.forEach(function (fn) { fn(); });
    setTimeout(function () { if (runs[run.convId] === run) delete runs[run.convId]; }, 30000);
  }

  // Streams a run's events to one client. Replays from the start, then follows.
  // Aborting the client only stops this reader; the run keeps going.
  function followRun(run: Run, ctx: Context) {
    return M.sse(function (emit, stopped) {
      return new Promise<void>(function (resolve) {
        let index = 0;
        let wake: (() => void) | null = null;
        const listener = function () { if (wake) { const w = wake; wake = null; w(); } };
        run.listeners.push(listener);
        (async function () {
          while (!stopped()) {
            while (index < run.events.length && !stopped()) {
              const event = run.events[index];
              if (event) emit(event);
              index += 1;
            }
            if (run.done || stopped()) break;
            await new Promise<void>(function (r) { wake = r; setTimeout(r, 400); });
          }
          run.listeners = run.listeners.filter(function (f) { return f !== listener; });
          resolve();
        })();
      });
    }, { signal: ctx.signal });
  }

  M.route('GET', '/api/agent-loop/tasks', function () {
    return M.ok({
      tasks: activeRuns().map(function (r) {
        return { conversationId: r.convId, title: r.prompt.slice(0, 40), status: r.cancelled ? 'cancelling' : 'running', startedAt: r.startedAt, orchestration: r.orchestration };
      }),
    });
  });

  M.route('GET', '/api/agent-loop/tasks/completed', function () {
    return M.ok({ tasks: [] });
  });

  M.route('POST', '/api/agent-loop/cancel', bodies.agent, function (ctx) {
    const run = runs[(ctx.body && ctx.body.conversationId) || ''];
    if (run && !run.done) run.cancelled = true;
    return M.ok({ success: true });
  });

  // Reattach point for the UI after a navigation or HITL pause. Without an active
  // run it keeps the connection open with heartbeats, like the backend does.
  M.route('GET', '/api/agent-loop/task-events', function (ctx) {
    const convId = M.q(ctx, 'conversationId', '');
    const run = convId ? runs[convId] : activeRuns()[0];
    if (run && !run.done) return followRun(run, ctx);
    return M.sse(function (emit, stopped) {
      return new Promise<void>(function (resolve) {
        const timer = setInterval(function () {
          if (stopped()) { clearInterval(timer); resolve(); return; }
          emit({ type: 'heartbeat', message: '', data: {} });
        }, 15000);
      });
    }, { signal: ctx.signal });
  });

  /* ---------- scripted runs ---------- */

  const NMAP_OUTPUT = [
    'Starting Nmap (demo output)',
    'Nmap scan report for 198.51.100.10',
    '  80/tcp   open  http    nginx 1.24',
    '  443/tcp  open  https   nginx 1.24',
    'Nmap scan report for 198.51.100.22',
    '  80/tcp   open  http    Apache httpd 2.4',
    'Nmap done: 3 IP addresses (3 hosts up)',
  ].join('\n');

  function pickScenario(prompt: string): Scenario {
    const p = String(prompt || '').toLowerCase();
    if (/error|fail|crash/.test(p)) return 'error';
    if (/hitl|approve|replay|refresh|token/.test(p)) return 'hitl';
    if (/nmap|scan|port|enumerat|recon/.test(p)) return 'scan';
    return 'reply';
  }

  function replyText(scenario: Scenario, prompt: string) {
    if (scenario === 'scan') {
      return 'Scan completed. 3 hosts expose HTTP/HTTPS services.\n\n' +
        '- **198.51.100.10**: nginx 1.24 with an `/admin` login page (recorded as high risk: no rate limit)\n' +
        '- **198.51.100.22**: Apache 2.4 with a legacy `/old-cms/` path\n' +
        '- **198.51.100.31**: Node.js API (port 3000)\n\n' +
        'Next step: verify these findings in a "Web testing" conversation.';
    }
    if (scenario === 'hitl') {
      return 'Refresh-token rotation check completed. Rotated old tokens were still accepted for 60 seconds; recorded as a medium-severity vulnerability with reproduction steps.';
    }
    return 'Hi! This is a sample reply in demo mode that mimics the real backend streaming output. Try prompts containing "scan", "token" or "error" to see different flows.\n\nYour prompt: ' + String(prompt).slice(0, 200);
  }

  function chunk(text: string, size: number) {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  // Stores the user turn and the assistant turn once a run has produced an answer.
  function recordTurn(convId: string, prompt: string, reply: string, mcpIds: string[]) {
    const now = M.nowISO();
    M.state.messages.push({ id: M.id('msg'), conversationId: convId, role: 'user', content: prompt, reasoningContent: '', mcpExecutionIds: [], processDetails: [], createdAt: now, updatedAt: now });
    M.state.messages.push({ id: M.id('msg'), conversationId: convId, role: 'assistant', content: reply, reasoningContent: '', mcpExecutionIds: mcpIds, processDetails: [], createdAt: now, updatedAt: now });
    const conv = findConv(convId);
    if (conv) conv.item.updatedAt = now;
    M.save();
  }

  // The scripted run. Publishes into `run`; never looks at a client connection.
  async function executeRun(run: Run, scenario: Scenario, prompt: string) {
    // Slower than the raw timings so a run stays visible long enough to watch
    // the Progress and Agents panels change (the event order is unchanged).
    const pause = function (ms: number) { return M.sleep(ms * 3); };
    const reply = replyText(scenario, prompt);
    const mcpIds = scenario === 'scan' ? ['mcp-exec-' + M.id('x').slice(-6)] : [];
    const tool = scenario === 'scan' ? 'nmap_scan' : (scenario === 'hitl' ? 'token_replay' : 'search_knowledge');
    const mode = run.orchestration ? 'multi' : 'single';
    const stop = function () { return run.cancelled; };

    publish(run, 'conversation', '', { conversationId: run.convId });
    publish(run, 'message_saved', '', { userMessageId: M.id('msg') });
    await pause(120);
    publish(run, 'progress', 'Planning the next step', { stage: 'planning', mode: mode });
    await pause(180);
    publish(run, 'iteration', 'Iteration 1', { iteration: 1, mode: mode });
    await pause(160);
    publish(run, 'thinking', 'Analyzing the request and choosing tools…', { iteration: 1 });
    await pause(200);

    if (scenario === 'error') {
      publish(run, 'error', 'Model request failed: upstream timeout (demo)', { retryable: true });
      publish(run, 'done', '', { status: 'error' });
      finish(run);
      return;
    }

    publish(run, 'knowledge_retrieval', 'Retrieving knowledge: ' + prompt.slice(0, 30), { hits: scenario === 'hitl' ? 2 : 1 });
    await pause(160);
    publish(run, 'tool_calls_detected', '', { count: 1 });
    await pause(120);
    const toolCallId = 'call-' + M.id('t').slice(-6);
    publish(run, 'tool_call', 'Calling tool ' + tool, {
      toolName: tool, toolCallId: toolCallId, index: 1, total: 1,
      arguments: scenario === 'scan' ? { target: '198.51.100.0/24', ports: '80,443,3000' } : { query: prompt.slice(0, 60) },
    });

    if (scenario === 'hitl') {
      const interruptId = M.id('hitl');
      M.state.hitlPending.push({
        id: interruptId, interruptId: interruptId, conversationId: run.convId, tool: tool, toolName: tool,
        arguments: { endpoint: '/v1/auth/refresh', attempts: 5 }, reason: 'Repeated authenticated requests',
        status: 'pending', reviewer: 'human', created_at: M.nowISO(),
      });
      M.save();
      publish(run, 'hitl_interrupt', 'Waiting for manual approval: ' + tool, {
        interruptId: interruptId, toolName: tool, toolCallId: toolCallId,
        arguments: { endpoint: '/v1/auth/refresh', attempts: 5 }, reason: 'Repeated authenticated requests', status: 'pending', reviewer: 'human',
      });
      // Wait for a decision from the HITL page (POST /api/hitl/decision), a cancel, or 10 minutes.
      let waited = 0;
      while (!stop() && waited < 600000) {
        await pause(300);
        waited += 300;
        if (!M.state.hitlPending.some(function (h) { return h.id === interruptId; })) break;
      }
      const decision = (M.state.hitlDecisions || {})[interruptId];
      if (stop()) { publish(run, 'cancelled', 'Task cancelled', {}); finish(run); return; }
      if (decision === 'reject') {
        publish(run, 'hitl_rejected', 'Tool call rejected', { interruptId: interruptId, decision: 'reject' });
        publish(run, 'done', '', { status: 'completed' });
        recordTurn(run.convId, prompt, 'This tool call was rejected by a human and was not executed.', []);
        finish(run);
        return;
      }
      publish(run, 'hitl_resumed', 'Approved; continuing execution', { interruptId: interruptId, decision: 'approve' });
    }

    await pause(220);
    const output = scenario === 'scan' ? NMAP_OUTPUT : 'Demo result: 2 related knowledge entries found.';
    publish(run, 'tool_result', output, { toolName: tool, toolCallId: toolCallId, success: true, executionId: mcpIds[0] || '', durationMs: 1400 });
    await pause(140);
    publish(run, 'response_start', '', { mode: mode });
    const parts = chunk(reply, 18);
    for (const part of parts) {
      if (stop()) break;
      publish(run, 'response_delta', part, { delta: part });
      await pause(35);
    }
    if (stop()) { publish(run, 'cancelled', 'Task cancelled', {}); finish(run); return; }
    // Finalization fields tell the UI the answer is complete (monitor.js hasFinalizationContract).
    publish(run, 'response', reply, {
      mcpExecutionIds: mcpIds, messageId: '',
      finalized: true, finalizable: true, completionReason: 'completed', evidenceVerified: true, missingChecks: [],
    });
    recordTurn(run.convId, prompt, reply, mcpIds);
    publish(run, 'done', '', { status: 'completed', workflowStatus: '' });
    finish(run);
  }

  function startRun(ctx: Context<AgentBody>, orchestration: string) {
    const body = ctx.body || {};
    const prompt = String(body.message || '').trim();
    if (!prompt) return M.fail(400, 'Message is required');

    let convId = body.conversationId;
    if (!convId) {
      const created = { id: M.id('conv'), title: prompt.slice(0, 40), projectId: body.projectId || '', roleName: body.role || '', agentMode: orchestration || 'eino_single', pinned: false, createdAt: M.nowISO(), updatedAt: M.nowISO() };
      M.state.conversations.unshift(created);
      convId = created.id;
      M.save();
    }
    const run: Run = { convId: convId, prompt: prompt, orchestration: orchestration || '', events: [], listeners: [], done: false, cancelled: false, startedAt: M.nowISO() };
    runs[convId] = run;
    executeRun(run, pickScenario(prompt), prompt);
    return followRun(run, ctx);
  }

  M.route('POST', '/api/eino-agent/stream', bodies.agent, function (ctx) { return startRun(ctx, ''); });
  M.route('POST', '/api/multi-agent/stream', bodies.agent, function (ctx) {
    const configured = M.state.config?.multi_agent?.orchestration;
    return startRun(ctx, typeof configured === 'string' && configured ? configured : 'deep');
  });
}
