/** Additive-only specialist configuration. IDs are runtime catalog identities. */
export interface SpecialistAdditions { skills: string[]; tools: string[]; mcp: string[] }
export interface SpecialistSelection extends SpecialistAdditions { global_revision: number; project_revision: number }
export interface SpecialistSnapshot { version: 1; revision: number; project_id: string | null; specialists: Record<string, SpecialistSelection> }
export interface SpecialistDescriptor { id: string; name: string; description: string; available?: boolean; source?: string; status?: string }
export interface SpecialistCapability {
  id: string; name: string; description: string; source: string; installed: boolean;
  available: boolean; status: string; requirements: string[]; runtime_name?: string; execution_readiness?: string;
}
export interface SpecialistMcpServer {
  id: string; name: string; configured: boolean; enabled: boolean; installed: boolean;
  reachable: boolean; available: boolean; status: string; tools: SpecialistCapability[];
  requirements: string[]; error?: string;
}
export interface SpecialistCatalog {
  specialist_id: string;
  builtins: { tools: string[]; skills: string[]; skill_sources: string[]; behavior: string };
  skills: SpecialistCapability[]; tools: SpecialistCapability[]; servers: SpecialistMcpServer[];
}
export interface SpecialistConfiguration {
  specialist_id: string; project_id: string | null; revision: number;
  global: SpecialistAdditions; project: SpecialistAdditions;
  global_revision: number; project_revision: number; effective: SpecialistAdditions;
  builtins: SpecialistCatalog['builtins']; resolved: SpecialistAdditions;
  diagnostics: { id: string; kind: string; status: string; message: string }[];
  status: 'ready_for_new_run' | 'unavailable';
}
export const specialistAdditionsSchema = {
  type: 'object', additionalProperties: false, required: ['skills', 'tools', 'mcp'],
  properties: Object.fromEntries(['skills', 'tools', 'mcp'].map(key => [key, {
    type: 'array', maxItems: 200, uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 512 },
  }])),
} as const;
