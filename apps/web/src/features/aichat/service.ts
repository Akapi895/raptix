/**
 * AI chat + plan proposal handlers (ticket 38, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Conversations, mode selection and the simulated proposal generator live
 * here as feature-local handlers over the one database authority. The
 * proposal invariant (execution.md requirement 5) is structural: every
 * handler is proposal-shaped — conversations, chat messages, draft/proposed
 * plans and *denied* tool events — and the service deliberately exposes no
 * operation-start, plan-approval or tool-allow capability, so no caller can
 * reach execution from chat. An AiMode is display intent only: the generator
 * never executes, and execution requests are answered with a pointer to the
 * human approval path (the plan lifecycle owns approval and execution).
 *
 * Every request captures actor and project explicitly. Writes are
 * synchronous atomic commits (ctx captured at call time; never cancelled
 * mid-flight) and publish a ChangeSet both the legacy store and Query
 * consumers observe. Reads go through the factory's superseded-scope guard.
 * The addressed conversation is the write target: its own projectId is the
 * binding a late response respects — a response can never be retargeted to
 * another project, and a conversation the captured actor cannot access is
 * refused without leaking existence.
 */
import { projectAccessible, readOnlyContext } from '../../domain/policy'
import { formatDemoInstant, type MockClock } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { AiMode, Audit, ChatMsg, Conversation, Plan, PlanStep, Project } from '../../domain/entities'
import type { Db } from '../../demo/seed';
import type { RequestContext, ServiceResult } from '../../domain/service'

/** The workspace read: the scope's conversations, newest first. */
export interface ConversationListRead {
  conversations: Conversation[]
}

export interface ChatService {
  /** Scope-checked conversation list ('all' aggregates accessible projects). */
  list(ctx: RequestContext): Promise<ServiceResult<ConversationListRead>>
  /** One conversation (messages included); cross-context reads are refused with the owning project. */
  get(ctx: RequestContext, id: string): Promise<ServiceResult<Conversation>>
  /** Creates an empty conversation bound to a project the actor can access. */
  create(ctx: RequestContext, projectId: string, mode: AiMode): ServiceResult<Conversation>
  /** Sets the conversation mode — a display preference; never an authorization grant. */
  setMode(ctx: RequestContext, convId: string, mode: AiMode): ServiceResult<Conversation>
  /** Pins/unpins the conversation in the workspace rail. */
  setPinned(ctx: RequestContext, convId: string): ServiceResult<Conversation>
  /** Persists the user message and conversation title through the authority. */
  send(ctx: RequestContext, convId: string, text: string): ServiceResult<Conversation>
  /** Simulated assistant turn: proposal-shaped commits only (no execution path). */
  respond(ctx: RequestContext, convId: string, text: string): ServiceResult<Conversation>
  /** Records a generation stop as a system message (timer disposal is the caller's). */
  stop(ctx: RequestContext, convId: string): ServiceResult<Conversation>
}

const notFound = (id: string, projectId?: string): ServiceResult<never> => ({
  ok: false,
  failure: {
    kind: 'not-found',
    message: `Conversation ${id} does not exist or is not available for your account.`,
    entity: projectId ? { kind: 'conversation', id, projectId } : { kind: 'conversation', id },
  },
})

const readOnlyRefusal = (projectId: string): ServiceResult<never> => ({
  ok: false,
  failure: {
    kind: 'forbidden',
    message: 'This project is read-only: conversations cannot be changed here.',
    entity: { kind: 'conversation', id: projectId, projectId },
  },
})

/**
 * Pure list handler. Scope semantics match the other inventories: a specific
 * projectId reads only that project's conversations and only for members;
 * `'all'`/`''` aggregates across the actor's accessible projects.
 */
export function listConversations(db: Db, ctx: RequestContext): ServiceResult<ConversationListRead> {
  const aggregate = !ctx.projectId || ctx.projectId === 'all'
  const pid = ctx.projectId
  if (!aggregate) {
    const project = db.projects.find((p) => p.id === pid)
    // Out-of-scope reads are not-found, never a leaked existence signal.
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: 'Conversations for this project are not available for your account.' } }
    }
  }
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const conversations = db.conversations.filter((c) => (aggregate ? accessible.has(c.projectId) : c.projectId === pid))
  return { ok: true, data: { conversations } }
}

/** One scope-checked conversation read: not-found outside access, forbidden cross-context. */
export function getConversation(db: Db, ctx: RequestContext, id: string): ServiceResult<Conversation> {
  const conv = db.conversations.find((x) => x.id === id)
  if (!conv) return notFound(id)
  const project = db.projects.find((p) => p.id === conv.projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return notFound(id, conv.projectId)
  const aggregate = !ctx.projectId || ctx.projectId === 'all' || ctx.projectId === ''
  if (!aggregate && ctx.projectId !== conv.projectId) {
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message: `Conversation ${id} belongs to project ${conv.projectId}. Switch to that project to open it.`,
        entity: { kind: 'conversation', id, projectId: conv.projectId },
      },
    }
  }
  return { ok: true, data: conv }
}

/** Write precondition shared by every mutation: entity-bound membership + writable context. */
function addressConversation(db: Db, ctx: RequestContext, convId: string): ServiceResult<{ conv: Conversation; project: Project }> {
  const conv = db.conversations.find((x) => x.id === convId)
  const project = conv ? db.projects.find((p) => p.id === conv.projectId) : undefined
  if (!conv || !project || !projectAccessible(project, ctx.actor)) return notFound(convId, conv?.projectId)
  if (readOnlyContext(project, ctx.actor)) return readOnlyRefusal(project.id)
  return { ok: true, data: { conv, project } }
}

/** Creates an empty conversation. The id namespace stays per project. */
export function createConversation(authority: DbAuthority, clock: MockClock, ctx: RequestContext, projectId: string, mode: AiMode): ServiceResult<Conversation> {
  const db = authority.snapshot()
  const project = db.projects.find((p) => p.id === projectId)
  if (!project || !projectAccessible(project, ctx.actor)) return notFound(projectId, projectId)
  if (readOnlyContext(project, ctx.actor)) return readOnlyRefusal(projectId)
  const at = formatDemoInstant(clock.now())
  let created!: Conversation
  authority.commit(ctx.corr, (d) => {
    const id = 'CV-' + projectId.slice(-3) + '-' + String(d.conversations.filter((c) => c.projectId === projectId).length + 1).padStart(2, '0')
    created = { id, projectId, title: 'New conversation', mode, owner: ctx.actor.id, updated: at, messages: [] }
    d.conversations.unshift(created)
  })
  return { ok: true, data: created }
}

/** Mode selection changes assistance behavior only — it never grants permission. */
export function setConversationMode(authority: DbAuthority, clock: MockClock, ctx: RequestContext, convId: string, mode: AiMode): ServiceResult<Conversation> {
  const addressed = addressConversation(authority.snapshot(), ctx, convId)
  if (!addressed.ok) return addressed
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const c = d.conversations.find((x) => x.id === convId)!
    c.mode = mode
    c.updated = at
  })
  return { ok: true, data: authority.snapshot().conversations.find((x) => x.id === convId)! }
}

export function setConversationPinned(authority: DbAuthority, clock: MockClock, ctx: RequestContext, convId: string): ServiceResult<Conversation> {
  const addressed = addressConversation(authority.snapshot(), ctx, convId)
  if (!addressed.ok) return addressed
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const c = d.conversations.find((x) => x.id === convId)!
    c.pinned = !c.pinned
    c.updated = at
  })
  return { ok: true, data: authority.snapshot().conversations.find((x) => x.id === convId)! }
}

/** Persists one user message; the conversation title follows the first message. */
export function sendChatMessage(authority: DbAuthority, clock: MockClock, ctx: RequestContext, convId: string, text: string): ServiceResult<Conversation> {
  const addressed = addressConversation(authority.snapshot(), ctx, convId)
  if (!addressed.ok) return addressed
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const c = d.conversations.find((x) => x.id === convId)!
    if (c.title === 'New conversation') c.title = text.slice(0, 48)
    c.messages.push({ id: 'u' + Math.random().toString(36).slice(2, 7), role: 'user', text, at })
    c.updated = at
  })
  return { ok: true, data: authority.snapshot().conversations.find((x) => x.id === convId)! }
}

/** Records a stopped generation; the pending response is discarded (never applied late). */
export function stopChatGeneration(authority: DbAuthority, clock: MockClock, ctx: RequestContext, convId: string): ServiceResult<Conversation> {
  const addressed = addressConversation(authority.snapshot(), ctx, convId)
  if (!addressed.ok) return addressed
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    const c = d.conversations.find((x) => x.id === convId)!
    c.messages.push({ id: 's' + Math.random().toString(36).slice(2, 7), role: 'system', text: `Response generation stopped by ${ctx.actor.id}.`, at })
    c.updated = at
  })
  return { ok: true, data: authority.snapshot().conversations.find((x) => x.id === convId)! }
}

/** Picks the approved playbook a proposal builds on (keyword match, else first approved). */
const pickPlaybook = (p: Project, text: string, d: Db) => {
  const t = text.toLowerCase()
  const id = /detect|signal|soc|siem/.test(t) ? 'PB-002' : /cloud|config|iam/.test(t) || p.type === 'Assessment' ? 'PB-003' : 'PB-001'
  return d.playbooks.find((x) => x.id === id && x.status === 'approved') || d.playbooks.find((x) => x.status === 'approved')!
}

/**
 * Builds one plan proposal from the conversation. Every generated plan is
 * proposal-shaped: status `proposed` (the caller may downgrade to `draft`
 * when the ROE is not approved), tools are the demo's safe simulators, and
 * the rationale states that nothing runs until a reviewer approves.
 */
export const buildPlanProposal = (d: Db, p: Project, text: string, convId: string, requestedBy: string, at: string, prev?: Plan): Plan => {
  const pb = pickPlaybook(p, text, d)
  const inScope = d.assets.filter((a) => a.projectId === p.id && a.scope === 'in').slice(0, 3)
  const ags = d.agents.filter((a) => a.projectId === p.id && a.status === 'online' && (!a.op || a.op === prev?.opId)).slice(0, 2)
  const names = pb.steps
  const steps: PlanStep[] = names.map((name, i) => ({
    id: 'P' + String(i + 1).padStart(2, '0'), name, technique: pb.techniques[i % pb.techniques.length], asset: inScope.length ? inScope[i % inScope.length].name : '—', agent: ags.length ? ags[i % ags.length].id : '—',
    tool: ['host-info-collector', 'account-enumerator', 'group-enumerator', 'service-mapper', 'web-profiler', 'credential-validator (lab)', 'task-reviewer', 'data-sampler', 'remote-service-check', 'defense-sim (safe)', 'collector-sim', 'cleanup-summarizer'][i % 12],
    risk: /simulate|validate/i.test(name) ? 'medium' : 'low', needsApproval: /simulate|validate/i.test(name), rationale: `Supports the project objectives using only approved, in-scope targets.`,
  }))
  const id = 'PL-' + String(++d.counters.plan).padStart(3, '0')
  const plan: Plan = {
    id, projectId: p.id, title: `${pb.name} plan`, version: prev ? prev.version + 1 : 1, status: 'proposed', author: 'AI Operator', requestedBy, reviewer: d.projects.find((x) => x.id === p.id)?.members.find((m) => m.role === 'reviewer')?.user || 'Pat Kim',
    created: at, updated: at, playbookId: pb.id, assets: inScope.map((a) => a.id), agents: ags.map((a) => a.id), steps,
    rationale: `Runs the approved “${pb.name}” playbook (${names.length} steps) against ${inScope.length} in-scope assets using ${ags.length} healthy project agents. This is a proposal only; nothing runs until a reviewer approves it.`,
    risks: steps.filter((s) => s.needsApproval).length ? [`${steps.filter((s) => s.needsApproval).length} steps simulate sensitive behavior and need explicit approval.`] : ['No elevated risks identified.'],
    roeVersion: p.roeVersion, prevPlanId: prev?.id, conversationId: convId,
  }
  d.plans.unshift(plan)
  return plan
}

/**
 * Simulated assistant turn. Computes the response from one snapshot and
 * commits it atomically. Proposal invariant: the only entity writes are
 * conversation messages, `proposed`/`draft` plans and *denied* tool events
 * (blocked proposals with their audit row) — there is deliberately no code
 * path here that creates or starts an operation, approves a plan, or allows
 * a tool call. Out-of-scope requests are refused without naming or quoting
 * data from other projects.
 */
export function respondToChat(authority: DbAuthority, clock: MockClock, ctx: RequestContext, convId: string, text: string): ServiceResult<Conversation> {
  const addressed = addressConversation(authority.snapshot(), ctx, convId)
  if (!addressed.ok) return addressed
  const at = formatDemoInstant(clock.now())
  const d0 = authority.snapshot()
  const p = addressed.data.project
  const t = text.toLowerCase()
  const outAsset = d0.assets.find((a) => a.projectId === p.id && a.scope === 'out' && t.includes(a.name.toLowerCase()))
  const otherProj = d0.projects.find((x) => x.id !== p.id && (t.includes(x.id.toLowerCase()) || t.includes(x.client.split(' ')[0].toLowerCase()) && x.client !== p.client))
  const otherAsset = d0.assets.find((a) => a.projectId !== p.id && a.projectId && t.includes(a.name.toLowerCase()))
  const wantsPlan = /plan|run|discover|scan|assess|map|validate|test|enumerat|check|propose|draft/.test(t)
  const wantsExec = /execute|start|launch|go ahead/.test(t)
  authority.commit(ctx.corr, (d) => {
    const c = d.conversations.find((x) => x.id === convId)!
    const add = (m: Omit<ChatMsg, 'id' | 'at'>) => c.messages.push({ id: 'm' + Math.random().toString(36).slice(2, 7), at, ...m })
    c.updated = at
    const blockTool = (target: string, reason: string, tool = 'service-mapper') => {
      const id = 'TL-' + String(d.toolEvents.length + 1).padStart(2, '0') + Math.random().toString(36).slice(2, 4)
      d.toolEvents.unshift({ id, conversationId: convId, projectId: p.id, tool, target, params: 'scope=services', state: 'denied', at, reason })
      const audit: Audit = { id: 'AU-' + ++d.counters.audit, at, actor: 'AI Operator', role: 'System', action: 'Blocked tool call', obj: target, projectId: p.id, result: 'Denied', reason }
      d.audit.unshift(audit)
      return id
    }
    if (otherProj || otherAsset) {
      add({ role: 'ai', kind: 'blocked', text: `I can only work with data from ${p.id}. Information about other projects isn’t available in this conversation. Switch projects if you have access.`, toolId: blockTool(otherAsset?.name || otherProj!.id, 'Project isolation — cross-project data requested.') })
      return
    }
    if (outAsset) {
      add({ role: 'ai', kind: 'blocked', text: `I can’t do that. ${outAsset.name} is out of scope under ${p.roeVersion}, so the tool call was blocked.`, toolId: blockTool(outAsset.name, `Out of scope — asset is excluded by ${p.roeVersion}.`) })
      return
    }
    if (c.mode === 'observe') {
      const ops = d.operations.filter((o) => o.projectId === p.id)
      const run = ops.filter((o) => o.status === 'running')
      add({ role: 'ai', text: `Observe mode — read-only. ${p.id} is ${p.status} with ${d.assets.filter((a) => a.projectId === p.id && a.scope === 'in').length} in-scope assets, ${run.length} running operation${run.length === 1 ? '' : 's'} and ${d.findings.filter((f) => f.projectId === p.id).length} findings. Switch to Propose mode if you want me to draft a plan.` })
      return
    }
    if (p.roeStatus !== 'approved') {
      add({ role: 'ai', kind: 'blocked', text: `I can draft a plan, but execution is blocked: ${p.id} has no approved ROE (${p.roeVersion} is ${p.roeStatus}). Get the ROE approved first.` })
      if (wantsPlan) {
        const pl = buildPlanProposal(d, p, text, convId, ctx.actor.id, at)
        pl.status = 'draft'
        pl.risks = ['ROE is not approved — this plan cannot be approved or executed.']
        add({ role: 'ai', kind: 'plan', planId: pl.id, text: `Drafted ${pl.id}. It stays in Draft until the ROE is approved.` })
      }
      return
    }
    if (wantsExec && c.mode !== 'execution') {
      add({ role: 'ai', text: 'Execution needs Approved Execution mode and an approved plan. Switch modes, then ask me to execute the approved plan.' })
      return
    }
    if (wantsExec) {
      const ap = d.plans.find((x) => x.projectId === p.id && x.status === 'approved' && !x.opId)
      add({ role: 'ai', text: ap ? `Plan ${ap.id} v${ap.version} is approved. Open it to create the operation and run preflight; I will not start anything without your confirmation.` : 'There is no approved plan waiting to run. Ask me to propose a plan and send it for approval first.', kind: ap ? 'plan' : undefined, planId: ap?.id })
      return
    }
    if (wantsPlan) {
      const pl = buildPlanProposal(d, p, text, convId, ctx.actor.id, at)
      add({ role: 'ai', kind: 'plan', planId: pl.id, text: `I proposed plan ${pl.id} using the approved “${d.playbooks.find((x) => x.id === pl.playbookId)!.name}” playbook (${pl.steps.length} steps, ${pl.assets.length} in-scope assets). This is a proposal only; nothing has run.` })
      return
    }
    add({ role: 'ai', text: `I can answer questions about ${p.id} or draft a plan from approved playbooks. Try “Plan an internal discovery run for the in-scope hosts.”` })
  })
  return { ok: true, data: authority.snapshot().conversations.find((x) => x.id === convId)! }
}

/** Builds the typed chat service; `guard` is the factory's superseded-scope read guard. */
export function createChatService(
  authority: DbAuthority,
  clock: MockClock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): ChatService {
  return {
    list: (ctx) => guard(() => listConversations(authority.snapshot(), ctx)),
    get: (ctx, id) => guard(() => getConversation(authority.snapshot(), ctx, id)),
    create: (ctx, projectId, mode) => createConversation(authority, clock, ctx, projectId, mode),
    setMode: (ctx, convId, mode) => setConversationMode(authority, clock, ctx, convId, mode),
    setPinned: (ctx, convId) => setConversationPinned(authority, clock, ctx, convId),
    send: (ctx, convId, text) => sendChatMessage(authority, clock, ctx, convId, text),
    respond: (ctx, convId, text) => respondToChat(authority, clock, ctx, convId, text),
    stop: (ctx, convId) => stopChatGeneration(authority, clock, ctx, convId),
  }
}
