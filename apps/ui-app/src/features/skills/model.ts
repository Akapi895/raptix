/** Wire fields from internal/handler/skills.go and internal/skillpackage. */
export interface Skill {
  id?: string;
  name: string;
  description?: string;
  content?: string;
  version?: string;
  tags?: string[] | null;
  path?: string;
  mod_time?: string;
  updated_at?: string;
  file_count?: number;
  script_count?: number;
  scripts?: { rel_path?: string; description?: string; RelPath?: string; Description?: string }[] | null;
}
export interface PackageFile { path: string; is_dir?: boolean; size?: number }
export interface SkillStat { skill_name: string; total_calls: number; success_calls: number; failed_calls: number; last_call_time?: string }
export interface SkillStats { total: number; totalCalls: number; totalSuccess: number; totalFailed: number; skillsDir: string; stats: SkillStat[] }
export interface SkillEditor {
  id: string | null;
  path: string;
  name: string;
  description: string;
  content: string;
  files: PackageFile[];
  fileDirty: boolean;
  descriptionDirty: boolean;
  loading: boolean;
}
export interface SkillsState {
  skills: Skill[];
  page: number;
  pageSize: number;
  total: number;
  search: string;
  editor: SkillEditor | null;
  saving: boolean;
  stats: SkillStats;
}
export const emptyStats = (): SkillStats => ({ total: 0, totalCalls: 0, totalSuccess: 0, totalFailed: 0, skillsDir: '', stats: [] });
export const newEditor = (): SkillEditor => ({ id: null, path: 'SKILL.md', name: '', description: '', content: '', files: [], fileDirty: false, descriptionDirty: false, loading: false });
export const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
