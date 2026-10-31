import { createAgentsService } from './service';
import { createAgentsView, type AgentsDependencies } from './view';
export { createAgentsClient, createAgentsService, parseToolsInput, AgentValidationError } from './service';
export type { MarkdownAgent, AgentDraft, AgentBody, AgentsClient, AgentsService } from './service';
export { renderAgentCards } from './view';
export type { AgentsDependencies } from './view';
export function initAgents(document: Document, dependencies: AgentsDependencies, service = createAgentsService()) {
  return createAgentsView(document, dependencies, service);
}
export type AgentsFeature = ReturnType<typeof initAgents>;
