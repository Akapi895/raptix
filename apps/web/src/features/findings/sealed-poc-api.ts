import { apiFetch } from '../../platform/transport'

/** The sealed Proof of Concept of a workspace finding, as the runtime reads it (ADR-0104). */
export interface SealedPoc {
  finding_id: string
  status: 'sealed' | 'no_poc_block' | 'refused' | 'finding_not_found'
  refusal?: string
  file?: string
  /** The payload as it appears inside the command. */
  payload?: string
  /** The PoC file exactly as it is on disk, cut at 64 KiB. */
  source?: string
  source_truncated?: boolean
  command?: string
  negative_command?: string
  success_patterns?: string[]
  negative_patterns?: string[]
  cvss_vector?: string
  /** True when the command carries the placeholder that the operator's value replaces for each run. */
  run_time_value?: boolean
}

export interface ReproductionOutput {
  exit_code: number
  matched_patterns: string[]
  output: string
}

/** One reproduction. It is not a verdict: only the verifier records one (ADR-0104). */
export interface Reproduction {
  finding_id: string
  outcome: 'ran' | 'refused'
  reproduced?: boolean
  refusal?: string
  positive?: ReproductionOutput
  negative?: ReproductionOutput
  recorded_at?: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function fetchSealedPoc(engagementId: string, ref: string): Promise<SealedPoc> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/workspace-findings/${encodeURIComponent(ref)}/poc`,
    (value): value is SealedPoc => isObject(value) && typeof value.status === 'string' && typeof value.finding_id === 'string',
  )
}

/** The value is sent for this one request. The server does not store it, and the console clears it after the run. */
export function reproduceSealedPoc(engagementId: string, ref: string, runTimeValue: string): Promise<Reproduction> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/workspace-findings/${encodeURIComponent(ref)}/reproduce`,
    (value): value is Reproduction => isObject(value) && typeof value.outcome === 'string',
    { method: 'POST', body: runTimeValue === '' ? {} : { token: runTimeValue }, timeoutMs: 180_000 },
  )
}
