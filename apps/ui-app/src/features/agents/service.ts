import { http } from '../../platform/http';

/** internal/handler/markdown_agents.go: List/GetMarkdownAgent and markdownAgentBody. */
export interface MarkdownAgent {
  filename: string;
  id: string;
  name: string;
  description?: string;
  is_orchestrator?: boolean;
  tools?: string[] | null;
  instruction?: string;
  bind_role?: string;
  max_iterations?: number;
  kind?: string;
  raw?: string;
}
export interface AgentDraft {
  filename: string; id: string; name: string; description: string; tools: string;
  instruction: string; bind_role: string; max_iterations: string; kind: string;
}
export interface AgentBody {
  filename?: string; id: string; name: string; description: string; tools: string[];
  instruction: string; bind_role: string; max_iterations: number; kind: string;
}
export interface AgentsClient {
  list(): Promise<{ agents?: MarkdownAgent[]; dir?: string }>;
  get(filename: string): Promise<MarkdownAgent>;
  save(filename: string | null, body: AgentBody): Promise<unknown>;
  delete(filename: string): Promise<unknown>;
}
export function createAgentsClient(transport = http): AgentsClient {
  const base = '/api/multi-agent/markdown-agents';
  const path = (filename: string) => base + '/' + encodeURIComponent(filename);
  return {
    list: () => transport.get(base),
    get: filename => transport.get(path(filename)),
    save: (filename, body) => filename ? transport.put(path(filename), body) : transport.post(base, body),
    delete: filename => transport.delete(path(filename)),
  };
}
export function parseToolsInput(value: string): string[] {
  return value.split(/[,;|]/).map(tool => tool.trim()).filter(Boolean);
}
export class AgentValidationError extends Error {}

export function createAgentsService(client: AgentsClient = createAgentsClient()) {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  let agents: MarkdownAgent[] = [];
  let directory = '';
  let editing: MarkdownAgent | null = null;
  let editingPending = false;
  let saving = false;
  let loading = false;
  let loadError: unknown;
  let listGeneration = 0;
  let editorGeneration = 0;
  async function load(): Promise<void> {
    const generation = ++listGeneration;
    loading = true; loadError = undefined; emit();
    try {
      const data = await client.list();
      if (generation !== listGeneration) return;
      agents = [...(data.agents ?? [])].sort((a, b) => Number(!!b.is_orchestrator) - Number(!!a.is_orchestrator));
      directory = data.dir ?? '';
    } catch (error) {
      if (generation !== listGeneration) return;
      loadError = error;
      throw error;
    } finally { if (generation === listGeneration) { loading = false; emit(); } }
  }
  function reset(): void { editorGeneration++; editing = null; editingPending = false; }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get state() { return { agents: [...agents], directory, editing, editingPending, saving, loading, loadError }; },
    load, reset,
    async edit(filename: string): Promise<MarkdownAgent | null> {
      reset();
      const generation = editorGeneration;
      editingPending = true;
      try {
        const agent = await client.get(filename);
        if (generation !== editorGeneration) return null;
        editing = { ...agent, filename: agent.filename || filename };
        return editing;
      } catch (error) {
        if (generation === editorGeneration) throw error;
        return null;
      } finally { if (generation === editorGeneration) editingPending = false; }
    },
    async save(draft: AgentDraft): Promise<boolean> {
      // An edit still loading must never accidentally POST a new file.
      if (saving || editingPending) return false;
      const name = draft.name.trim(), instruction = draft.instruction.trim(), filename = draft.filename.trim();
      if (!name) throw new AgentValidationError('agentsPage.nameRequired');
      if (!(editing?.is_orchestrator || draft.kind === 'orchestrator' || filename.toLowerCase() === 'orchestrator.md') && !instruction) throw new AgentValidationError('agentsPage.instructionRequired');
      if (!editing && filename && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/.test(filename)) throw new AgentValidationError('agentsPage.filenameInvalid');
      saving = true;
      try {
        await client.save(editing?.filename ?? null, {
          ...(!editing ? { filename } : {}), id: draft.id.trim(), name, description: draft.description.trim(),
          tools: parseToolsInput(draft.tools), instruction, bind_role: draft.bind_role.trim(),
          max_iterations: parseInt(draft.max_iterations, 10) || 0, kind: draft.kind === 'orchestrator' ? 'orchestrator' : '',
        });
        return true;
      } finally { saving = false; }
    },
    async delete(filename: string): Promise<void> { await client.delete(filename); },
    dispose(): void { reset(); listGeneration++; listeners.clear(); },
  };
}
export type AgentsService = ReturnType<typeof createAgentsService>;
