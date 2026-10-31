import { z } from 'zod';
import { offsetFields, timestampSchema } from './common';

// internal/database/project.go:Project / ProjectFact. Status is a Go string;
// handlers permit values beyond the documented active/archived convention.
export const projectSchema = z.looseObject({
  id: z.string(), name: z.string(), description: z.string().optional(), scope_json: z.string().optional(),
  status: z.string(), pinned: z.boolean(), created_at: timestampSchema, updated_at: timestampSchema,
});
// internal/handler/project.go:ListProjects returns an offset envelope.
export const projectListSchema = z.looseObject({ projects: z.array(projectSchema), ...offsetFields });
export const projectFactSchema = z.looseObject({
  id: z.string(), project_id: z.string(), fact_key: z.string(), category: z.string(), summary: z.string(),
  body: z.string(), confidence: z.string(), source_conversation_id: z.string().optional(),
  source_message_id: z.string().optional(), pinned: z.boolean(), related_vulnerability_id: z.string().optional(),
  created_at: timestampSchema, updated_at: timestampSchema,
});
export type Project = z.infer<typeof projectSchema>;
export type ProjectFact = z.infer<typeof projectFactSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;

// internal/handler/project.go:createProjectRequest / updateProjectRequest.
// JSON null decodes to a nil pointer on update and therefore leaves that field alone.
export interface CreateProjectRequest { name: string; description?: string; scope_json?: string; status?: string }
export interface UpdateProjectRequest {
  name?: string | null; description?: string | null; scope_json?: string | null; status?: string | null; pinned?: boolean | null;
}
export type ProjectQuery = { status?: string; search?: string; limit?: number; offset?: number };
export type ProjectFactQuery = {
  limit?: number; offset?: number; category?: string; confidence?: string; search?: string;
  related_vulnerability_id?: string; exclude_deprecated?: boolean; sparse_only?: boolean;
};
