/**
 * Chat-card typed reads (ticket 67, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The shared chat cards (aichat/common) resolve their linked plan / tool / asset
 * records through these narrow projections instead of the database: one
 * cached derivation per authority publication, keyed by the record the card
 * renders. The reads add no access checks of their own — the cards render
 * whatever the conversation already references, and the conversation reads
 * enforce the one-membership rule.
 */
import type { Db } from '../../demo/seed';
import type { ChatMsg } from '../../domain/entities'
import type { Conversation, ToolEvent } from '../../domain/entities'
import type { RequestContext } from '../../domain/service'
import type { ConsoleServices } from '../../domain/console-services';
import { projectView } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

/** Plan and target-asset refs behind a tool-proposal card. */
export interface ToolProposalRefs {
  plan?: Db['plans'][number]
  asset?: Db['assets'][number]
}

export function readToolProposalRefs(services: ConsoleServices, ctx: RequestContext, tool: ToolEvent): ToolProposalRefs {
  return projectView(services, ctx, 'tool-refs.' + tool.id, (db) => ({
    plan: tool.planId ? db.plans.find((p) => p.id === tool.planId) : undefined,
    asset: db.assets.find((x) => x.projectId === tool.projectId && x.name === tool.target),
  }))
}

export function useToolProposalRefs(tool: ToolEvent): ToolProposalRefs {
  return useServiceProjection((services, ctx) => readToolProposalRefs(services, ctx, tool))
}

/** Plan and tool refs behind a chat message card. */
export interface MsgRefs {
  plan?: Db['plans'][number]
  tool?: Db['toolEvents'][number]
}

export function readMsgRefs(services: ConsoleServices, ctx: RequestContext, m: ChatMsg): MsgRefs {
  return projectView(services, ctx, 'msg-refs.' + m.id, (db) => ({
    plan: m.planId ? db.plans.find((p) => p.id === m.planId) : undefined,
    tool: m.toolId ? db.toolEvents.find((t) => t.id === m.toolId) : undefined,
  }))
}

export function useMsgRefs(m: ChatMsg): MsgRefs {
  return useServiceProjection((services, ctx) => readMsgRefs(services, ctx, m))
}

/** Branch groups surfaced under one conversation (its plans' fan-outs). */
export function readConversationGroups(services: ConsoleServices, ctx: RequestContext, conv?: Conversation): { groups: Db['branchGroups'] } {
  return projectView(services, ctx, 'conv-groups.' + (conv?.id ?? 'none'), (db) => ({
    groups: conv ? db.branchGroups.filter((g) => g.projectId === conv.projectId && db.plans.some((p) => p.id === g.planId && p.conversationId === conv.id)) : [],
  }))
}

export function useConversationGroups(conv?: Conversation): { groups: Db['branchGroups'] } {
  return useServiceProjection((services, ctx) => readConversationGroups(services, ctx, conv))
}

/** The workspace rail's items for one project: conversations, plans and awaiting tool approvals. */
export interface AiRailRead {
  conversations: Db['conversations']
  plans: Db['plans']
  awaitingTools: Db['toolEvents']
}

export function readAiRail(services: ConsoleServices, ctx: RequestContext, projectId: string): AiRailRead {
  return projectView(services, ctx, 'ai-rail.' + projectId, (db) => ({
    conversations: db.conversations.filter((c) => c.projectId === projectId),
    plans: db.plans.filter((p) => p.projectId === projectId),
    awaitingTools: db.toolEvents.filter((t) => t.projectId === projectId && t.state === 'awaiting'),
  }))
}

export function useAiRail(projectId: string): AiRailRead {
  return useServiceProjection((services, ctx) => readAiRail(services, ctx, projectId))
}

/** The context inspector's project slices for one project (pending session requests only). */
export interface AiBundleRead {
  project?: Db['projects'][number]
  assets: Db['assets']
  operations: Db['operations']
  plans: Db['plans']
  branchGroups: Db['branchGroups']
  toolEvents: Db['toolEvents']
  sessionRequests: Db['sessionRequests']
  evidence: Db['evidence']
  agents: Db['agents']
}

export function readAiBundle(services: ConsoleServices, ctx: RequestContext, projectId: string): AiBundleRead {
  return projectView(services, ctx, 'ai-bundle.' + projectId, (db) => ({
    project: db.projects.find((p) => p.id === projectId),
    assets: db.assets.filter((a) => a.projectId === projectId),
    operations: db.operations.filter((o) => o.projectId === projectId),
    plans: db.plans.filter((x) => x.projectId === projectId),
    branchGroups: db.branchGroups.filter((g) => g.projectId === projectId),
    toolEvents: db.toolEvents.filter((t) => t.projectId === projectId),
    sessionRequests: db.sessionRequests.filter((r) => r.projectId === projectId && r.status === 'pending'),
    evidence: db.evidence.filter((e) => e.projectId === projectId),
    agents: db.agents.filter((a) => a.projectId === projectId),
  }))
}

export function useAiBundle(projectId: string): AiBundleRead {
  return useServiceProjection((services, ctx) => readAiBundle(services, ctx, projectId))
}

/** The conversation header's plan/operation focus (latest referenced plan first). */
export function readConversationFocus(services: ConsoleServices, ctx: RequestContext, conv: Conversation): { plan?: Db['plans'][number]; op?: Db['operations'][number] } {
  return projectView(services, ctx, 'conv-focus.' + conv.id, (db) => {
    const plan = [...conv.messages].reverse().map((m) => (m.planId ? db.plans.find((x) => x.id === m.planId) : undefined)).find(Boolean)
    return { plan, op: plan?.opId ? db.operations.find((o) => o.id === plan.opId) : undefined }
  })
}

export function useConversationFocus(conv: Conversation): { plan?: Db['plans'][number]; op?: Db['operations'][number] } {
  return useServiceProjection((services, ctx) => readConversationFocus(services, ctx, conv))
}
