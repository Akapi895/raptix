import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Path-based resolution: a `new URL(template, import.meta.url)` pattern is
// rewritten by Vite's asset transform, which cannot see JSON fixtures here.
const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/w00')

function fixture<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDir, relative), 'utf8')) as T
}

interface HttpCapture<T> { provenance: string; status: number; contentType: string; contentDisposition?: string; body: T }

describe('W00 controlled reference captures', () => {
  it('records 22 actual HTTP outcomes from the isolated image instance with explicit provenance', () => {
    const index = fixture<{ ok: boolean; serverSource: string; baseUrl: string; steps: Array<{ ok: boolean; status: number }> }>('http/index.json')
    expect(index.ok).toBe(true)
    expect(index.serverSource).toBe('image-container')
    expect(index.baseUrl).toBe('http://127.0.0.1:5290')
    expect(index.steps).toHaveLength(22)
    expect(index.steps.every(step => step.ok)).toBe(true)
    expect(fixture<HttpCapture<unknown>>('http/003-create-invalid-400.json').status).toBe(400)
    expect(fixture<HttpCapture<unknown>>('http/005-create-duplicate-409.json').status).toBe(409)
  })
  it('captures real parser defaults, approval epoch units and the unsupported-export legacy behavior', () => {
    const findings = fixture<HttpCapture<Array<{ id: string; severity: string; description: string }>>>('http/011-findings.json')
    expect(findings.body.find(finding => finding.id === 'FIND-002')).toMatchObject({ severity: 'medium', description: 'No description available.' })
    const approvals = fixture<HttpCapture<Array<{ request_id: string; created_at: number }>>>('http/015-approvals-pending.json')
    expect(approvals.body[0].request_id).toBe('w00-req-0001')
    expect(approvals.body[0].created_at).toBe(1767225600)
    expect(fixture<HttpCapture<unknown>>('http/017-approval-duplicate-409.json').status).toBe(409)
    const invalidExport = fixture<HttpCapture<string>>('http/020-export-invalid-format.json')
    expect(invalidExport.contentType).toContain('text/markdown')
    expect(invalidExport.contentDisposition).toContain('-export.md')
    expect(fixture<HttpCapture<unknown>>('http/021-graph.json').status).toBe(503)
  })
  it('preserves parallel invocation IDs and distinguishes full live output from capped checkpoint output', () => {
    type Event = { type: string; agent: string; session_id: string; id?: string | null; elapsed?: number; content?: string }
    const capture = fixture<{ provenance: string; liveEvents: Record<string, Event[]>; checkpointEvents: Record<string, Event[]>; checks: { allPassed: boolean } }>('runtime/runtime-emitter-capture.json')
    expect(capture.provenance).toBe('source-emitter-controlled')
    expect(capture.checks.allPassed).toBe(true)
    const first = capture.liveEvents['parallel-a']
    const second = capture.liveEvents['parallel-b']
    expect(first[0].agent).toBe(second[0].agent)
    expect(first[0].session_id).not.toBe(second[0].session_id)
    expect(first.find(event => event.type === 'subagent_tool_call')?.id).toBe('call-w00-1')
    expect(first.find(event => event.type === 'subagent_end')?.elapsed).toBe(85.125)
    expect(first.find(event => event.type === 'subagent_tool_result')?.content).toHaveLength(8001)
    expect(capture.checkpointEvents['parallel-a'].find(event => event.type === 'subagent_tool_result')?.content).toBe('x'.repeat(8000) + '…[truncated]')
    expect(capture.liveEvents['no-tool-id'].find(event => event.type === 'subagent_tool_call')?.id).toBeNull()
  })
  it('uses observed runtime ports and catalog instead of assuming the source-only Raptix alias is deployed', () => {
    const metadata = fixture<{ baseUrl: string; registeredGraphs: string[]; provenance: string }>('runtime/runtime-catalog.json')
    expect(metadata.provenance).toBe('runtime-catalog-read-only')
    expect(metadata.baseUrl).toBe('http://127.0.0.1:2400')
    expect(metadata.registeredGraphs).toContain('soundwave')
    expect(metadata.registeredGraphs).toContain('decepticon')
    expect(metadata.registeredGraphs).not.toContain('raptix')
  })
})
