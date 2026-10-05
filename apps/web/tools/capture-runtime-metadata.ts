import { writeFileSync } from 'node:fs'

const baseUrl = 'http://127.0.0.1:2400'
const infoResponse = await fetch(`${baseUrl}/info`, { signal: AbortSignal.timeout(10000) })
const registryResponse = await fetch(`${baseUrl}/assistants/search`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit: 100 }), signal: AbortSignal.timeout(10000),
})
if (!infoResponse.ok || !registryResponse.ok) throw new Error('Read-only runtime metadata capture failed')
const info = await infoResponse.json() as Record<string, unknown>
const registry = await registryResponse.json() as Array<{ graph_id: string }>
const capture = {
  provenance: 'runtime-catalog-read-only', baseUrl, capturedAt: new Date().toISOString(),
  apiVersion: info.version, langgraphPythonVersion: info.langgraph_py_version,
  flags: info.flags, registeredGraphs: [...new Set(registry.map(assistant => assistant.graph_id))].sort(),
  note: 'Only info and assistant discovery were called. No threads, runs or tools were created/executed.',
}
writeFileSync(new URL('../tests/fixtures/w00/runtime/runtime-catalog.json', import.meta.url), JSON.stringify(capture, null, 2) + '\n')
console.log('Read-only runtime catalog fixture captured')
