export type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Translate = (key: string, options?: Record<string, unknown>) => string;
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export async function readError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error || fallback;
  return fallback;
}
