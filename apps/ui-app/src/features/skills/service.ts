import type { KeyValueStorage } from '../../platform/storage';
import { emptyStats, newEditor, type PackageFile, type Skill, type SkillsState, type SkillStat } from './model';

export type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;
export class SkillError extends Error {}
export function createSkillsService(deps: { request: RequestFn; storage: KeyValueStorage }) {
  const { request, storage } = deps;
  const savedSize = Number(storage.get('skillsPageSize'));
  const state: SkillsState = { skills: [], page: 1, pageSize: [10, 20, 50, 100].includes(savedSize) ? savedSize : 20, total: 0, search: '', editor: null, saving: false, stats: emptyStats() };
  let listVersion = 0;
  let editorVersion = 0;
  let fileVersion = 0;
  let disposed = false;

  async function json<T>(path: string, init?: RequestInit, fallback = 'skills.loadDetailFailed'): Promise<T> {
    if (disposed) throw new SkillError('Skills service disposed');
    const response = await request(path, init);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new SkillError(body?.error || fallback);
    }
    return await response.json() as T;
  }
  const base = (id: string) => `/api/skills/${encodeURIComponent(id)}`;
  const write = (method: string, payload?: object): RequestInit => ({ method, ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
  async function detail(id: string, depth: 'full' | 'summary'): Promise<Skill> {
    const data = await json<{ skill?: Skill } & Partial<Skill>>(`${base(id)}?depth=${depth}`);
    // Go wraps the detail; the demo returns it directly.
    const skill = data.skill ?? data;
    if (!skill.name) throw new SkillError('skills.loadDetailFailed');
    return { ...skill, name: skill.name };
  }
  async function files(id: string): Promise<PackageFile[]> {
    const data = await json<{ files?: (PackageFile | string)[] | null }>(`${base(id)}/files`);
    return (data.files ?? []).map(file => typeof file === 'string' ? { path: file } : file);
  }
  const api = {
    get state(): Readonly<SkillsState> { return state; },
    async load(page = 1, pageSize = state.pageSize, search = ''): Promise<boolean> {
      const version = ++listVersion;
      state.page = Math.max(1, page); state.pageSize = pageSize; state.search = search.trim();
      const query = new URLSearchParams({ limit: String(state.search ? 10000 : pageSize), offset: String(state.search ? 0 : (state.page - 1) * pageSize) });
      if (state.search) query.set('search', state.search);
      const data = await json<{ skills?: Skill[] | null; total?: number }>(`/api/skills?${query}`, undefined, 'skills.loadListFailed').catch(error => { if (disposed || version !== listVersion) return null; throw error; });
      if (!data || disposed || version !== listVersion) return false;
      state.skills = data.skills ?? []; state.total = data.total ?? 0;
      return true;
    },
    async changePageSize(size: number): Promise<boolean> {
      if (![10, 20, 50, 100].includes(size)) return false;
      storage.set('skillsPageSize', String(size));
      return api.load(Math.min(state.page, Math.max(1, Math.ceil(state.total / size))), size);
    },
    beginCreate(): void { editorVersion++; fileVersion++; state.editor = newEditor(); },
    closeEditor(): void { editorVersion++; fileVersion++; state.editor = null; },
    updateEditor(field: 'name' | 'description' | 'content', value: string): void {
      const editor = state.editor; if (!editor) return;
      editor[field] = value;
      if (field === 'description') editor.descriptionDirty = true;
      if (field === 'content') editor.fileDirty = true;
    },
    async beginEdit(id: string): Promise<boolean> {
      const version = ++editorVersion; fileVersion++;
      state.editor = { ...newEditor(), id, loading: true };
      const result = await Promise.all([detail(id, 'full'), files(id).catch(() => [])]).catch(error => { if (disposed || version !== editorVersion) return null; throw error; });
      if (!result || disposed || version !== editorVersion) return false;
      const [skill, packageFiles] = result;
      state.editor = { ...newEditor(), id, name: skill.id || id, description: skill.description ?? '', content: skill.content ?? '', files: packageFiles };
      return true;
    },
    /** Caller confirms discarding a dirty file. Description must be saved on SKILL.md first. */
    async selectFile(path: string, fresh = false): Promise<boolean> {
      const editor = state.editor;
      if (!editor?.id) return false;
      if (path !== 'SKILL.md' && editor.descriptionDirty) throw new SkillError('skillModal.saveDescriptionFirst');
      if (!path || path.includes('..') || path.startsWith('/')) throw new SkillError('skillModal.newFilePathInvalid');
      const version = ++fileVersion;
      const content = fresh ? '' : path === 'SKILL.md' ? (await detail(editor.id, 'full')).content ?? '' : (await json<{ content?: string }>(`${base(editor.id)}/file?path=${encodeURIComponent(path)}`)).content ?? '';
      if (disposed || state.editor !== editor || version !== fileVersion) return false;
      editor.path = path; editor.content = content; editor.fileDirty = fresh;
      return true;
    },
    detail,
    async save(): Promise<'created' | 'updated' | 'busy'> {
      if (state.saving) return 'busy';
      const editor = state.editor;
      if (!editor || editor.loading) throw new SkillError('skills.loadDetailFailed');
      const name = editor.name.trim(); const description = editor.description.trim(); const body = editor.content.trim();
      if (!name) throw new SkillError('skills.nameRequired');
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new SkillError('skills.nameInvalid');
      if (!editor.id && !description) throw new SkillError('skills.descriptionRequired');
      if ((!editor.id || editor.path === 'SKILL.md') && !body) throw new SkillError('skills.contentRequired');
      state.saving = true;
      try {
        if (!editor.id) {
          await json('/api/skills', write('POST', { name, description, content: body }), 'skills.saveFailed');
          if (state.editor === editor) api.closeEditor();
          return 'created';
        }
        await json(editor.path === 'SKILL.md' ? base(editor.id) : `${base(editor.id)}/file`, write('PUT', editor.path === 'SKILL.md' ? { description, content: body } : { path: editor.path, content: editor.content }), 'skills.saveFailed');
        editor.fileDirty = false;
        if (editor.path === 'SKILL.md') editor.descriptionDirty = false;
        editor.files = await files(editor.id).catch(() => editor.files);
        return 'updated';
      } finally { state.saving = false; }
    },
    async boundRoles(id: string): Promise<string[]> {
      try { const data = await json<{ bound_roles?: string[]; roles?: string[] }>(`${base(id)}/bound-roles`); return data.bound_roles ?? data.roles ?? []; }
      catch { return []; }
    },
    async remove(id: string): Promise<string[]> {
      const data = await json<{ affected_roles?: string[] }>(base(id), write('DELETE'), 'skills.deleteFailed');
      return data.affected_roles ?? [];
    },
    async loadMonitor(): Promise<void> {
      const data = await json<{ total_skills?: number; total_calls?: number; total_success?: number; total_failed?: number; skills_dir?: string; stats?: SkillStat[] | null; total?: number; invocations?: number; by_skill?: { name: string; invocations: number }[] }>('/api/skills/stats', undefined, 'skills.loadStatsFailed');
      if (disposed) return;
      state.stats = { total: data.total_skills ?? data.total ?? 0, totalCalls: data.total_calls ?? data.invocations ?? 0, totalSuccess: data.total_success ?? 0, totalFailed: data.total_failed ?? 0, skillsDir: data.skills_dir ?? '', stats: data.stats ?? data.by_skill?.map(stat => ({ skill_name: stat.name, total_calls: stat.invocations, success_calls: 0, failed_calls: 0 })) ?? [] };
    },
    async clearStats(): Promise<void> { await json('/api/skills/stats', write('DELETE'), 'skills.clearStatsFailed'); },
    dispose(): void { disposed = true; listVersion++; editorVersion++; fileVersion++; },
  };
  return api;
}
export type SkillsService = ReturnType<typeof createSkillsService>;
