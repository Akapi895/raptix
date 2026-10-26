import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ProjectFiles } from '../src/services/project-files.js'
import { acquisitionArtifactPath, writeWebShellAcquisitionArtifact } from '../src/services/webshell-artifact.js'
import { ProjectApiError } from '../src/services/projects-service.js'

const PROFILE = {
  provider: 'http-form-command' as const,
  target: '10.129.88.4',
  endpoint: 'http://10.129.88.4/dev/phpbash.php',
  method: 'POST' as const,
  content_type: 'application/x-www-form-urlencoded' as const,
  command_parameter: 'cmd',
  probe_command: 'id;hostname',
  probe_pattern: 'uid=33',
  expected_user: 'www-data',
}

function files() {
  const writes: Array<{ slug: string; path: string; bytes: Buffer }> = []
  const port = {
    write: async (slug: string, path: string, bytes: Buffer) => { writes.push({ slug, path, bytes }) },
  } as unknown as ProjectFiles
  return { port, writes }
}

describe('WebShell acquisition artifact', () => {
  it('writes a bounded, secret-free acquisition document and returns its digest', async () => {
    const project = files()
    const written = await writeWebShellAcquisitionArtifact(project.port, 'bashed', {
      acquisitionId: 'acq-1',
      engagementId: 'eng-1',
      findingId: 'FIND-001',
      mode: 'derive',
      pocSha256: 'a'.repeat(64),
      specSha256: 'b'.repeat(64),
      profile: PROFILE,
      probe: { state: 'reachable', httpStatus: 200, matched: true, output: 'x'.repeat(5000), outputTruncated: false, error: null, durationMs: 12 },
      recordedAt: '2026-10-26T09:00:00.000Z',
    })
    expect(written.path).toBe('webshell/acquisitions/acq-1.json')
    const write = project.writes[0]!
    expect(write.slug).toBe('bashed')
    expect(written.sha256).toBe(createHash('sha256').update(write.bytes).digest('hex'))
    const document = JSON.parse(write.bytes.toString('utf8'))
    expect(document).toMatchObject({
      acquisition_id: 'acq-1',
      engagement: 'eng-1',
      finding_id: 'FIND-001',
      mode: 'derive',
      poc_sha256: 'a'.repeat(64),
      spec_sha256: 'b'.repeat(64),
      profile: PROFILE,
      probe: { state: 'reachable', matched: true, output_truncated: true, duration_ms: 12 },
      recorded_at: '2026-10-26T09:00:00.000Z',
    })
    expect(document.probe.output_excerpt).toHaveLength(4096)
    expect(write.bytes.toString('utf8')).not.toContain('argv')
  })

  it('refuses an acquisition id that is not a safe path segment', () => {
    expect(() => acquisitionArtifactPath('../acq')).toThrow(ProjectApiError)
  })
})
