/** JSON names follow internal/database/webshell.go. */
export interface WebshellConnection {
  id: string;
  project_id?: string;
  projectId?: string;
  url: string;
  password: string;
  type: string;
  method: string;
  cmdParam: string;
  remark: string;
  encoding: string;
  os: string;
  createdAt: string;
}
export type Encoding = 'auto' | 'utf-8' | 'gbk' | 'gb18030';
export type TargetOS = 'auto' | 'linux' | 'windows';
export type ConnectionDraft = Omit<WebshellConnection, 'id' | 'createdAt'>;
export interface ExecResult { ok: boolean; output?: string; error?: string; detected_os?: string; }
export interface FileRequest {
  action: string;
  path?: string;
  content?: string;
  target_path?: string;
  chunk_index?: number;
  total_chunks?: number;
  upload_id?: string;
  [key: string]: string | number | boolean | undefined;
}
export interface FileEntry { name: string; type: 'directory' | 'file' | 'link'; size: string; mtime: string; mode: string; owner?: string; group?: string; }
export interface TerminalSessions { sessions: { id: string; name: string }[]; activeId: string; }
export type DbType = 'mysql' | 'pgsql' | 'sqlite' | 'mssql';
export type DbSchema = Record<string, { tables: Record<string, string[]> }>;
export interface DbProfile {
  id: string; name: string; type: DbType; host: string; port: string;
  username: string; password: string; database: string; selectedDatabase: string;
  sqlitePath: string; sql: string; output: string; outputIsError: boolean; schema: DbSchema;
}
export interface DbState { profiles: DbProfile[]; activeProfileId: string; aiMemo: string; }
export interface PersistState { dbState: DbState; terminalSessions: TerminalSessions; }

export function normalizeWebshellEncoding(value: unknown): Encoding {
  const text = String(value ?? '').trim().toLowerCase().replace(/^utf8$/, 'utf-8');
  return text === 'utf-8' || text === 'gbk' || text === 'gb18030' ? text : 'auto';
}
export function normalizeWebshellOS(value: unknown): TargetOS {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'linux' || text === 'windows' ? text : 'auto';
}
export function connectionRequest(connection: WebshellConnection) {
  return {
    url: connection.url, password: connection.password || '', type: connection.type || 'php',
    method: (connection.method || 'post').toLowerCase(), cmd_param: connection.cmdParam || '',
    encoding: normalizeWebshellEncoding(connection.encoding), os: normalizeWebshellOS(connection.os),
    connection_id: connection.id || '',
  };
}
export function normalizeWebshellPath(value: unknown): string {
  let path = String(value ?? '.').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!path) return '.';
  if (path === '/') return path;
  if (/^[A-Za-z]:\/?$/.test(path)) return path.slice(0, 2) + '/';
  path = path.replace(/\/$/, '');
  return path || '.';
}
export function getWebshellParentPath(value: unknown): string {
  const path = normalizeWebshellPath(value);
  if (path === '/' || /^[A-Za-z]:\/$/.test(path)) return path;
  if (path === '.') return '..';
  if (/^(?:\.\.\/)*\.\.$/.test(path)) return path + '/..';
  const index = path.lastIndexOf('/');
  if (index < 0) return '.';
  const parent = path.slice(0, index) || (path.startsWith('/') ? '/' : '.');
  return /^[A-Za-z]:$/.test(parent) ? parent + '/' : parent;
}
export function joinWebshellPath(base: string, name: string): string {
  return normalizeWebshellPath((base === '/' ? '/' : base.replace(/\/$/, '') + '/') + name);
}
export function inferPathFromWindowsDirOutput(output: string): string {
  for (const line of output.replace(/\r/g, '').split('\n')) {
    const match = line.trim().match(/^(?:Directory of\s+([A-Za-z]:\\.*)|([A-Za-z]:\\.*)\s+\u7684\u76ee\u5f55)$/i);
    if (match) return normalizeWebshellPath(match[1] || match[2]);
  }
  return '';
}
export function parseWebshellListItems(output: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const raw of output.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^total\s+\d+/i.test(line)) continue;
    const unix = line.match(/^([bcdlps-][rwxStTs-]{9}[+@.]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+\s+\d+\s+\S+)\s+(.+)$/);
    if (unix) {
      const mode = unix[1] ?? '';
      const name = (unix[4] ?? '').replace(/ -> .*$/, '');
      const tokens = line.split(/\s+/);
      if (name && name !== '.' && name !== '..') entries.push({ name, mode, owner: tokens[2] || '', group: tokens[3] || '', size: unix[2] ?? '', mtime: unix[3] ?? '', type: mode.startsWith('d') ? 'directory' : mode.startsWith('l') ? 'link' : 'file' });
      continue;
    }
    const windows = line.match(/^(\d{2,4}[/-]\d{1,2}[/-]\d{1,4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s+(<(?:DIR|JUNCTION|SYMLINKD)>|[\d,]+)\s+(.+)$/i);
    if (windows) {
      const name = windows[4] ?? '';
      const directory = windows[3]?.startsWith('<') === true;
      if (name !== '.' && name !== '..') entries.push({ name, type: directory ? 'directory' : 'file', size: directory ? '' : windows[3]?.replace(/,/g, '') ?? '', mtime: `${windows[1]} ${windows[2]}`, mode: directory ? 'd' : '-', owner: '', group: '' });
    }
  }
  return entries;
}
export function newWebshellDbProfile(name = 'DB-1'): DbProfile {
  return { id: 'dbp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name, type: 'mysql', host: '127.0.0.1', port: '3306', username: 'root', password: '', database: '', selectedDatabase: '', sqlitePath: '/tmp/test.db', sql: 'SELECT 1;', output: '', outputIsError: false, schema: {} };
}
export function normalizeTerminalSessions(raw?: Partial<TerminalSessions> | null, prefix = 'Terminal'): TerminalSessions {
  const sessions = raw?.sessions?.length ? raw.sessions.map((session, index) => ({ id: String(session.id || 't' + (index + 1)), name: String(session.name || prefix + (index + 1)) })) : [{ id: 't1', name: prefix + '1' }];
  return { sessions, activeId: sessions.some(session => session.id === raw?.activeId) ? raw!.activeId! : sessions[0]!.id };
}
export function normalizeDbState(raw?: Partial<DbState> | null): DbState {
  const profiles = raw?.profiles?.length ? raw.profiles.map((profile, index) => ({ ...newWebshellDbProfile('DB-' + (index + 1)), ...profile, schema: normalizeDbSchema(profile?.schema) })) : [newWebshellDbProfile()];
  return { profiles, activeProfileId: profiles.some(profile => profile.id === raw?.activeProfileId) ? raw!.activeProfileId! : profiles[0]!.id, aiMemo: typeof raw?.aiMemo === 'string' ? raw.aiMemo.slice(0, 100000) : '' };
}
/** Old saved profiles used arrays of table names; newer profiles include a tables map. */
export function normalizeDbSchema(raw: unknown): DbSchema {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: DbSchema = {};
  for (const [database, value] of Object.entries(raw)) {
    const tables: Record<string, string[]> = {};
    if (Array.isArray(value)) {
      for (const table of value as unknown[]) { const name = String(table || '').trim(); if (name) tables[name] = []; }
    } else if (value && typeof value === 'object') {
      const source: unknown = 'tables' in value && value.tables && typeof value.tables === 'object' ? value.tables : value;
      if (source && typeof source === 'object') {
        for (const [table, columns] of Object.entries(source)) {
          const name = table.trim(); if (!name || name === 'tables') continue;
          tables[name] = Array.isArray(columns) ? [...new Set((columns as unknown[]).map(column => String(column || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : [];
        }
      }
    }
    result[database] = { tables: Object.fromEntries(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b))) };
  }
  return result;
}
