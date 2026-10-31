/** Wire contracts from internal/database/c2.go and internal/handler/c2.go. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined };
export interface C2Listener {
  id: string; project_id?: string; projectId?: string; name: string; type: string;
  bindHost: string; bindPort: number; profileId: string; profile_id?: string;
  status: string; configJson: string; remark: string; ownerUserId?: string;
  createdAt: string; startedAt?: string; lastError?: string;
}
export interface C2Session {
  id: string; listenerId: string; implantUuid: string; hostname: string; username: string;
  os: string; arch: string; pid: number; processName: string; isAdmin: boolean;
  internalIp: string; externalIp: string; userAgent: string; sleepSeconds: number;
  jitterPercent: number; status: string; firstSeenAt: string; lastCheckIn: string;
  metadata?: Record<string, JsonValue | undefined>; note: string;
}
export interface C2Task {
  id: string; sessionId: string; taskType: string; payload?: Record<string, JsonValue | undefined>;
  status: string; resultText?: string; resultBlobPath?: string; error?: string;
  source: string; conversationId?: string; approvalStatus?: string; createdAt: string;
  sentAt?: string; startedAt?: string; completedAt?: string; durationMs?: number;
}
export interface C2Event {
  id: string; level: string; category: string; sessionId?: string; taskId?: string;
  message: string; data?: Record<string, JsonValue | undefined>; createdAt: string;
}
export interface C2Profile {
  id: string; ID?: string; name: string; userAgent: string; uris: string[];
  requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string>;
  bodyTemplate: string; jitterMinMs: number; jitterMaxMs: number;
  extra?: Record<string, JsonValue | undefined>; createdAt: string;
}
export interface ListenerDraft {
  name: string; type?: string; bind_host: string; bind_port: number;
  remark: string; callback_host: string; project_id: string; profile_id: string;
  config?: Record<string, JsonValue | undefined>;
}
export interface ProfileDraft {
  name: string; userAgent: string; uris: string[]; requestHeaders?: Record<string, string>;
  responseHeaders: Record<string, string>; bodyTemplate?: string; jitterMinMs: number; jitterMaxMs: number; extra?: Record<string, JsonValue | undefined>;
}
export interface SessionFilter { status: string; listener_id: string; search: string; suspicious: boolean; }
export interface TaskFilter { status: string; task_type: string; session_id: string; since: string; timePreset: string; }
export interface EventFilter { level: string; category: string; session_id: string; since: string; timePreset: string; }
export interface TaskCounts { success: number; failed: number; pending: number; cancelled: number; }
export interface EventCounts { info: number; warn: number; critical: number; }
export interface TasksResponse { tasks?: C2Task[]; total?: number; status_counts?: TaskCounts; pending_queued_count?: number; }
export interface EventsResponse { events?: C2Event[]; total?: number; level_counts?: EventCounts; }
export interface TaskCreated { task?: C2Task; task_id?: string; }
export interface PayloadBuild { payload: { os: string; arch: string; size_bytes: number; download_path: string }; }
export interface C2FileEntry { name: string; isDir: boolean; size: string; permissions: string; mtime: string; }

export function listenerConfig(listener?: C2Listener): Record<string, JsonValue | undefined> {
  if (!listener?.configJson) return {};
  try { const value: unknown = JSON.parse(listener.configJson); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue | undefined> : {}; } catch { return {}; }
}
export function listenerCallbackHost(listener: C2Listener): string {
  const config = listenerConfig(listener);
  return String(config.callback_host || config.callbackHost || (listener.bindHost === '0.0.0.0' || listener.bindHost === '::' ? '' : listener.bindHost) || '');
}
export function formatTaskCommand(task: C2Task): string {
  const type = String(task.taskType || '').toLowerCase(); const payload = task.payload;
  if (!payload || !Object.keys(payload).length) return ['pwd', 'ps', 'screenshot'].includes(type) ? type : '';
  switch (type) {
    case 'shell': case 'exec': return String(payload.command ?? '');
    case 'ls': case 'cd': return String(payload.path ?? '');
    case 'download': return String(payload.remote_path ?? '');
    case 'upload': return String(payload.remote_path || (payload.file_id ? 'file:' + payload.file_id : ''));
    case 'kill_proc': return payload.pid != null ? 'pid:' + payload.pid : '';
    case 'sleep': return [payload.seconds != null ? 'sleep ' + payload.seconds + 's' : '', payload.jitter != null ? 'jitter ' + payload.jitter + '%' : ''].filter(Boolean).join(', ');
    case 'port_fwd': return [payload.action, payload.remote_host, payload.remote_port, payload.local_port].filter(value => value != null && value !== '').join(':');
    case 'socks_start': case 'socks_stop': return payload.port != null ? 'port:' + payload.port : type;
    case 'load_assembly': return String(payload.args || (payload.file_id ? 'file:' + payload.file_id : ''));
    case 'persist': return String(payload.method ?? '');
    default: return JSON.stringify(payload);
  }
}

/** Presentation only: never changes the server's status or execution eligibility. */
export function sessionState(session: C2Session, now = Date.now()): 'active' | 'sleeping' | 'stale' | 'disconnected' | 'unknown' {
  const status = String(session.status || '').toLowerCase();
  if (['dead', 'killed', 'disconnected'].includes(status)) return 'disconnected';
  if (status === 'stale') return 'stale';
  if (!['active', 'sleeping'].includes(status)) return 'unknown';
  const last = Date.parse(session.lastCheckIn) || Date.parse(session.firstSeenAt);
  // Mirrors the default backend watchdog window, without asserting disconnection.
  const sleep = Number(session.sleepSeconds); const jitter = Math.max(0, Math.min(100, Number(session.jitterPercent) || 0));
  const threshold = sleep > 0 ? Math.max(30, Math.trunc(sleep * (1 + jitter / 100) * 3)) : 60;
  if (Number.isFinite(last) && last > 0 && now - last > threshold * 1000) return 'stale';
  return status as 'active' | 'sleeping';
}
export function eventReference(event: C2Event, kind: 'session' | 'task'): string {
  const value = kind === 'session' ? event.sessionId : event.taskId;
  const metadata = event.data?.[kind + '_id'] ?? event.data?.[kind + 'Id'];
  return value || (typeof metadata === 'string' ? metadata : '');
}
export function onelinerKinds(type?: string): string[] {
  if (type === 'tcp_reverse') return ['bash', 'nc', 'nc_mkfifo', 'python', 'perl', 'powershell'];
  return ['http_beacon', 'https_beacon', 'websocket'].includes(type || '') ? ['curl_beacon'] : [];
}
export function timePresetToSince(preset: string, now = Date.now()): string {
  const milliseconds: Record<string, number> = { '15m': 900000, '1h': 3600000, '24h': 86400000, '7d': 604800000 };
  const offset = milliseconds[preset]; return offset ? new Date(now - offset).toISOString() : '';
}
export function normalizeFilePath(path: string): string {
  const result = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return result || (path.startsWith('/') ? '/' : '.');
}
export function joinFilePath(base: string, name: string): string {
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(name)) return normalizeFilePath(name);
  if (!base || base === '.') return normalizeFilePath(name);
  return normalizeFilePath(base + '/' + name);
}
export function resolvePathAgainstPwd(pwd: string, relative: string): string {
  const path = /^(?:\/|[A-Za-z]:[\\/])/.test(relative) ? normalizeFilePath(relative) : joinFilePath(pwd, relative);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length && !/^[A-Za-z]:$/.test(parts[parts.length - 1]!)) parts.pop(); }
    else parts.push(part);
  }
  return (path.startsWith('/') ? '/' : '') + parts.join('/') || '.';
}
export function parentFilePath(path: string): string {
  const normalized = normalizeFilePath(path);
  if (normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return normalized === '/' ? '/' : normalized + '/';
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '.' : normalized.slice(0, index) || '/';
}
export function sessionIsWindows(session?: C2Session): boolean { return /windows|^win/i.test(session?.os || ''); }
export function sessionTransport(session?: C2Session): string { return String(session?.metadata?.transport || '').toLowerCase(); }
export function sessionSupportsUpload(session?: C2Session): boolean {
  if (!session) return false;
  if (session.implantUuid?.startsWith('curl_')) return false;
  const metadata = session.metadata || {};
  if (metadata.supports_upload === false || metadata.legacy_shell === true) return false;
  const transport = sessionTransport(session);
  if (['tcp_beacon', 'http_beacon', 'https_beacon'].includes(transport)) return true;
  return !['tcp_reverse', 'legacy_shell', 'raw_tcp', 'tcp_shell'].includes(transport) && !session.hostname?.startsWith('tcp_');
}
export function parseLsLine(line: string): C2FileEntry | undefined {
  const beacon = line.trim().split('\t');
  if (beacon.length >= 4) {
    const name = beacon.slice(3).join('\t').trim();
    if (!name || name === '.' || name === '..') return;
    const mode = beacon[1]?.trim() || beacon[0]?.trim() || '';
    return { name, isDir: beacon[0]?.startsWith('d') === true || mode.startsWith('d'), permissions: mode, size: beacon[2]?.trim() || '', mtime: '' };
  }
  const match = line.match(/^([bcdlps-][rwxStTs-]{9}[+@.]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+\s+\d+\s+\S+)\s+(.+)$/);
  if (!match) return;
  const name = (match[4] || '').replace(/ -> .*$/, '');
  if (name === '.' || name === '..') return;
  return { name, isDir: match[1]?.startsWith('d') ?? false, size: match[2] || '', permissions: match[1] || '', mtime: match[3] || '' };
}
export function isDownloadShellError(text: string): boolean {
  return /(?:c2_download_err:|no such file|permission denied|cannot (?:open|access)|not a regular file|is a directory|\u7cfb\u7edf\u627e\u4e0d\u5230|\u62d2\u7edd\u8bbf\u95ee|\u65e0\u6cd5\u627e\u5230)/i.test(text);
}
export function downloadContent(content: string): Uint8Array<ArrayBuffer> {
  if (isDownloadShellError(content)) throw new Error(content.trim());
  const base64 = content.replace(/\s/g, '');
  try { if (/^[A-Za-z0-9+/=]+$/.test(base64) && base64) return Uint8Array.from(atob(base64), char => char.charCodeAt(0)); } catch { /* Shell may return plain text. */ }
  return new TextEncoder().encode(content);
}
export function validateListener(draft: ListenerDraft, creating: boolean): string | undefined {
  if (!draft.name.trim()) return 'c2.listeners.nameRequired';
  if (creating && !draft.type) return 'c2.listeners.typeRequired';
  if (!Number.isInteger(draft.bind_port) || draft.bind_port < 1 || draft.bind_port > 65535) return 'c2.listeners.portInvalid';
  return;
}
