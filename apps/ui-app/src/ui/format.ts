/** Escaping and display formatting shared by every view. Pure functions only. */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** Escapes text for element content and quoted attribute values alike. */
export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character] ?? character);
}

export function escapeAttr(text: unknown): string {
  return escapeHtml(text);
}

/** A JSON string literal that is safe inside an HTML attribute value. */
export function escapeJsString(text: unknown): string {
  return escapeHtml(JSON.stringify(String(text ?? '')));
}

/** Milliseconds as "1h 2m", "3m 4s" or "5s", the wording the console has always used. */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

const STATUS_KEYS: Record<string, string> = {
  pending: 'mcpDetailModal.statusPending',
  queued: 'mcpDetailModal.statusQueued',
  running: 'mcpDetailModal.statusRunning',
  background_running: 'timeline.backgroundRunning',
  completed: 'mcpDetailModal.statusCompleted',
  failed: 'mcpDetailModal.statusFailed',
  blocked: 'mcpMonitor.statusBlocked',
  cancelled: 'mcpDetailModal.statusCancelled',
  hard_timeout: 'mcpMonitor.statusHardTimeout',
  orphaned: 'mcpMonitor.statusOrphaned',
};

/** Localised label for a tool/run status. Unknown statuses are returned unchanged. */
export function statusLabel(status: string | null | undefined, translate: (key: string) => string): string {
  const normalized = (status ?? '').toLowerCase();
  const key = STATUS_KEYS[normalized];
  return key ? translate(key) : (status ?? '');
}
