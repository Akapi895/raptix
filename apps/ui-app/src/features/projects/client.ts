import { http, HttpError } from '../../platform/http';
import type { CreateProjectRequest, UpdateProjectRequest } from '../../api/types/project';
import type { FactGraph } from '../fact-graph';
import type { Approval, Asset, Fact, FactLink, FactInput, Project, ProjectConversation, ProjectQuery, Promotion, Stats, TaskSummary, VulnerabilitySummary } from './types';

type ProjectEnvelope = { projects?: Project[]; items?: Project[]; total?: number | string; limit?: number | string; offset?: number | string };
type Vulnerabilities = VulnerabilitySummary[] | { Vulnerabilities?: VulnerabilitySummary[]; vulnerabilities?: VulnerabilitySummary[]; items?: VulnerabilitySummary[] };
// The demo predates Go's single-fact response and uses an incoming-link count.
// Normalize only this boundary; the rest of the feature works with real links.
type FactResponse = Pick<Fact, 'id' | 'project_id' | 'fact_key' | 'category' | 'summary' | 'body' | 'confidence' | 'pinned' | 'updated_at' | 'related_vulnerability_id' | 'source_conversation_id' | 'source_message_id' | 'link_counts'> & {
  created_at?: string; incoming_links?: FactLink[] | number; deprecated?: boolean;
};
function normalizeFact(fact: FactResponse): Fact {
  return { ...fact, created_at: fact.created_at ?? '', incoming_links: Array.isArray(fact.incoming_links) ? fact.incoming_links : [], confidence: fact.deprecated ? 'deprecated' : fact.confidence, body: fact.body || '' };
}
export function vulnerabilityItems(data: Vulnerabilities): VulnerabilitySummary[] {
  return Array.isArray(data) ? data : data.Vulnerabilities ?? data.vulnerabilities ?? data.items ?? [];
}
// Local clients cover the additional Go endpoints and the historical demo
// envelopes. Shared schemas deliberately reject older demo timestamps; use the
// explicit Go DTOs here rather than changing those schemas for the entire app.
export function createProjectsApi(transport = http) {
  const path = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
  return {
    list: (query: ProjectQuery) => transport.get<Project[] | ProjectEnvelope>('/api/projects', { query }),
    get: (id: string) => transport.get<Project>(path(id)),
    save: (id: string, body: CreateProjectRequest | UpdateProjectRequest) => id ? transport.put<Project>(path(id), body) : transport.post<Project>('/api/projects', body),
    delete: (id: string) => transport.delete<unknown>(path(id)),
    stats: (id: string) => transport.get<Stats>(`${path(id)}/stats`),
    facts: async (id: string, query: Record<string, string | boolean | number> = {}) => (await transport.get<FactResponse[]>(`${path(id)}/facts`, { query: { ...query, ...(query.exclude_deprecated ? { hide_deprecated: true } : {}) } })).map(normalizeFact),
    fact: async (id: string, key: string) => {
      const response = await transport.get<FactResponse | FactResponse[]>(`${path(id)}/facts`, { query: { fact_key: key, include_links: true } });
      const fact = Array.isArray(response) ? response.find(fact => fact.fact_key === key) : response;
      if (!fact) throw new HttpError(404, `${path(id)}/facts`, { error: 'Fact not found' });
      return normalizeFact(fact);
    },
    saveFact: async (id: string, factId: string, body: FactInput) => normalizeFact(await (factId ? transport.put<FactResponse>(`${path(id)}/facts/${encodeURIComponent(factId)}`, body) : transport.post<FactResponse>(`${path(id)}/facts`, body))),
    deleteFact: (id: string, factId: string) => transport.delete<unknown>(`${path(id)}/facts/${encodeURIComponent(factId)}`),
    confidence: (id: string, key: string, restore: boolean) => transport.post<unknown>(`${path(id)}/facts/${restore ? 'restore' : 'deprecate'}`, { fact_key: key, fact_keys: [key], ...(restore ? { confidence: 'tentative' } : {}) }),
    graph: (id: string, view: string, exclude: boolean) => transport.get<FactGraph>(`${path(id)}/fact-graph`, { query: { view, ...(!exclude ? { exclude_deprecated: '0' } : {}) } }),
    createEdge: (id: string, source: string, target: string, type: string) => transport.post<unknown>(`${path(id)}/fact-edges`, { source_fact_key: source, target_fact_key: target, edge_type: type }),
    deleteEdge: (id: string, edge: string) => transport.delete<unknown>(`${path(id)}/fact-edges/${encodeURIComponent(edge)}`),
    assets: (id: string, page: number, size: number) => transport.get<{ assets: Asset[]; page: number; total: number; total_pages: number }>('/api/assets', { query: { project_id: id, page, page_size: size } }),
    unbindAsset: (id: string) => transport.put<unknown>('/api/assets/project-binding', { asset_ids: [id], project_id: '' }),
    conversations: (id: string) => transport.get<{ conversations: ProjectConversation[] }>(`${path(id)}/conversations`, { query: { limit: 100 } }),
    bindConversation: (id: string, projectId: string) => transport.put<unknown>(`/api/conversations/${encodeURIComponent(id)}/project`, { projectId }),
    promote: (id: string, conversationId: string) => transport.post<Promotion>(`${path(id)}/promote-attack-chain/${encodeURIComponent(conversationId)}`),
    vulnerabilities: async (id: string, query: Record<string, string | number> = {}) => vulnerabilityItems(await transport.get<Vulnerabilities>('/api/vulnerabilities', { query: { project_id: id, limit: 200, ...query } })),
    createVulnerability: (body: { conversation_id: string; project_id: string; title: string; description: string; severity: string; status: string; type: string; target: string; proof: string; impact: string; recommendation: string }) => transport.post<VulnerabilitySummary>('/api/vulnerabilities', body),
    folderConversations: () => transport.get<ProjectConversation[] | { conversations?: ProjectConversation[]; items?: ProjectConversation[] }>('/api/conversations', { query: { limit: 1000, offset: 0, sort_by: 'updated_at' } }),
    activeTasks: () => transport.get<{ tasks: TaskSummary[] }>('/api/agent-loop/tasks'),
    completedTasks: () => transport.get<{ tasks: TaskSummary[] }>('/api/agent-loop/tasks/completed'),
    pending: () => transport.get<{ items: Approval[] }>('/api/hitl/pending', { query: { page: 1, pageSize: 200 } }),
  };
}
export type ProjectsApi = ReturnType<typeof createProjectsApi>;
