import { z } from 'zod';
import { http } from '../../platform/http';
import { successResultSchema, type ApiOptions } from '../types/common';
import { conversationListSchema } from '../types/conversation';
import { projectSchema, projectListSchema, projectFactSchema, type CreateProjectRequest, type UpdateProjectRequest, type ProjectQuery, type ProjectFactQuery } from '../types/project';

// internal/app/app.go routes; internal/handler/project.go request/response shapes.
export function createProjectsClient(transport = http) {
  const path = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
  return {
    list: (query: ProjectQuery = {}, options: ApiOptions = {}) => transport.get('/api/projects', { ...options, query, schema: projectListSchema }),
    get: (id: string, options: ApiOptions = {}) => transport.get(path(id), { ...options, schema: projectSchema }),
    create: (body: CreateProjectRequest, options: ApiOptions = {}) => transport.post('/api/projects', body, { ...options, schema: projectSchema }),
    update: (id: string, body: UpdateProjectRequest, options: ApiOptions = {}) => transport.put(path(id), body, { ...options, schema: projectSchema }),
    delete: (id: string, options: ApiOptions = {}) => transport.delete(path(id), { ...options, schema: successResultSchema }),
    conversations: (id: string, query: { limit?: number; offset?: number } = {}, options: ApiOptions = {}) => transport.get(`${path(id)}/conversations`, { ...options, query, schema: conversationListSchema }),
    // ListFacts returns a bare array, not an offset pagination envelope. Legacy
    // mock facts lack created_at; validation exposes that contract gap.
    facts: (id: string, query: ProjectFactQuery = {}, options: ApiOptions = {}) => transport.get(`${path(id)}/facts`, { ...options, query, schema: z.array(projectFactSchema) }),
    fact: (id: string, factKey: string, options: ApiOptions = {}) => transport.get(`${path(id)}/facts`, { ...options, query: { fact_key: factKey }, schema: projectFactSchema }),
  };
}
export const projects = createProjectsClient();
