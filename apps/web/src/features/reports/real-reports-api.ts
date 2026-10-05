/**
 * W14 report export API: hits the new server's validated attachment endpoint.
 * Only `json` and `markdown` exist server-side; the browser offers exactly
 * those and reads the filename from Content-Disposition, so success is claimed
 * only after the response body arrived.
 */
import { apiBaseUrl } from '../../app/config'
import { ApiCanceledError, ApiClientError, ApiNetworkError, parseApiStatusError } from '../../shared/api/errors'

export const EXPORT_FORMATS = ['json', 'markdown'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface ExportDownload {
  filename: string
  contentType: string
  body: string
}

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value)
}

export async function exportEngagement(engagementId: string, format: ExportFormat, signal: AbortSignal): Promise<ExportDownload> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const onExternalAbort = (): void => controller.abort()
  signal.addEventListener('abort', onExternalAbort)
  try {
    const response = await fetch(`${apiBaseUrl}/engagements/${encodeURIComponent(engagementId)}/export?format=${encodeURIComponent(format)}`, {
      signal: controller.signal,
      headers: { Accept: format === 'json' ? 'application/json' : 'text/markdown' },
    })
    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      let parsed: unknown = null
      if (raw.length > 0) { try { parsed = JSON.parse(raw) } catch { parsed = null } }
      throw parseApiStatusError(response.status, parsed)
    }
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename="([^"]+)"/)
    return {
      filename: match?.[1] ?? (format === 'json' ? 'engagement-export.json' : 'engagement-export.md'),
      contentType: response.headers.get('Content-Type') ?? '',
      body: await response.text(),
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new ApiCanceledError()
    throw new ApiNetworkError(error)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onExternalAbort)
  }
}
