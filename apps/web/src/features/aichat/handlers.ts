/**
 * Feature-local chat handlers for the AI workspace (ticket 38, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Binds the ChatService to one actor/scope and builds request contexts at
 * call time, so a persona/project switch never retargets an in-flight
 * request. The store's legacy AI actions and the migrated screen both go
 * through these handlers; write commits are synchronous atomic authority
 * commits (the response timer in the store depends on that), reads register
 * with the factory's superseded-scope guard.
 */
import type { AiMode, Conversation } from '../../domain/entities'
import type { ActorRef, RequestContext, ServiceResult } from '../../domain/service'
import type { ConsoleServices } from '../../domain/console-services';
import type { ConversationListRead } from './service'

export interface ChatHandlers {
  list(): Promise<ServiceResult<ConversationListRead>>
  get(convId: string): Promise<ServiceResult<Conversation>>
  create(projectId: string, mode: AiMode): ServiceResult<Conversation>
  setMode(convId: string, mode: AiMode): ServiceResult<Conversation>
  setPinned(convId: string): ServiceResult<Conversation>
  send(convId: string, text: string): ServiceResult<Conversation>
  respond(convId: string, text: string): ServiceResult<Conversation>
  stop(convId: string): ServiceResult<Conversation>
}

/**
 * Builds the chat handlers for one actor/scope. `scopeProject` uses the
 * store's project vocabulary ('all' included); conversation writes resolve
 * their binding from the addressed conversation entity, so sending from the
 * aggregate scope into a project conversation stays correctly bound.
 */
export function createChatHandlers(svc: ConsoleServices, actor: ActorRef, scopeProject: string): ChatHandlers {
  const chat = svc.chat(actor, scopeProject)
  let seq = 0
  const ctx = (corr: string): RequestContext => ({ actor, projectId: scopeProject === 'all' ? 'all' : scopeProject, corr: `${corr}-${++seq}` })
  return {
    list: () => chat.list(ctx('chat-list')),
    get: (convId) => chat.get(ctx('chat-get'), convId),
    create: (projectId, mode) => chat.create(ctx('chat-create'), projectId, mode),
    setMode: (convId, mode) => chat.setMode(ctx('chat-mode'), convId, mode),
    setPinned: (convId) => chat.setPinned(ctx('chat-pin'), convId),
    send: (convId, text) => chat.send(ctx('chat-send'), convId, text),
    respond: (convId, text) => chat.respond(ctx('chat-respond'), convId, text),
    stop: (convId) => chat.stop(ctx('chat-stop'), convId),
  }
}
