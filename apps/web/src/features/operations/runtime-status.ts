/**
 * The runtime's own status words mapped to a tone (W24). A word the table does not know is neutral,
 * never success, so an unrecognised status is shown as written instead of as an outcome.
 */
export type StatusTone = 'ok' | 'bad' | 'warn' | 'neutral'

const STATUS_TONE: Record<string, StatusTone> = {
  success: 'ok', completed: 'ok',
  failed: 'bad', error: 'bad', timeout: 'bad', rejected: 'bad',
  interrupted: 'warn', running: 'warn', pending: 'warn', submitting: 'warn', submitted: 'warn', awaiting_approval: 'warn', uncertain: 'warn',
  cancelled: 'neutral', canceled: 'neutral',
}

export function runStatusTone(word: string): StatusTone {
  return STATUS_TONE[word] ?? 'neutral'
}
