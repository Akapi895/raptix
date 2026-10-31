import type { AuditDependencies, AuditLog } from './types';

export const auditActionsByCategory: Record<string, string[]> = {
  auth: ['login', 'logout', 'change_password'], config: ['apply', 'update'],
  c2: ['listener_create', 'listener_delete', 'listener_start', 'listener_stop', 'session_delete', 'task_create', 'task_cancel', 'task_delete'],
  webshell: ['connection_create', 'connection_delete'], knowledge: ['item_delete', 'index_build', 'index_rebuild_full'],
  conversation: ['create', 'delete', 'delete_turn'], vulnerability: ['create', 'update', 'delete'], external_mcp: ['upsert', 'delete'],
  task: ['create_queue', 'start_queue', 'delete_queue', 'pause_queue', 'rerun_queue', 'delete_batch_task'],
  tool: ['execution_delete', 'execution_delete_batch'], file: ['upload', 'delete'], hitl: ['decision', 'audit_strategy_update'],
  role: ['create', 'update', 'delete'], skill: ['create', 'update', 'delete'], agent: ['markdown_create', 'markdown_update', 'markdown_delete'],
};
const storedMessages: Record<string, string> = {
  '\u767b\u5f55\u5931\u8d25\uff1a\u5bc6\u7801\u9519\u8bef': 'settingsAudit.msg.auth.login_failed', '\u4fee\u6539\u5bc6\u7801\u5931\u8d25\uff1a\u5f53\u524d\u5bc6\u7801\u4e0d\u6b63\u786e': 'settingsAudit.msg.auth.change_password_failed',
  '\u5e94\u7528\u914d\u7f6e\u5931\u8d25\uff1a\u521d\u59cb\u5316\u77e5\u8bc6\u5e93': 'settingsAudit.msg.config.apply_fail_kb_init', '\u5e94\u7528\u914d\u7f6e\u5931\u8d25\uff1a\u91cd\u65b0\u521d\u59cb\u5316\u77e5\u8bc6\u5e93': 'settingsAudit.msg.config.apply_fail_kb_reinit', '\u5e94\u7528\u914d\u7f6e\u5931\u8d25\uff1aC2': 'settingsAudit.msg.config.apply_fail_c2',
};
export const escapeAuditHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function formatAuditTime(iso: string | undefined, locale: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' });
  } catch { return iso; }
}
export function createAuditLabels(dependencies: Pick<AuditDependencies, 'translate' | 'getLocale'>) {
  const t = (key: string, options: Record<string, string | number> | null = null, fallback = key): string => {
    const value = dependencies.translate(key, options ?? undefined);
    return value && value !== key ? value : fallback;
  };
  const category = (value: string) => value ? t('settingsAudit.cat.' + (value === 'external_mcp' ? 'externalMcp' : value), null, value) : '';
  const action = (value: string) => value ? t('settingsAudit.act.' + value, null, value) : '';
  const result = (value: string) => value ? t('settingsAudit.result.' + value, null, value) : '';
  function message(log: AuditLog): string {
    const raw = (log.message || '').trim();
    const stored = storedMessages[raw];
    if (stored) return t(stored, null, raw);
    const cat = (log.category || '').trim(), act = (log.action || '').trim();
    if (cat === 'auth' && (log.result || '').trim() === 'failure' && ['login', 'change_password'].includes(act)) return t(`settingsAudit.msg.auth.${act}_failed`, null, raw);
    return cat && act ? t(`settingsAudit.msg.${cat}.${act}`, null, raw) : raw;
  }
  return { t, category, action, result, message, time: (iso?: string) => formatAuditTime(iso, dependencies.getLocale()) };
}
