/**
 * Chat-card typed reads (ticket 67, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The shared chat cards (g-common) resolve their linked plan / tool / asset
 * records through these narrow projections instead of the database: one
 * cached derivation per authority publication, keyed by the record the card
 * renders. The reads add no access checks of their own — the cards render
 * whatever the conversation already references, and the conversation reads
 * enforce the one-membership rule.
 */
import type { ChatMsg, Db } from '../../data'
import type { Conversation, ToolEvent } from '../../domain/entities'
import type { RequestContext } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'
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
