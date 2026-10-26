import { createHash } from 'node:crypto'
import type { WebShellProfile, WebShellProbeState } from '@raptix/web-contracts'
import type { ProjectFiles } from './project-files.js'
import { ProjectApiError } from './projects-service.js'

const ACQUISITION_ID = /^[A-Za-z0-9_-]{1,128}$/
const EXCERPT_LIMIT = 4096

export interface WebShellAcquisitionProbe {
  readonly state: WebShellProbeState
  readonly httpStatus: number | null
  readonly matched: boolean
  readonly output: string
  readonly outputTruncated: boolean
  readonly error: string | null
  readonly durationMs: number
}

export interface WebShellAcquisitionArtifactInput {
  readonly acquisitionId: string
  readonly engagementId: string
  readonly findingId: string
  readonly mode: 'derive' | 'refine'
  readonly pocSha256: string | null
  readonly specSha256: string | null
  readonly profile: WebShellProfile
  readonly probe: WebShellAcquisitionProbe | null
  readonly recordedAt: string
}

export interface WrittenWebShellArtifact {
  readonly path: string
  readonly sha256: string
}

export function acquisitionArtifactPath(acquisitionId: string): string {
  if (!ACQUISITION_ID.test(acquisitionId)) throw new ProjectApiError(400, 'The acquisition id is not a safe artifact name.')
  return `webshell/acquisitions/${acquisitionId}.json`
}

export async function writeWebShellAcquisitionArtifact(
  files: ProjectFiles,
  workspaceSlug: string,
  input: WebShellAcquisitionArtifactInput,
): Promise<WrittenWebShellArtifact> {
  const path = acquisitionArtifactPath(input.acquisitionId)
  const probe = input.probe === null ? null : {
    state: input.probe.state,
    http_status: input.probe.httpStatus,
    matched: input.probe.matched,
    output_excerpt: input.probe.output.slice(0, EXCERPT_LIMIT),
    output_truncated: input.probe.outputTruncated || input.probe.output.length > EXCERPT_LIMIT,
    error: input.probe.error,
    duration_ms: input.probe.durationMs,
  }
  const document = {
    acquisition_id: input.acquisitionId,
    engagement: input.engagementId,
    finding_id: input.findingId,
    mode: input.mode,
    poc_sha256: input.pocSha256,
    spec_sha256: input.specSha256,
    profile: input.profile,
    probe,
    recorded_at: input.recordedAt,
  }
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await files.write(workspaceSlug, path, bytes)
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') }
}
